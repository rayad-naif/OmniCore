FROM node:24-bookworm-slim AS base

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN chown -R node:node /app
USER node

FROM base AS api

RUN pnpm --filter @workspace/api-server run build
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]

FROM base AS dashboard

ARG VITE_API_URL=http://localhost:8080/api
ARG VITE_PADDLE_CLIENT_TOKEN
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PADDLE_CLIENT_TOKEN=${VITE_PADDLE_CLIENT_TOKEN}
RUN pnpm --filter @workspace/dashboard run build
ENV PORT=5173
EXPOSE 5173
CMD ["pnpm", "--filter", "@workspace/dashboard", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
# ── All-in-one image (default target) ────────────────────────────────────────
# API + dashboard + marketing site in one container, with automatic migrations
# and first super admin creation (SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD).
#   docker build -t omnicore --build-arg VITE_PADDLE_CLIENT_TOKEN=test_… .
#   docker run -p 8080:8080 -e DATABASE_URL=… -e JWT_SECRET=… -e GEMINI_API_KEY=… omnicore
FROM base AS all

ARG VITE_PADDLE_CLIENT_TOKEN
ENV VITE_PADDLE_CLIENT_TOKEN=${VITE_PADDLE_CLIENT_TOKEN}
ENV VITE_API_URL=/api
RUN PORT=5173 BASE_PATH=/ pnpm -r --if-present run build
ENV NODE_ENV=production
ENV PORT=8080
ENV SERVE_STATIC=true
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:8080/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node artifacts/api-server/scripts/migrate.mjs && exec node --enable-source-maps artifacts/api-server/dist/index.mjs"]
