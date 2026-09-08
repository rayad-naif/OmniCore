# Local development and clean-clone verification

## Fastest complete startup

The supported isolated local path uses Docker Compose. It provides PostgreSQL 15
with `pgvector`, loads the application schema on first boot, and starts the API
and dashboard with non-production placeholder values:

```bash
docker compose up --build
```

Open the dashboard at `http://localhost:15173` and confirm the API health check:

```bash
curl http://localhost:18080/api/healthz
```

The credentials in `docker-compose.yml` are intentionally local-only. Do not
reuse them in a shared or production environment. To reset the local database:

```bash
docker compose down -v
```

The Compose defaults use ports `15173` (dashboard), `18080` (API), and `15432`
(PostgreSQL) to avoid clashing with local Vite or API processes. Override them
with `DASHBOARD_PORT`, `API_PORT`, and `POSTGRES_PORT` if needed.

## Native development

1. Start PostgreSQL 15 with `pgvector` and apply `artifacts/api-server/schema.sql`.
2. Copy `.env.example` to `.env` and provide values for `DATABASE_URL`,
   `JWT_SECRET`, and `GEMINI_API_KEY`.
   Set `VITE_PADDLE_CLIENT_TOKEN` when testing Paddle checkout; Vite reads the
   root `.env` for both frontend artifacts.
3. Install dependencies with `pnpm install --frozen-lockfile`. This repository
   pins pnpm 10.26.1 in `package.json` and supports Node.js 24.
4. Run the API and dashboard in separate terminals from the repository root.
   The API is a Node process, so explicitly export the copied root `.env`
   before starting it:

   ```bash
   # Terminal 1
   set -a
   . ./.env
   set +a
   pnpm --filter @workspace/api-server run dev

   # Terminal 2
   pnpm --filter @workspace/dashboard run dev
   ```

   The API listens on `http://localhost:5000`; the dashboard listens on
   `http://localhost:5174/dashboard/`. Keep `VITE_API_URL=/api` so Vite proxies
   API and Socket.io traffic to port 5000 during native development.

## Quality commands

Run these before opening a pull request:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm audit --prod --audit-level=high
```

GitHub Actions runs the same frozen-install, lint, formatting, typecheck,
coverage, build, and production-dependency audit checks on pushes to `main` and
pull requests.
