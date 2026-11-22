#!/usr/bin/env node
/**
 * vercel-build.mjs — builds the marketing site and dashboard for Vercel and
 * writes a Build Output API v3 bundle (.vercel/output).
 *
 * Vercel only hosts the two static frontends. The API (Express + Socket.io +
 * background workers) must run elsewhere — Render, OCI, Docker — and is proxied
 * through Vercel so cookies and the dashboard stay same-origin:
 *
 *   OMNICORE_API_ORIGIN=https://omnicore-api.onrender.com   (required)
 *
 * Real-time updates fall back to HTTP long-polling through the proxy, because
 * Vercel rewrites do not carry WebSockets.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = (process.env.OMNICORE_API_ORIGIN || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(api)) {
  console.error(
    'OMNICORE_API_ORIGIN must be set to the https:// origin of your OmniCore API (e.g. https://omnicore-api.onrender.com)',
  );
  process.exit(1);
}

const run = (cmd, env = {}) =>
  execSync(cmd, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

run('pnpm --filter @workspace/marketing-site run build', {
  PORT: '5173',
  BASE_PATH: '/',
});
run('pnpm --filter @workspace/dashboard run build', {
  PORT: '5174',
  BASE_PATH: '/dashboard/',
  VITE_API_URL: '/api',
});
run('pnpm --filter @workspace/hrms run build');

const out = path.join(root, '.vercel/output');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'static/dashboard'), { recursive: true });
mkdirSync(path.join(out, 'static/hrms'), { recursive: true });
cpSync(
  path.join(root, 'artifacts/marketing-site/dist/public'),
  path.join(out, 'static'),
  { recursive: true },
);
cpSync(
  path.join(root, 'artifacts/dashboard/dist/public'),
  path.join(out, 'static/dashboard'),
  { recursive: true },
);
cpSync(path.join(root, 'artifacts/hrms/dist'), path.join(out, 'static/hrms'), {
  recursive: true,
});

const immutable = { 'cache-control': 'public, max-age=31536000, immutable' };
writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: `${api}/api/$1` },
        { src: '^/pay/(.*)$', dest: `${api}/pay/$1` },
        {
          src: '^/(dashboard/|hrms/)?assets/(.*)$',
          headers: immutable,
          continue: true,
        },
        {
          src: '^/dashboard$',
          status: 301,
          headers: { Location: '/dashboard/' },
        },
        { src: '^/hrms$', status: 301, headers: { Location: '/hrms/' } },
        { handle: 'filesystem' },
        { src: '^/dashboard/.*$', dest: '/dashboard/index.html' },
        { src: '^/hrms/.*$', dest: '/hrms/index.html' },
        { src: '^/([^.]+?)/?$', dest: '/$1.html', check: true },
        { src: '^/.*$', status: 404, dest: '/404.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output ready → .vercel/output (API proxied to ${api})`);
