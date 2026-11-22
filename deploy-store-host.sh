#!/usr/bin/env bash
# =============================================================================
# OmniCore — store server (hosted WooCommerce stores)
# =============================================================================
# Prepares a separate VM (Ubuntu 22.04/24.04; an OCI Ampere A1 Flex works well) to
# host the WordPress + WooCommerce stores your workspaces create in OmniCore:
#
#   Docker ─┬─ omnicore-stores-db     MariaDB 11.4 (one database + user per store)
#           ├─ omnicore-stores-proxy  Traefik v3 (HTTPS, routing, Let's Encrypt)
#           └─ store-<id> …           one WordPress container per store
#   omnicore-store-agent (systemd)    signed API OmniCore calls to manage stores
#
# Run from a checkout of this repository on the store server, as root:
#
#   sudo STORES_DOMAIN=stores.example.com ACME_EMAIL=ops@example.com \
#        OMNICORE_IPS=203.0.113.5 ./deploy-store-host.sh install
#
# Commands:
#   install   first-time setup (safe to re-run)
#   update    refresh WooCommerce/Storefront/plugin cache, pull images, restart the agent
#   status    containers, agent and store counts
#   secret    print the agent secret to paste into OmniCore (Super Admin → Online stores)
#   help      this text
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }

# ── Configuration (override via environment) ──────────────────────────────────
STORES_DOMAIN="${STORES_DOMAIN:-}"          # stores get <name>.<STORES_DOMAIN>
ACME_EMAIL="${ACME_EMAIL:-}"                # Let's Encrypt account email
AGENT_HOST="${AGENT_HOST:-}"                # default agent.<STORES_DOMAIN>
EDGE_HOST="${EDGE_HOST:-}"                  # CNAME target for custom domains, default edge.<STORES_DOMAIN>
OMNICORE_IPS="${OMNICORE_IPS:-}"            # comma-separated IPs allowed to call the agent (your OmniCore server)
CF_ORIGIN_CERT="${CF_ORIGIN_CERT:-}"        # optional Cloudflare Origin certificate for *.STORES_DOMAIN (PEM)
CF_ORIGIN_KEY="${CF_ORIGIN_KEY:-}"          # …and its private key
STORE_MEMORY="${STORE_MEMORY:-512m}"        # memory limit per store
DB_BUFFER_POOL="${DB_BUFFER_POOL:-1G}"      # MariaDB InnoDB buffer pool
CONF_DIR="${CONF_DIR:-/etc/omnicore-stores}"
DATA_DIR="${DATA_DIR:-/var/lib/omnicore-stores}"
WP_IMAGE="${WP_IMAGE:-wordpress:php8.3-apache}"
WPCLI_IMAGE="${WPCLI_IMAGE:-wordpress:cli-php8.3}"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.3}"
MARIADB_IMAGE="${MARIADB_IMAGE:-mariadb:11.4}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK="omnicore-stores"

need_root() { [[ $EUID -eq 0 ]] || error "Run as root (sudo)."; }

defaults() {
  [[ -n "$STORES_DOMAIN" ]] || error "Set STORES_DOMAIN, e.g. STORES_DOMAIN=stores.example.com"
  AGENT_HOST="${AGENT_HOST:-agent.${STORES_DOMAIN}}"
  EDGE_HOST="${EDGE_HOST:-edge.${STORES_DOMAIN}}"
  if [[ -n "$CF_ORIGIN_CERT" && -n "$CF_ORIGIN_KEY" ]]; then TLS_MODE="acme"; else TLS_MODE="acme-all"; fi
}

install_packages() {
  step "Packages: Docker, Node.js 22, tools"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg zip unzip openssl iptables-persistent >/dev/null
  if ! command -v docker >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io >/dev/null
  fi
  mkdir -p /etc/docker
  if [[ ! -f /etc/docker/daemon.json ]]; then
    echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' > /etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null
  if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  success "Docker $(docker version --format '{{.Server.Version}}'), Node.js $(node -v)"
}

write_secrets() {
  step "Secrets"
  install -d -m 0750 "$CONF_DIR"
  [[ -f "$CONF_DIR/db-root-password" ]] || { openssl rand -hex 24 > "$CONF_DIR/db-root-password"; chmod 600 "$CONF_DIR/db-root-password"; }
  local secret
  if [[ -f "$CONF_DIR/agent.env" ]] && grep -q '^AGENT_SECRET=' "$CONF_DIR/agent.env"; then
    secret="$(grep '^AGENT_SECRET=' "$CONF_DIR/agent.env" | cut -d= -f2-)"
  else
    secret="$(openssl rand -hex 32)"
  fi
  cat > "$CONF_DIR/agent.env" <<EOF
AGENT_SECRET=${secret}
AGENT_BIND=0.0.0.0
AGENT_PORT=8790
AGENT_ALLOW_IPS=${OMNICORE_IPS}
STORES_DATA_DIR=${DATA_DIR}
STORES_DB_ROOT_PASSWORD_FILE=${CONF_DIR}/db-root-password
TLS_MODE=${TLS_MODE}
PARKED_URL=http://host.docker.internal:8790
WP_IMAGE=${WP_IMAGE}
WPCLI_IMAGE=${WPCLI_IMAGE}
STORE_MEMORY=${STORE_MEMORY}
EOF
  chmod 600 "$CONF_DIR/agent.env"
  success "Agent secret and database password in $CONF_DIR (mode 600)"
}

refresh_cache() {
  step "WooCommerce, Storefront and the OmniCore plugin"
  install -d "$DATA_DIR/cache" "$DATA_DIR/backups" "$DATA_DIR/traefik/dynamic" "$DATA_DIR/letsencrypt"
  curl -fsSL -o "$DATA_DIR/cache/woocommerce.zip.new" https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip \
    && mv "$DATA_DIR/cache/woocommerce.zip.new" "$DATA_DIR/cache/woocommerce.zip"
  curl -fsSL -o "$DATA_DIR/cache/storefront.zip.new" https://downloads.wordpress.org/theme/storefront.latest-stable.zip \
    && mv "$DATA_DIR/cache/storefront.zip.new" "$DATA_DIR/cache/storefront.zip"
  (cd "$REPO_DIR/artifacts/woocommerce-plugin" && rm -f "$DATA_DIR/cache/omnicore-commerce.zip" && zip -qr "$DATA_DIR/cache/omnicore-commerce.zip" omnicore-commerce)
  for img in "$WP_IMAGE" "$WPCLI_IMAGE" "$TRAEFIK_IMAGE" "$MARIADB_IMAGE"; do docker pull -q "$img" >/dev/null; done
  success "Cache ready in $DATA_DIR/cache, images pulled"
}

start_database() {
  step "MariaDB"
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
  if ! docker inspect omnicore-stores-db >/dev/null 2>&1; then
    docker run -d --name omnicore-stores-db --network "$NETWORK" --restart unless-stopped \
      -e MARIADB_ROOT_PASSWORD_FILE=/run/secrets/db-root-password \
      -v "$CONF_DIR/db-root-password:/run/secrets/db-root-password:ro" \
      -v omnicore_stores_db:/var/lib/mysql \
      "$MARIADB_IMAGE" --innodb-buffer-pool-size="$DB_BUFFER_POOL" --max-connections=500 >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec -e MYSQL_PWD="$(cat "$CONF_DIR/db-root-password")" omnicore-stores-db mariadb -uroot -e 'SELECT 1' >/dev/null 2>&1 && break
    sleep 2
  done
  success "MariaDB running (not exposed outside Docker)"
}

start_proxy() {
  step "Traefik"
  local allow=""
  if [[ -n "$OMNICORE_IPS" ]]; then
    allow="$(echo "$OMNICORE_IPS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | awk 'NF{printf "%s\"%s\"", (n++?", ":""), $0}')"
  fi
  cat > "$CONF_DIR/traefik.yml" <<EOF
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint: { to: websecure, scheme: https }
  websecure:
    address: ":443"
providers:
  file:
    directory: /dynamic
    watch: true
certificatesResolvers:
  le:
    acme:
      email: "${ACME_EMAIL}"
      storage: /letsencrypt/acme.json
      httpChallenge: { entryPoint: web }
log: { level: WARN }
EOF
  # Default certificate (Cloudflare origin certificate for *.STORES_DOMAIN), if given.
  if [[ "$TLS_MODE" == "acme" ]]; then
    install -m 600 "$CF_ORIGIN_CERT" "$CONF_DIR/origin.pem"
    install -m 600 "$CF_ORIGIN_KEY" "$CONF_DIR/origin.key"
    cat > "$DATA_DIR/traefik/dynamic/00-tls.yml" <<EOF
tls:
  stores:
    default:
      defaultCertificate: { certFile: /certs/origin.pem, keyFile: /certs/origin.key }
EOF
  else
    rm -f "$DATA_DIR/traefik/dynamic/00-tls.yml"
  fi
  # The agent API, reachable only over HTTPS (and only from OMNICORE_IPS when set).
  cat > "$DATA_DIR/traefik/dynamic/00-agent.yml" <<EOF
http:
  routers:
    omnicore-agent:
      rule: "Host(\`${AGENT_HOST}\`)"
      entryPoints: [websecure]
      service: omnicore-agent
      tls: $([[ "$TLS_MODE" == "acme" ]] && echo "{}" || echo "{ certResolver: le }")
$([[ -n "$allow" ]] && echo "      middlewares: [omnicore-only]")
  services:
    omnicore-agent:
      loadBalancer: { servers: [ { url: "http://host.docker.internal:8790" } ] }
$([[ -n "$allow" ]] && printf '  middlewares:\n    omnicore-only:\n      ipAllowList: { sourceRange: [%s] }\n' "$allow")
EOF
  touch "$DATA_DIR/letsencrypt/acme.json" && chmod 600 "$DATA_DIR/letsencrypt/acme.json"
  docker rm -f omnicore-stores-proxy >/dev/null 2>&1 || true
  docker run -d --name omnicore-stores-proxy --network "$NETWORK" --restart unless-stopped \
    -p 80:80 -p 443:443 --add-host host.docker.internal:host-gateway \
    -v "$CONF_DIR/traefik.yml:/etc/traefik/traefik.yml:ro" \
    -v "$DATA_DIR/traefik/dynamic:/dynamic:ro" \
    -v "$DATA_DIR/letsencrypt:/letsencrypt" \
    -v "$CONF_DIR:/certs:ro" \
    "$TRAEFIK_IMAGE" >/dev/null
  success "Traefik on :80/:443 (TLS mode ${TLS_MODE})"
}

start_agent() {
  step "Store agent"
  cat > /etc/systemd/system/omnicore-store-agent.service <<EOF
[Unit]
Description=OmniCore store agent
After=docker.service network-online.target
Requires=docker.service

[Service]
EnvironmentFile=${CONF_DIR}/agent.env
ExecStart=$(command -v node) ${REPO_DIR}/artifacts/store-agent/src/agent.mjs
Restart=always
RestartSec=3
WorkingDirectory=${REPO_DIR}/artifacts/store-agent

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable omnicore-store-agent >/dev/null
  systemctl restart omnicore-store-agent
  sleep 2
  systemctl is-active --quiet omnicore-store-agent && success "Agent running (port 8790, behind https://${AGENT_HOST})" \
    || error "The agent did not start: journalctl -u omnicore-store-agent -n 50"
}

open_firewall() {
  step "Firewall (OCI iptables)"
  # Oracle images REJECT everything but SSH; open 80/443 only (the agent port stays closed).
  for port in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  done
  netfilter-persistent save >/dev/null 2>&1 || true
  success "Ports 80 and 443 open (also allow them in the VCN security list)"
}

summary() {
  local ip
  ip="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  step "Done — next steps"
  cat <<EOF
1. DNS (proxied through Cloudflare or DNS-only):
     A   *.${STORES_DOMAIN}   → ${ip}
     A   ${AGENT_HOST}        → ${ip}   (DNS-only is fine)
     A   ${EDGE_HOST}         → ${ip}   (custom domains CNAME here)
2. In OmniCore: Super Admin → Online stores → Add server
     Agent URL:    https://${AGENT_HOST}
     Agent secret: $(grep '^AGENT_SECRET=' "$CONF_DIR/agent.env" | cut -d= -f2-)
     Store domain: ${STORES_DOMAIN}
     CNAME target: ${EDGE_HOST}
     Public IP:    ${ip}
3. Optional: Cloudflare for SaaS custom hostnames (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID on
   the OmniCore server) with ${EDGE_HOST} as the fallback origin.
4. Backups: nightly per store in ${DATA_DIR}/backups (14 days). Copy them off the server.
EOF
}

main() {
  local cmd="${1:-help}"
  case "$cmd" in
    install)
      need_root; defaults
      [[ -n "$ACME_EMAIL" ]] || warn "ACME_EMAIL is empty: Let's Encrypt registration may fail."
      install_packages; write_secrets; refresh_cache; start_database; start_proxy; start_agent; open_firewall; summary ;;
    update)
      need_root; defaults
      refresh_cache; systemctl restart omnicore-store-agent; success "Updated" ;;
    status)
      docker ps --format 'table {{.Names}}\t{{.Status}}' | head -50
      systemctl --no-pager --lines=5 status omnicore-store-agent || true
      echo "Stores on disk: $(ls "$DATA_DIR/state" 2>/dev/null | grep -c '\.json$' || echo 0)" ;;
    secret)
      need_root; grep '^AGENT_SECRET=' "$CONF_DIR/agent.env" | cut -d= -f2- ;;
    *)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  esac
}

# Run only when executed (sourcing loads the functions, e.g. for testing).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
