# Contributing

## Development setup

Use Node.js 24 and pnpm 10.26.1. Enable Corepack if pnpm is not already
available, then install the locked dependency graph:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` for native development. It contains placeholders
only; do not commit a populated `.env` file. See
[local development](docs/local-development.md) for the database and service
setup options.

## Before opening a pull request

Keep changes focused, add or update tests for behavior changes, and run:

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm audit --prod --audit-level=high
```

CI runs these commands with a frozen lockfile. Use pnpm for dependency changes
and commit both `package.json` and `pnpm-lock.yaml` when dependencies change.

## Lint warning ratchet

Lint runs with a maximum of 93 warnings, the current baseline. Do not raise
this ceiling: fix warnings in files you touch so the baseline can only move
down. ESLint's error-level correctness and hook rules remain blocking.

## Coverage ratchet

Coverage measures the production API controllers, libraries, services, and
widget code, plus dashboard libraries and sections. The current broad baseline
is 6% branches, 9% functions, 5% lines, and 6% statements. Keep these
thresholds at or above the measured baseline; add tests when changing covered
production code rather than lowering them.

## Pull requests

Describe the user-facing impact, testing performed, and any required
configuration or migration steps. Do not include credentials, customer data, or
other sensitive values in code, commits, screenshots, or pull request text.
