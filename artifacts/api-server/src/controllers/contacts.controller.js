'use strict';

/**
 * contacts.controller.js
 * Atelier OmniCore — Visitor Contacts
 *
 * GET /api/contacts                          paginated visitor list for tenant
 * GET /api/contacts/:visitorId/conversations conversation list for one visitor
 */

const { Router }      = require('express');
const { requireAuth, requirePermissionByMethod, applyWorkspaceOverride } = require('../middleware/auth');
const { pool }        = require('../lib/db');
const logger          = require('../utils/logger');

const router = Router();
router.use(requireAuth);
router.use(applyWorkspaceOverride);
router.use(requirePermissionByMethod('contacts'));

const PAGE_LIMIT = 25;
function tenantId(req) { return req.agent.tenantId; }

/** Escape a CSV field: wrap in quotes, double any internal quotes. */
function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── GET /api/contacts/export ───────────────────────────────────────────────────
router.get('/export', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { search, brand_id } = req.query;

    const conditions = ['v.tenant_id = $1'];
    const values     = [tid];
    let i = 2;

    if (brand_id) {
      conditions.push(`v.brand_id = $${i}`);
      values.push(brand_id); i++;
    }
    if (search) {
      const q = `%${search}%`;
      conditions.push(`(v.display_name ILIKE $${i} OR v.email ILIKE $${i})`);
      values.push(q); i++;
    }

    const where = conditions.join(' AND ');

    const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-store');

    const HEADER = 'Name,Email,Brand,Location,Last Seen,First Seen,Conversations\r\n';
    res.write(HEADER);

    const CHUNK = 500;
    let offset = 0;
    let rowsWritten = 0;

    while (true) {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(v.display_name, v.email, 'Visitor') AS display_name,
           v.email,
           b.brand_name,
           v.location_city,
           v.last_seen_at,
           v.created_at,
           COUNT(c.id)::int AS conversation_count
         FROM visitors v
         LEFT JOIN brands b        ON b.id = v.brand_id
         LEFT JOIN conversations c ON c.visitor_id = v.id
         WHERE ${where}
         GROUP BY v.id, b.brand_name
         ORDER BY v.last_seen_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...values, CHUNK, offset]
      );

      if (rows.length === 0) break;

      for (const row of rows) {
        const line = [
          csvField(row.display_name),
          csvField(row.email),
          csvField(row.brand_name),
          csvField(row.location_city),
          csvField(row.last_seen_at ? new Date(row.last_seen_at).toISOString() : ''),
          csvField(row.created_at   ? new Date(row.created_at).toISOString()   : ''),
          csvField(row.conversation_count),
        ].join(',') + '\r\n';
        res.write(line);
      }

      rowsWritten += rows.length;
      if (rows.length < CHUNK) break;
      offset += CHUNK;
    }

    logger.info({ rowsWritten }, 'contacts_export_csv');
    res.end();
  } catch (err) { next(err); }
});

// ── GET /api/contacts ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { search, brand_id, page: pageQ, limit: limitQ } = req.query;
    const page   = Math.max(1, parseInt(pageQ) || 1);
    const limit  = Math.min(100, parseInt(limitQ) || PAGE_LIMIT);
    const offset = (page - 1) * limit;

    const conditions = ['v.tenant_id = $1'];
    const values     = [tid];
    let i = 2;

    if (brand_id) {
      conditions.push(`v.brand_id = $${i}`);
      values.push(brand_id); i++;
    }
    if (search) {
      const q = `%${search}%`;
      conditions.push(`(v.display_name ILIKE $${i} OR v.email ILIKE $${i})`);
      values.push(q); i++;
    }

    const where = conditions.join(' AND ');

    const [{ rows: contacts }, { rows: countRow }] = await Promise.all([
      pool.query(
        `SELECT
           v.id,
           COALESCE(v.display_name, v.email, 'Visitor') AS display_name,
           v.email,
           v.location_city,
           v.last_seen_at,
           v.created_at,
           b.brand_name,
           v.brand_id,
           COUNT(c.id)::int AS conversation_count
         FROM visitors v
         LEFT JOIN brands b       ON b.id = v.brand_id
         LEFT JOIN conversations c ON c.visitor_id = v.id
         WHERE ${where}
         GROUP BY v.id, b.brand_name, v.brand_id
         ORDER BY v.last_seen_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...values, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM visitors v WHERE ${where}`,
        values
      ),
    ]);

    const total = parseInt(countRow[0].count, 10);
    return res.json({
      contacts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/contacts/:visitorId/conversations ────────────────────────────────
router.get('/:visitorId/conversations', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { visitorId } = req.params;

    const { rows: vRows } = await pool.query(
      'SELECT id FROM visitors WHERE id = $1 AND tenant_id = $2',
      [visitorId, tid]
    );
    if (!vRows[0]) return res.status(404).json({ error: 'Visitor not found' });

    const { rows } = await pool.query(
      `SELECT
         c.id, c.status, c.channel, c.subject, c.priority,
         c.created_at, c.updated_at, c.csat_score, c.referrer_url,
         b.brand_name,
         a.name AS agent_name
       FROM conversations c
       LEFT JOIN brands b ON b.id = c.brand_id
       LEFT JOIN agents  a ON a.id = c.assigned_agent_id
       WHERE c.visitor_id = $1
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [visitorId]
    );

    logger.info({ visitorId }, 'contacts_visitor_history_fetched');
    return res.json(rows);
  } catch (err) { next(err); }
});

// ── DELETE /api/contacts/:visitorId ───────────────────────────────────────────
// Admin-only. Permanently removes a contact (visitor) and all of their
// conversations + messages (cascade via FK ON DELETE CASCADE).
router.delete('/:visitorId', async (req, res, next) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — admin only' });
    }
    const tid = tenantId(req);
    const { rows } = await pool.query(
      'DELETE FROM visitors WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.visitorId, tid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contact not found' });
    logger.info({ visitorId: req.params.visitorId, by: req.agent.id }, 'contact_deleted');
    return res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
