'use strict';

/**
 * voice/store.js
 * PostgreSQL implementation of the AI Call Center document-store API
 * (originally MongoDB), so the ported services run unchanged on OmniCore's
 * database.
 *
 *   get(col, id) · find(col, filter, {sort, limit}) · put(col, doc)
 *   patch(col, id, set, {push, inc, upsert}) · remove(col, id)
 *   claim(key, ttlMs) · log(companyId, type, detail, extra) · events(filter, limit)
 *
 * Filters support the subset the services use: equality, $in, $nin, $ne,
 * $gt, $gte, $lt, $lte, $exists, on dotted paths. Every value is bound as a
 * query parameter; paths are validated against a strict pattern.
 */

const { pool } = require('../lib/db');
const { getPath, setPath } = require('./store/match');

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const RETENTION = {
  calls: Number(process.env.CALL_RETENTION_DAYS || 365),
  leads: 90,
  events: 180,
  webhookDeliveries: 30,
};

let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS voice_docs (
           col        TEXT NOT NULL,
           id         TEXT NOT NULL,
           doc        JSONB NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (col, id)
         );
         CREATE INDEX IF NOT EXISTS idx_voice_docs_company  ON voice_docs (col, (doc->>'companyId'));
         CREATE INDEX IF NOT EXISTS idx_voice_docs_location ON voice_docs (col, (doc->>'locationId'));
         CREATE INDEX IF NOT EXISTS idx_voice_docs_status   ON voice_docs (col, (doc->>'status'));
         CREATE INDEX IF NOT EXISTS idx_voice_docs_tenant   ON voice_docs (col, (doc->>'tenantId'));
         CREATE TABLE IF NOT EXISTS voice_events (
           id         BIGSERIAL PRIMARY KEY,
           at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           company_id TEXT,
           doc        JSONB NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_voice_events_company ON voice_events (company_id, at DESC);
         CREATE TABLE IF NOT EXISTS voice_locks (
           key   TEXT PRIMARY KEY,
           until BIGINT NOT NULL
         );`,
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

function pathSql(path, column = 'doc') {
  if (!PATH.test(path)) throw new Error(`Invalid field path ${path}`);
  const parts = path.split('.').map((p) => p.replace(/'/g, ''));
  return {
    json: `${column} #> '{${parts.join(',')}}'`,
    text: `${column} #>> '{${parts.join(',')}}'`,
  };
}

/** Translates a Mongo-style filter into SQL. Returns { sql, params }. */
function buildWhere(filter, params, column = 'doc', idColumn = 'id') {
  const clauses = [];
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  for (const [key, cond] of Object.entries(filter || {})) {
    const isId = key === '_id' && idColumn;
    const p = isId
      ? { json: `to_jsonb(${idColumn})`, text: idColumn }
      : pathSql(key, column);
    const one = (op, v) => {
      if (v === null || v === undefined) {
        if (op === '=')
          return `(${p.json} IS NULL OR ${p.json} = 'null'::jsonb)`;
        if (op === '<>')
          return `(${p.json} IS NOT NULL AND ${p.json} <> 'null'::jsonb)`;
        return 'FALSE';
      }
      if (typeof v === 'number')
        return `(${p.text})::numeric ${op} ${bind(v)}::numeric`;
      if (typeof v === 'boolean')
        return `${p.json} ${op} ${bind(JSON.stringify(v))}::jsonb`;
      if (v instanceof Date) return `${p.text} ${op} ${bind(v.toISOString())}`;
      return `${p.text} ${op} ${bind(String(v))}`;
    };
    if (
      cond &&
      typeof cond === 'object' &&
      !Array.isArray(cond) &&
      !(cond instanceof Date)
    ) {
      for (const [op, v] of Object.entries(cond)) {
        switch (op) {
          case '$in':
          case '$nin': {
            const list = (v || []).filter((x) => x !== null && x !== undefined);
            if (!list.length) {
              clauses.push(op === '$in' ? 'FALSE' : 'TRUE');
              break;
            }
            const numeric = list.every((x) => typeof x === 'number');
            const expr = numeric ? `(${p.text})::numeric` : p.text;
            const arr = bind(numeric ? list : list.map(String));
            clauses.push(
              op === '$in'
                ? `${expr} = ANY(${arr}${numeric ? '::numeric[]' : '::text[]'})`
                : `(${p.text} IS NULL OR NOT (${expr} = ANY(${arr}${numeric ? '::numeric[]' : '::text[]'})))`,
            );
            break;
          }
          case '$ne':
            clauses.push(
              v === null || v === undefined
                ? one('<>', null)
                : `(${p.json} IS NULL OR NOT (${one('=', v)}))`,
            );
            break;
          case '$gt':
            clauses.push(one('>', v));
            break;
          case '$gte':
            clauses.push(one('>=', v));
            break;
          case '$lt':
            clauses.push(one('<', v));
            break;
          case '$lte':
            clauses.push(one('<=', v));
            break;
          case '$exists':
            clauses.push(v ? `${p.json} IS NOT NULL` : `${p.json} IS NULL`);
            break;
          default:
            throw new Error(`Unsupported operator ${op}`);
        }
      }
    } else {
      clauses.push(one('=', cond));
    }
  }
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

function orderBy(sort, column = 'doc', idColumn = 'id') {
  if (!sort || !Object.keys(sort).length) return '';
  const parts = Object.entries(sort).map(([k, dir]) => {
    const d = dir < 0 ? 'DESC' : 'ASC';
    if (k === '_id') return `${idColumn} ${d}`;
    const p = pathSql(k, column);
    return `(CASE WHEN jsonb_typeof(${p.json}) = 'number' THEN (${p.text})::numeric END) ${d} NULLS LAST, ${p.text} ${d} NULLS LAST`;
  });
  return `ORDER BY ${parts.join(', ')}`;
}

const nowIso = () => new Date().toISOString();
const withId = (row) => (row ? { ...row.doc, _id: row.id } : null);

function createPgStore() {
  return {
    kind: 'postgres',
    ensureSchema,

    async get(col, id) {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT id, doc FROM voice_docs WHERE col = $1 AND id = $2`,
        [col, String(id)],
      );
      return withId(rows[0]);
    },

    async find(col, filter, opts = {}) {
      await ensureSchema();
      const params = [col];
      const where = buildWhere(filter, params);
      const limit = opts.limit
        ? `LIMIT ${Math.max(1, Math.min(10000, Number(opts.limit) || 100))}`
        : '';
      const { rows } = await pool.query(
        `SELECT id, doc FROM voice_docs WHERE col = $1 AND ${where} ${orderBy(opts.sort)} ${limit}`,
        params,
      );
      return rows.map(withId);
    },

    async put(col, doc) {
      await ensureSchema();
      doc.updatedAt = nowIso();
      const { _id, ...rest } = doc;
      await pool.query(
        `INSERT INTO voice_docs (col, id, doc, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (col, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = NOW()`,
        [col, String(_id), rest],
      );
      return doc;
    },

    async patch(col, id, set, ops = {}) {
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT doc FROM voice_docs WHERE col = $1 AND id = $2 FOR UPDATE`,
          [col, String(id)],
        );
        let doc = rows[0]?.doc;
        if (!doc) {
          if (!ops.upsert) {
            await client.query('ROLLBACK');
            return null;
          }
          doc = { createdAt: nowIso() };
        }
        for (const [k, v] of Object.entries(set || {})) setPath(doc, k, v);
        for (const [k, by] of Object.entries(ops.inc || {}))
          setPath(doc, k, (Number(getPath(doc, k)) || 0) + by);
        for (const [k, p] of Object.entries(ops.push || {})) {
          const cur = Array.isArray(getPath(doc, k)) ? getPath(doc, k) : [];
          let next = p && p.each ? cur.concat(p.each) : cur.concat([p]);
          if (p && p.each && p.slice)
            next = p.slice < 0 ? next.slice(p.slice) : next.slice(0, p.slice);
          setPath(doc, k, next);
        }
        doc.updatedAt = nowIso();
        delete doc._id;
        await client.query(
          `INSERT INTO voice_docs (col, id, doc, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (col, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = NOW()`,
          [col, String(id), doc],
        );
        await client.query('COMMIT');
        return { ...doc, _id: String(id) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async remove(col, id) {
      await ensureSchema();
      await pool.query(`DELETE FROM voice_docs WHERE col = $1 AND id = $2`, [
        col,
        String(id),
      ]);
    },

    /** Lease: only one caller across all instances wins per ttl window. */
    async claim(key, ttlMs) {
      await ensureSchema();
      const now = Date.now();
      const { rows } = await pool.query(
        `INSERT INTO voice_locks (key, until) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until WHERE voice_locks.until < $3
         RETURNING key`,
        [key, now + ttlMs, now],
      );
      return rows.length > 0;
    },

    async log(companyId, type, detail, extra) {
      await ensureSchema();
      await pool.query(
        `INSERT INTO voice_events (company_id, doc) VALUES ($1, $2)`,
        [
          companyId || null,
          {
            ...(extra || {}),
            companyId: companyId || null,
            type,
            detail: detail || '',
          },
        ],
      );
    },

    async events(filter, limit) {
      await ensureSchema();
      const params = [];
      const where = buildWhere(filter, params, 'doc', null);
      const { rows } = await pool.query(
        `SELECT at, doc FROM voice_events WHERE ${where} ORDER BY at DESC LIMIT ${Math.min(Number(limit) || 50, 500)}`,
        params,
      );
      return rows.map((r) => ({ ...r.doc, at: new Date(r.at).toISOString() }));
    },

    /** Retention, replacing Mongo TTL indexes. */
    async purge() {
      await ensureSchema();
      for (const [col, days] of Object.entries(RETENTION)) {
        if (col === 'events') {
          await pool.query(
            `DELETE FROM voice_events WHERE at < NOW() - ($1 || ' days')::interval`,
            [String(days)],
          );
        } else if (days > 0) {
          await pool.query(
            `DELETE FROM voice_docs WHERE col = $1 AND created_at < NOW() - ($2 || ' days')::interval`,
            [col, String(days)],
          );
        }
      }
      await pool.query(
        `DELETE FROM voice_docs WHERE col = 'takeovers' AND (doc->>'expiresAt') < $1`,
        [nowIso()],
      );
    },
  };
}

module.exports = { createPgStore, buildWhere, orderBy };
