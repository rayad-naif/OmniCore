'use strict';

/**
 * stores/worker.js — background jobs for online stores (store_jobs).
 *
 * Long operations run as small steps that re-schedule themselves (e.g. provision:
 * content → submit to the store server → wait → finalize), so restarts and several
 * API instances are safe: jobs are claimed with FOR UPDATE SKIP LOCKED and a lease.
 * Periodic: order sync every 15 minutes, store-server health every 5 minutes.
 */

const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const logger = require('../utils/logger');
const { sealJson, openJson } = require('../lib/secretBox');
const { ensureSchema } = require('./schema');
const svc = require('./service');
const design = require('./design');
const agent = require('./agentClient');
const cloudflare = require('./cloudflare');

const MAX_ATTEMPTS = { payment_callback: 10, sync: 3, default: 5 };
const WAIT_LIMIT_MS = {
  provision: 45 * 60 * 1000,
  redesign: 20 * 60 * 1000,
  delete: 30 * 60 * 1000,
};

async function storeRow(id) {
  const { rows } = await pool.query(`SELECT * FROM stores WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function setStore(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await pool.query(
    `UPDATE stores SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [
      id,
      ...keys.map((k) =>
        fields[k] !== null && typeof fields[k] === 'object'
          ? JSON.stringify(fields[k])
          : fields[k],
      ),
    ],
  );
}

/** Waits for the agent's current job on a store. Returns the agent state when finished. */
async function agentJobDone(host, agentId) {
  const st = await agent.call(host, 'GET', `/v1/stores/${agentId}`);
  if (st.job && ['queued', 'running'].includes(st.job.status))
    return { pending: true, st };
  return { pending: false, st };
}

// ── Handlers: return { done } | { again: ms, payload? } ; throw to retry ─────
const handlers = {
  async provision(job, s, log) {
    const p = job.payload;
    const host = await svc.hostById(s.host_id);
    if (!host) throw new Error('Store server missing');

    if (p.phase === 'content') {
      const ws = await svc.workspace(s.tenant_id);
      const { content, source, warning } = await design.generateContent({
        tenantId: s.tenant_id,
        aiEnabled: Boolean(ws?.ai && p.use_ai !== false),
        template: s.template,
        name: s.name,
        description: s.business_description,
        city: p.city,
        email: s.admin_email,
        currency: s.currency,
      });
      if (warning) log(warning);
      const adminUser = `admin_${crypto.randomBytes(3).toString('hex')}`;
      const designDoc = {
        content,
        content_source: source,
        country: p.country,
        city: p.city,
        phone: p.phone,
        admin_sealed: sealJson({
          user: adminUser,
          password: crypto.randomBytes(15).toString('base64url'),
        }),
      };
      await setStore(s.id, { design: designDoc });
      log(`Content written (${source === 'ai' ? 'AI' : 'template'})`);
      return {
        again: 0,
        payload: { ...p, phase: 'submit', started: Date.now() },
      };
    }

    if (p.phase === 'submit') {
      const fresh = await storeRow(s.id);
      const admin = openJson(fresh.design.admin_sealed);
      try {
        await agent.call(host, 'POST', '/v1/stores', {
          id: fresh.agent_store_id,
          hostnames: [fresh.subdomain],
          primary: fresh.subdomain,
          acme_hosts: [],
          title: fresh.name,
          admin: {
            user: admin.user,
            email: fresh.admin_email || `owner@${fresh.subdomain}`,
            password: admin.password,
          },
          spec: await svc.agentSpec(fresh),
        });
      } catch (err) {
        if (err.status !== 409) throw err;
        // 409 is fine only when the server already has this very store (a retried submit).
        const existing = await agent
          .call(host, 'GET', `/v1/stores/${fresh.agent_store_id}`)
          .catch(() => null);
        if (!existing) throw Object.assign(err, { fatal: true });
      }
      log(`Submitted to store server ${host.name}`);
      return {
        again: 8000,
        payload: { ...p, phase: 'wait', started: p.started || Date.now() },
      };
    }

    if (p.phase === 'wait') {
      const { pending, st } = await agentJobDone(host, s.agent_store_id);
      if (pending) {
        if (Date.now() - (p.started || Date.now()) > WAIT_LIMIT_MS.provision)
          throw Object.assign(new Error('Setup took too long'), {
            fatal: true,
          });
        if (st.job?.step && st.job.step !== p.last_step)
          log(`Store server: ${st.job.step}`);
        return { again: 8000, payload: { ...p, last_step: st.job?.step } };
      }
      if (st.status !== 'active') {
        await setStore(s.id, {
          status: 'failed',
          error: st.job?.error || 'Setup failed on the store server',
        });
        throw Object.assign(new Error(st.job?.error || 'Setup failed'), {
          fatal: true,
        });
      }
      await setStore(s.id, {
        status: 'active',
        error: null,
        site_url: st.result.site_url,
        wc_keys_sealed: sealJson({
          consumer_key: st.result.wc_consumer_key,
          consumer_secret: st.result.wc_consumer_secret,
        }),
        plugin_seen_at: new Date().toISOString(),
        plugin_version: 'hosted',
        stats: {
          products: undefined,
          wp_version: st.result.wp_version,
          wc_version: st.result.wc_version,
        },
      });
      const live = await storeRow(s.id);
      await svc
        .setupWebhooks(live)
        .catch((err) => log(`Webhooks: ${err.message}`));
      await svc.enqueue(live, 'sync', { full: true }, 2000);
      log(`Live at ${st.result.site_url}`);
      try {
        require('../services/socket.service').broadcastToTenant(
          s.tenant_id,
          'store:ready',
          { store_id: s.id, name: s.name, url: st.result.site_url },
        );
      } catch {}
      return { done: true };
    }
    throw new Error(`Unknown phase ${p.phase}`);
  },

  async redesign(job, s, log) {
    const p = job.payload;
    const host = await svc.hostById(s.host_id);
    if (!p.phase) {
      let mode = 'design';
      if (p.settings_only) mode = 'settings';
      else if (p.rewrite) {
        const ws = await svc.workspace(s.tenant_id);
        const { content, source, warning } = await design.generateContent({
          tenantId: s.tenant_id,
          aiEnabled: Boolean(ws?.ai && p.use_ai !== false),
          template: s.template,
          name: s.name,
          description: s.business_description,
          city: s.design?.city,
          email: s.admin_email,
          currency: s.currency,
        });
        if (warning) log(warning);
        await setStore(s.id, {
          design: { ...(s.design || {}), content, content_source: source },
        });
        log(`Content rewritten (${source === 'ai' ? 'AI' : 'template'})`);
      }
      const fresh = await storeRow(s.id);
      await agent.call(
        host,
        'POST',
        `/v1/stores/${fresh.agent_store_id}/apply`,
        { spec: await svc.agentSpec(fresh), mode },
      );
      return {
        again: 5000,
        payload: { ...p, phase: 'wait', started: Date.now() },
      };
    }
    const { pending, st } = await agentJobDone(host, s.agent_store_id);
    if (pending) {
      if (Date.now() - p.started > WAIT_LIMIT_MS.redesign)
        throw Object.assign(new Error('Design update took too long'), {
          fatal: true,
        });
      return { again: 5000 };
    }
    if (st.job?.status === 'failed')
      throw Object.assign(new Error(st.job.error || 'Design update failed'), {
        fatal: true,
      });
    log('Design applied');
    return { done: true };
  },

  async domain_check(job, s, log) {
    const p = job.payload;
    if (!s.custom_domain || s.domain_status === 'active') return { done: true };
    const host = await svc.hostById(s.host_id);
    let ready = false;
    let detail = s.domain_detail || {};
    if (detail.mode === 'cloudflare' && detail.cf_id) {
      const cf = await cloudflare.getHostname(detail.cf_id);
      detail = {
        ...detail,
        status: cf.status,
        ssl_status: cf.ssl_status,
        errors: cf.errors,
        records: [detail.records?.[0], ...cf.records].filter(Boolean),
      };
      ready =
        cf.status === 'active' &&
        (await svc.dnsPointsHere(s.custom_domain, host));
    } else {
      ready = await svc.dnsPointsHere(s.custom_domain, host);
      detail = { ...detail, checked_at: new Date().toISOString() };
    }
    if (!ready) {
      const age = Date.now() - (p.started || Date.now());
      if (age > 72 * 3600 * 1000) {
        await setStore(s.id, {
          domain_status: 'error',
          domain_detail: {
            ...detail,
            error:
              'DNS was not pointed at the store within 72 hours. Check the records and try again.',
          },
        });
        return { done: true };
      }
      await setStore(s.id, { domain_detail: detail });
      return { again: age < 30 * 60 * 1000 ? 60000 : 10 * 60000 };
    }
    await agent.call(host, 'PUT', `/v1/stores/${s.agent_store_id}/domains`, {
      hostnames: [s.subdomain, s.custom_domain],
      primary: s.custom_domain,
      acme_hosts: [s.custom_domain],
    });
    await setStore(s.id, {
      domain_status: 'active',
      domain_detail: { ...detail, activated_at: new Date().toISOString() },
      site_url: `${svc.siteScheme(host)}://${s.custom_domain}`,
    });
    log(`${s.custom_domain} is live`);
    return { done: true };
  },

  async delete(job, s, log) {
    const p = job.payload;
    const host = await svc.hostById(s.host_id);
    if (p.phase === 'submit') {
      if (host)
        await agent
          .call(host, 'DELETE', `/v1/stores/${s.agent_store_id}`, {
            backup: true,
          })
          .catch((err) => {
            if (err.status !== 404) throw err;
          });
      return {
        again: 5000,
        payload: { ...p, phase: 'wait', started: Date.now() },
      };
    }
    if (host) {
      const st = await agent
        .call(host, 'GET', `/v1/stores/${s.agent_store_id}`)
        .catch((err) =>
          err.status === 404 ? { status: 'deleted' } : Promise.reject(err),
        );
      if (st.status !== 'deleted') {
        if (st.job?.status === 'failed')
          throw Object.assign(new Error(st.job.error || 'Delete failed'), {
            fatal: true,
          });
        if (Date.now() - p.started > WAIT_LIMIT_MS.delete)
          throw Object.assign(new Error('Delete took too long'), {
            fatal: true,
          });
        return { again: 5000 };
      }
    }
    if (!host)
      log(
        'The store server is no longer registered: remove the store from it by hand.',
      );
    await setStore(s.id, {
      status: 'deleted',
      deleted_at: new Date().toISOString(),
    });
    log('Store deleted (a final backup is kept on the store server)');
    return { done: true };
  },

  async sync(job, s) {
    if (s.deleted_at || !s.wc_keys_sealed) return { done: true };
    try {
      await svc.syncStore(s, { full: Boolean(job.payload.full) });
    } catch (err) {
      await setStore(s.id, { sync_error: String(err.message).slice(0, 500) });
      throw err;
    }
    return { done: true };
  },

  async payment_callback(job, s, log) {
    const res = await svc.sendPaymentCallback(s, job.payload);
    log(
      `Order ${job.payload.order_id} → ${job.payload.event} (store says ${res.status || 'ok'})`,
    );
    return { done: true };
  },
};

// ── Runner ───────────────────────────────────────────────────────────────────
async function claimJob() {
  const { rows } = await pool.query(
    `UPDATE store_jobs SET status = 'running', lease_until = NOW() + INTERVAL '5 minutes', attempts = attempts + 1, updated_at = NOW()
      WHERE id = (
        SELECT id FROM store_jobs
         WHERE (status = 'queued' AND run_after <= NOW()) OR (status = 'running' AND lease_until < NOW())
         ORDER BY run_after ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  return rows[0] || null;
}

async function runJob(job) {
  const lines = [];
  const log = (msg) =>
    lines.push({
      at: new Date().toISOString(),
      msg: String(msg).slice(0, 500),
    });
  const s = await storeRow(job.store_id);
  const finish = async (fields) => {
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 3}`);
    await pool.query(
      `UPDATE store_jobs SET ${sets.join(', ')}, log = (log || $2::jsonb), updated_at = NOW() WHERE id = $1`,
      [
        job.id,
        JSON.stringify(lines),
        ...Object.values(fields).map((v) =>
          v && typeof v === 'object' ? JSON.stringify(v) : v,
        ),
      ],
    );
  };
  if (!s)
    return finish({
      status: 'failed',
      error: 'Store not found',
      lease_until: null,
    });
  const handler = handlers[job.kind];
  if (!handler)
    return finish({
      status: 'failed',
      error: `Unknown job ${job.kind}`,
      lease_until: null,
    });
  try {
    const r = await handler(job, s, log);
    if (r?.again !== undefined) {
      return finish({
        status: 'queued',
        run_after: new Date(Date.now() + r.again).toISOString(),
        payload: r.payload || job.payload,
        attempts: 0,
        lease_until: null,
      });
    }
    return finish({ status: 'done', lease_until: null, error: null });
  } catch (err) {
    log(`Error: ${err.message}`);
    const max = MAX_ATTEMPTS[job.kind] || MAX_ATTEMPTS.default;
    if (err.fatal || job.attempts >= max) {
      if (job.kind === 'provision')
        await setStore(s.id, {
          status: 'failed',
          error: String(err.message).slice(0, 1000),
        });
      if (job.kind === 'delete')
        await setStore(s.id, {
          status: 'error',
          error: String(err.message).slice(0, 1000),
        });
      logger.warn(
        { storeId: s.id, kind: job.kind, err: err.message },
        'store_job_failed',
      );
      return finish({
        status: 'failed',
        error: String(err.message).slice(0, 1000),
        lease_until: null,
      });
    }
    const backoff = Math.min(30 * 60 * 1000, 2 ** job.attempts * 15000);
    return finish({
      status: 'queued',
      error: String(err.message).slice(0, 1000),
      run_after: new Date(Date.now() + backoff).toISOString(),
      lease_until: null,
    });
  }
}

async function claimLease(name, ms) {
  const holder = `${process.pid}`;
  const { rows } = await pool.query(
    `INSERT INTO store_locks (name, holder, lease_until) VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval)
     ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, lease_until = EXCLUDED.lease_until
       WHERE store_locks.lease_until < NOW()
     RETURNING name`,
    [name, holder, String(ms)],
  );
  return rows.length > 0;
}

async function periodic() {
  if (await claimLease('stores:sync', 14 * 60 * 1000)) {
    const { rows } = await pool.query(
      `SELECT s.* FROM stores s
        WHERE s.deleted_at IS NULL AND s.status = 'active' AND s.wc_keys_sealed IS NOT NULL
          AND (s.last_sync_at IS NULL OR s.last_sync_at < NOW() - INTERVAL '15 minutes')
          AND NOT EXISTS (SELECT 1 FROM store_jobs j WHERE j.store_id = s.id AND j.kind = 'sync' AND j.status IN ('queued','running'))
        LIMIT 200`,
    );
    for (const s of rows) await svc.enqueue(s, 'sync', { full: false });
  }
  if (await claimLease('stores:health', 4 * 60 * 1000)) {
    const { rows } = await pool.query(`SELECT * FROM store_hosts WHERE active`);
    for (const h of rows) {
      try {
        const health = await agent.call(h, 'GET', '/v1/health', undefined, {
          timeoutMs: 15000,
        });
        await pool.query(
          `UPDATE store_hosts SET last_seen_at = NOW(), last_health = $2 WHERE id = $1`,
          [h.id, JSON.stringify(health)],
        );
      } catch (err) {
        await pool.query(
          `UPDATE store_hosts SET last_health = $2 WHERE id = $1`,
          [h.id, JSON.stringify({ ok: false, error: err.message })],
        );
      }
    }
  }
}

let timer = null;
function startStoresWorker() {
  if (timer || process.env.STORES_WORKER === 'false') return;
  let busy = false;
  let lastPeriodic = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await ensureSchema();
      for (let i = 0; i < 5; i += 1) {
        const job = await claimJob();
        if (!job) break;
        await runJob(job);
      }
      if (Date.now() - lastPeriodic > 60 * 1000) {
        lastPeriodic = Date.now();
        await periodic();
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'stores_worker_tick_failed');
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, Number(process.env.STORES_TICK_MS || 3000));
  timer.unref?.();
  setTimeout(tick, 2000).unref?.();
}

module.exports = { startStoresWorker, runJob, claimJob, handlers };
