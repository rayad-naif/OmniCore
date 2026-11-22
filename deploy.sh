#!/usr/bin/env bash
# =============================================================================
# Atelier OmniCore — Automated Setup & Deployment Script
# =============================================================================
# Usage:
#   chmod +x deploy.sh
#
#   Local dev setup:         ./deploy.sh setup
#   Production build:        ./deploy.sh build
#   Deploy to running VPS:   ./deploy.sh deploy
#   Fresh VPS install:       ./deploy.sh vps-install
#   Health check:            ./deploy.sh health
#   Help:                    ./deploy.sh help
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }

# ── Configuration (override via environment) ──────────────────────────────────
APP_DIR="${APP_DIR:-/srv/omnicore}"
API_PORT="${PORT:-8080}"
DB_NAME="${DB_NAME:-omnicore}"
DB_USER="${DB_USER:-omnicore}"
PM2_APP_NAME="${PM2_APP_NAME:-omnicore-api}"
DOMAIN="${DOMAIN:-}"                 # e.g. omnicore.irofficial.com (enables nginx server_name + HTTPS)
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"   # Let's Encrypt account email (needed for automatic HTTPS)
RUN_USER="${RUN_USER:-ubuntu}"       # Non-root user that owns the app and runs PM2
REPO_BRANCH="${REPO_BRANCH:-main}"
NODE_MIN_MAJOR=24
PNPM_MIN_MAJOR=10

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

check_command() {
  command -v "$1" >/dev/null 2>&1 || error "$1 is not installed. Please install it first."
}

check_node_version() {
  check_command node
  local major
  major=$(node -e "console.log(process.versions.node.split('.')[0])")
  if [[ "$major" -lt "$NODE_MIN_MAJOR" ]]; then
    error "Node.js ${NODE_MIN_MAJOR}+ required. Found: $(node -v)"
  fi
  success "Node.js $(node -v)"
}

check_pnpm_version() {
  check_command pnpm
  local major
  major=$(pnpm -v | cut -d. -f1)
  if [[ "$major" -lt "$PNPM_MIN_MAJOR" ]]; then
    warn "pnpm ${PNPM_MIN_MAJOR}+ recommended. Found: $(pnpm -v). Upgrading..."
    npm install -g pnpm
  fi
  success "pnpm $(pnpm -v)"
}

check_postgres() {
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — skipping database checks (set DATABASE_URL manually)"
    return 0
  fi
  success "PostgreSQL client: $(psql --version)"
}

require_env_file() {
  local env_file="artifacts/api-server/.env"
  if [[ ! -f "$env_file" ]]; then
    warn ".env file not found at $env_file"
    info "Copying .env.example → $env_file"
    cp .env.example "$env_file"
    echo ""
    echo -e "${YELLOW}  ┌─────────────────────────────────────────────────────────┐${RESET}"
    echo -e "${YELLOW}  │  ACTION REQUIRED: Edit artifacts/api-server/.env         │${RESET}"
    echo -e "${YELLOW}  │  Fill in: DATABASE_URL, JWT_SECRET, GEMINI_API_KEY,      │${RESET}"
    echo -e "${YELLOW}  │           PADDLE_API_KEY, R2_* variables                 │${RESET}"
    echo -e "${YELLOW}  └─────────────────────────────────────────────────────────┘${RESET}"
    echo ""
    error "Please edit $env_file and run this script again."
  fi
  success ".env file found"
}

load_env() {
  local env_file="artifacts/api-server/.env"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source <(grep -v '^#' "$env_file" | grep -v '^$')
    set +a
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

cmd_setup() {
  step "Local Development Setup"

  check_node_version
  check_pnpm_version
  check_postgres

  step "Installing workspace dependencies"
  pnpm install
  success "Dependencies installed"

  step "Environment file"
  local env_file="artifacts/api-server/.env"
  if [[ ! -f "$env_file" ]]; then
    cp .env.example "$env_file"
    success "Created $env_file from template"
    warn "Edit $env_file before starting the server"
  else
    success "$env_file already exists"
  fi

  step "Database setup"
  load_env
  if [[ -n "${DATABASE_URL:-}" ]]; then
    info "Applying schema to ${DATABASE_URL%%@*@*}..."  # hide credentials in log
    psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true
    psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
    psql "$DATABASE_URL" -f artifacts/api-server/schema.sql
    success "Schema applied"
  else
    warn "DATABASE_URL not set — skipping schema. Run manually:"
    info "  psql YOUR_DATABASE_URL -f artifacts/api-server/schema.sql"
  fi

  step "TypeScript check"
  pnpm run typecheck
  success "TypeScript: zero errors"

  echo ""
  echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
  echo ""
  echo "  Start API server:      pnpm --filter @workspace/api-server run dev"
  echo "  Start dashboard:       pnpm --filter @workspace/dashboard run dev"
  echo "  Start marketing site:  pnpm --filter @workspace/marketing-site run dev"
  echo ""
}

cmd_build() {
  step "Production Build"

  check_node_version
  check_pnpm_version

  step "Installing dependencies"
  pnpm install --frozen-lockfile
  success "Dependencies installed"

  step "TypeScript typecheck"
  pnpm run typecheck
  success "Typecheck passed — zero errors"

  step "Building all artifacts"

  info "Building API server (esbuild)..."
  pnpm --filter @workspace/api-server run build
  [[ -f artifacts/api-server/dist/index.mjs ]] || error "API build failed — dist/index.mjs not found"
  success "API server built → artifacts/api-server/dist/index.mjs ($(du -sh artifacts/api-server/dist/index.mjs | cut -f1))"

  info "Building dashboard (Vite)..."
  pnpm --filter @workspace/dashboard run build
  [[ -d artifacts/dashboard/dist ]] || error "Dashboard build failed — dist/ not found"
  success "Dashboard built → artifacts/dashboard/dist/ ($(du -sh artifacts/dashboard/dist | cut -f1))"

  info "Building marketing site (Vite + SSR prerender)..."
  pnpm --filter @workspace/marketing-site run build
  [[ -d artifacts/marketing-site/dist ]] || error "Marketing site build failed — dist/ not found"
  success "Marketing site built → artifacts/marketing-site/dist/ ($(du -sh artifacts/marketing-site/dist | cut -f1))"

  echo ""
  echo -e "${GREEN}${BOLD}Build complete!${RESET}"
  echo ""
  echo "  API bundle:      artifacts/api-server/dist/index.mjs"
  echo "  Dashboard:       artifacts/dashboard/dist/"
  echo "  Marketing site:  artifacts/marketing-site/dist/"
  echo ""
  echo "  Start production: node artifacts/api-server/dist/index.mjs"
  echo ""
}

cmd_deploy() {
  step "Deploy — Production Update"

  # Validate we're in the repo root
  [[ -f pnpm-workspace.yaml ]] || error "Run this script from the repository root"

  require_env_file
  load_env

  check_command pm2

  step "Pull latest code"
  git pull
  success "Code updated"

  step "Install dependencies"
  pnpm install --frozen-lockfile
  success "Dependencies up to date"

  step "TypeScript typecheck"
  pnpm run typecheck
  success "Typecheck passed"

  step "Build production artifacts"
  pnpm run build
  success "All artifacts built"

  step "Apply database migrations"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -f artifacts/api-server/schema.sql
    success "Schema migrations applied"
  else
    warn "DATABASE_URL not set — skipping migrations"
  fi

  step "Restart API server"
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    pm2 delete "$PM2_APP_NAME"
  fi

  # Resolve ecosystem config location
  local eco_file
  if [[ -f "ecosystem.config.cjs" ]]; then
    eco_file="ecosystem.config.cjs"
  elif [[ -f "${APP_DIR}/ecosystem.config.cjs" ]]; then
    eco_file="${APP_DIR}/ecosystem.config.cjs"
  else
    # Create a minimal one on the fly
    eco_file="/tmp/ecosystem.config.cjs"
    cat > "$eco_file" << EOF
module.exports = {
  apps: [{
    name: '${PM2_APP_NAME}',
    script: '$(pwd)/artifacts/api-server/dist/index.mjs',
    env: $(node -e "
const fs=require('fs');
const env=Object.fromEntries(
  fs.readFileSync('artifacts/api-server/.env','utf8')
    .split('\n')
    .filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('='))
    .map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]})
);
console.log(JSON.stringify(env));
"),
  }]
};
EOF
    warn "No ecosystem.config.cjs found — created temporary one at $eco_file"
  fi

  pm2 start "$eco_file"
  pm2 save
  success "API server restarted — PM2 process: $PM2_APP_NAME"

  sleep 3
  cmd_health

  echo ""
  success "Deployment complete!"
  echo ""
}

cmd_vps_install() {
  step "VPS Fresh Installation (Ubuntu 22.04 / 24.04)"

  [[ "$(id -u)" -eq 0 ]] || error "Run as root: sudo ./deploy.sh vps-install"

  step "System packages"
  apt-get update -qq
  apt-get install -y curl gnupg2 lsb-release ca-certificates software-properties-common \
    git build-essential nginx certbot python3-certbot-nginx iptables-persistent openssl

  step "Swap (small OCI shapes need it to build)"
  local mem_mb
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [[ "$mem_mb" -lt 3500 ]] && ! swapon --show | grep -q '/swapfile'; then
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    success "4G swap enabled (RAM: ${mem_mb}MB)"
  else
    success "Swap not needed or already present (RAM: ${mem_mb}MB)"
  fi

  step "Node.js 24"
  if ! node --version 2>/dev/null | grep -q "^v24"; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
  fi
  success "Node.js $(node -v)"

  step "pnpm + PM2"
  npm install -g pnpm@10.26.1 pm2
  success "pnpm $(pnpm -v), PM2 $(pm2 -v)"

  step "PostgreSQL 16 + pgvector"
  if ! pg_lsclusters 2>/dev/null | grep -q "16"; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
      gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
      https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
    apt-get install -y postgresql-16 postgresql-16-pgvector
  fi
  success "PostgreSQL $(pg_lsclusters | tail -1 | awk '{print $1}')"

  step "Database: create omnicore user + database"
  DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
  sudo -u postgres psql << SQL 2>/dev/null || warn "Database may already exist — skipping"
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
SQL
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
  success "Database: $DB_NAME"

  echo ""
  echo -e "${YELLOW}  Database password (save this): ${BOLD}${DB_PASSWORD}${RESET}"
  echo -e "${YELLOW}  DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}${RESET}"
  echo ""

  step "Clone and build application"
  REPO_URL="${REPO_URL:-https://github.com/rayad-naif/OmniCore.git}"
  if [[ ! -d "$APP_DIR/.git" ]]; then
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
  else
    git -C "$APP_DIR" pull
  fi
  chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

  cd "$APP_DIR"
  sudo -u "$RUN_USER" pnpm install --frozen-lockfile
  success "Dependencies installed"

  step "Environment file"
  local env_file="$APP_DIR/artifacts/api-server/.env"
  local public_url="http://${DOMAIN:-localhost}"
  [[ -n "$DOMAIN" ]] && public_url="https://${DOMAIN}"
  if [[ ! -f "$env_file" ]]; then
    cp "$APP_DIR/.env.example" "$env_file"
    set_env() { # key value — replace or append
      if grep -q "^$1=" "$env_file"; then
        sed -i "s|^$1=.*|$1=$2|" "$env_file"
      else
        echo "$1=$2" >> "$env_file"
      fi
    }
    set_env NODE_ENV production
    set_env PORT "$API_PORT"
    set_env DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
    set_env JWT_SECRET "$(openssl rand -hex 64)"
    set_env SESSION_SECRET "$(openssl rand -hex 32)"
    set_env PUBLIC_APP_URL "$public_url"
    set_env ALLOWED_ORIGINS "$public_url"
    set_env COOKIE_SECURE "$([[ -n "$DOMAIN" ]] && echo true || echo false)"
    set_env VITE_API_URL /api
    chown "$RUN_USER":"$RUN_USER" "$env_file"
    chmod 600 "$env_file"
    warn "Edit $env_file to set GEMINI_API_KEY, PADDLE_*, R2_* (JWT/session secrets were generated)"
  else
    success "env file exists"
  fi

  step "Build production artifacts"
  sudo -u "$RUN_USER" env VITE_API_URL=/api pnpm run build
  success "All artifacts built"

  step "Apply database schema"
  # Use the URL stored in .env so re-runs keep working with the original password.
  local db_url
  db_url=$(grep '^DATABASE_URL=' "$env_file" | cut -d= -f2-)
  psql "$db_url" -f "$APP_DIR/artifacts/api-server/schema.sql"
  success "Schema applied"

  step "nginx configuration"
  local server_name="${DOMAIN:-_}"
  cat > /etc/nginx/sites-available/omnicore << NGINX
server {
    listen 80;
    server_name ${server_name};

    location /api/ {
        proxy_pass         http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        client_max_body_size 50M;
    }

    location = /dashboard {
        return 301 /dashboard/;
    }

    location /dashboard/ {
        alias ${APP_DIR}/artifacts/dashboard/dist/public/;
        try_files \$uri \$uri/ /dashboard/index.html;
    }

    location / {
        root ${APP_DIR}/artifacts/marketing-site/dist/public/;
        try_files \$uri \$uri.html \$uri/ =404;
        error_page 404 /404.html;
    }
}
NGINX

  ln -sf /etc/nginx/sites-available/omnicore /etc/nginx/sites-enabled/omnicore
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  success "nginx configured"

  step "Firewall (OCI iptables)"
  # Oracle's Ubuntu images ship iptables rules that REJECT everything except SSH,
  # and Oracle advises against ufw on these images. Insert ACCEPT rules ahead of
  # the REJECT rule and persist them. The VCN security list must ALSO allow
  # TCP 80/443 ingress (OCI Console → Networking → VCN → Security Lists).
  for port in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  done
  netfilter-persistent save
  success "iptables: ports 80, 443 open and persisted"

  step "PM2 ecosystem + startup"
  mkdir -p /var/log/omnicore
  chown "$RUN_USER":"$RUN_USER" /var/log/omnicore
  cat > "$APP_DIR/ecosystem.config.cjs" << EOF
const fs   = require('fs');
const path = require('path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split('\\n')
      .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
  );
}

module.exports = {
  apps: [{
    name:       '${PM2_APP_NAME}',
    script:     '${APP_DIR}/artifacts/api-server/dist/index.mjs',
    cwd:        '${APP_DIR}',
    env:        loadEnv('${APP_DIR}/artifacts/api-server/.env'),
    instances:  1,
    exec_mode:  'fork',
    watch:      false,
    max_memory_restart: '512M',
    error_file: '/var/log/omnicore/error.log',
    out_file:   '/var/log/omnicore/out.log',
  }]
};
EOF
  chown "$RUN_USER":"$RUN_USER" "$APP_DIR/ecosystem.config.cjs"

  local run_home
  run_home=$(getent passwd "$RUN_USER" | cut -d: -f6)
  sudo -u "$RUN_USER" pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
  sudo -u "$RUN_USER" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$RUN_USER" pm2 save
  env PATH="$PATH" pm2 startup systemd -u "$RUN_USER" --hp "$run_home"
  success "PM2 configured with auto-start on boot (user: $RUN_USER)"

  step "HTTPS (Let's Encrypt)"
  if [[ -n "$DOMAIN" && -n "$CERTBOT_EMAIL" ]]; then
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
      success "TLS certificate issued for $DOMAIN"
    else
      warn "certbot failed — check the DNS A record points here and VCN allows 80/443, then run:"
      warn "  sudo certbot --nginx -d $DOMAIN"
    fi
  else
    warn "DOMAIN/CERTBOT_EMAIL not set — skipping HTTPS. Run later: sudo certbot --nginx -d yourdomain.com"
  fi

  local base_url="http://${DOMAIN:-<server-ip>}"
  [[ -n "$DOMAIN" ]] && base_url="https://${DOMAIN}"

  echo ""
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}  OmniCore VPS installation complete!${RESET}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Next steps:"
  echo "  1. Edit:   $APP_DIR/artifacts/api-server/.env"
  echo "     Set:    GEMINI_API_KEY, PADDLE_*, R2_*, SUPER_ADMIN_EMAIL"
  echo ""
  echo "  2. Restart the API to pick up new env:"
  echo "     sudo -u $RUN_USER pm2 restart ${PM2_APP_NAME} --update-env"
  echo ""
  echo "  3. Create the super admin:   ./deploy.sh seed-admin"
  echo ""
  echo "  4. Register Paddle webhook:  ${base_url}/api/paddle/webhook"
  echo ""
  echo "  Dashboard: ${base_url}/dashboard/   ·   Health: ${base_url}/api/healthz"
  echo ""
}

cmd_health() {
  step "Health Check"

  load_env
  local base_url="http://localhost:${API_PORT}"

  info "Checking API health endpoint..."
  local response http_code
  response=$(curl -s -w "\n%{http_code}" "${base_url}/api/healthz" 2>/dev/null || echo -e "\n000")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -1)

  if [[ "$http_code" == "200" ]]; then
    success "API health: HTTP $http_code"
    echo "  $body"
  else
    error "API health check failed: HTTP $http_code (is the server running on port ${API_PORT}?)"
  fi

  info "Checking database connectivity..."
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -c "SELECT count(*) FROM tenants;" >/dev/null 2>&1 && \
      success "Database: connected" || warn "Database: connection failed — check DATABASE_URL"
  else
    warn "DATABASE_URL not set — skipping DB check"
  fi

  if command -v pm2 >/dev/null 2>&1; then
    info "PM2 process status..."
    pm2 describe "$PM2_APP_NAME" 2>/dev/null | grep -E "status|restart" || \
      warn "PM2 process '$PM2_APP_NAME' not found"
  fi

  success "Health check complete"
}

cmd_seed_admin() {
  step "Seed Super Admin Account"

  load_env
  [[ -n "${DATABASE_URL:-}" ]] || error "DATABASE_URL not set in .env"

  read -rp "  Admin email:    " ADMIN_EMAIL
  read -rsp "  Admin password: " ADMIN_PASS
  echo ""

  if [[ -z "$ADMIN_EMAIL" ]] || [[ -z "$ADMIN_PASS" ]]; then
    error "Email and password are required"
  fi
  [[ ${#ADMIN_PASS} -ge 12 ]] || error "Use a password of at least 12 characters"

  # Hash inside the api-server package so pnpm resolves bcryptjs; pass the
  # password through the environment, never through code or SQL text.
  HASH=$(cd artifacts/api-server && ADMIN_PASS="$ADMIN_PASS" node -e "
require('bcryptjs').hash(process.env.ADMIN_PASS, 12).then(h => process.stdout.write(h));
") || error "Failed to hash password — run pnpm install first"

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v email="$ADMIN_EMAIL" -v hash="$HASH" << 'SQL'
INSERT INTO tenants (id, company_name, subscription_status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Platform Admin', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (tenant_id, name, email, password_hash, role, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'Super Admin',
        lower(:'email'), :'hash', 'admin', true)
ON CONFLICT (tenant_id, email)
DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true;
SQL

  local env_file="artifacts/api-server/.env"
  if grep -q '^SUPER_ADMIN_EMAIL=' "$env_file"; then
    sed -i "s|^SUPER_ADMIN_EMAIL=.*|SUPER_ADMIN_EMAIL=${ADMIN_EMAIL,,}|" "$env_file"
  else
    echo "SUPER_ADMIN_EMAIL=${ADMIN_EMAIL,,}" >> "$env_file"
  fi

  success "Super admin account ready: $ADMIN_EMAIL (SUPER_ADMIN_EMAIL set in .env)"
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    pm2 delete "$PM2_APP_NAME" >/dev/null && pm2 start ecosystem.config.cjs >/dev/null && pm2 save >/dev/null
    success "API restarted to pick up SUPER_ADMIN_EMAIL"
  else
    warn "Restart the API so it picks up SUPER_ADMIN_EMAIL"
  fi
}

cmd_help() {
  echo ""
  echo -e "${BOLD}Atelier OmniCore — Deploy Script${RESET}"
  echo ""
  echo "Usage: ./deploy.sh <command>"
  echo ""
  echo "Commands:"
  echo "  setup          Install deps, create .env, apply schema, run typecheck"
  echo "  build          Full production build (typecheck + all artifacts)"
  echo "  deploy         Git pull + build + restart PM2 (for existing VPS deployments)"
  echo "  vps-install    Fresh Ubuntu VPS install (Node, Postgres, nginx, PM2)"
  echo "  seed-admin     Create a super admin account interactively"
  echo "  health         Check API health endpoint + database + PM2 status"
  echo "  help           Show this help message"
  echo ""
  echo "Environment overrides:"
  echo "  APP_DIR        Application directory (default: /srv/omnicore)"
  echo "  PORT           API server port (default: 8080)"
  echo "  DB_NAME        Database name (default: omnicore)"
  echo "  DB_USER        Database user (default: omnicore)"
  echo "  DB_PASSWORD    Database password (vps-install only)"
  echo "  PM2_APP_NAME   PM2 process name (default: omnicore-api)"
  echo "  REPO_URL       Git repository URL (vps-install only)"
  echo ""
  echo "Examples:"
  echo "  ./deploy.sh setup                          # First-time local setup"
  echo "  ./deploy.sh build                          # CI/CD production build"
  echo "  ./deploy.sh deploy                         # Rolling deploy on VPS"
  echo "  sudo REPO_URL=https://github.com/org/repo ./deploy.sh vps-install"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

# Ensure we're in the repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMMAND="${1:-help}"

case "$COMMAND" in
  setup)        cmd_setup ;;
  build)        cmd_build ;;
  deploy)       cmd_deploy ;;
  vps-install)  cmd_vps_install ;;
  seed-admin)   cmd_seed_admin ;;
  health)       cmd_health ;;
  help|--help|-h) cmd_help ;;
  *)
    error "Unknown command: $COMMAND. Run './deploy.sh help' for usage."
    ;;
esac
