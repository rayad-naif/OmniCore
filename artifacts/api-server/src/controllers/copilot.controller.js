'use strict';

/**
 * copilot.controller.js — in-app AI assistant (any signed-in user).
 *
 *   GET    /api/copilot/status                 { enabled, provider, model, source, appName }
 *   POST   /api/copilot/chat                   { session_id?, message, section? } → { session_id, reply, pending[], actions[] }
 *   POST   /api/copilot/sessions/:id/confirm   { approve: boolean, section? } → same + executed[]
 *   DELETE /api/copilot/sessions/:id           forget a conversation
 */

const express = require('express');
const { pool } = require('../lib/db');
const { requireAuth, applyWorkspaceOverride } = require('../middleware/auth');
const copilot = require('../lib/ai/copilot');

const router = express.Router();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
router.use(requireAuth, applyWorkspaceOverride);

router.get(
  '/status',
  wrap(async (req, res) => res.json(await copilot.status(req))),
);

router.post(
  '/chat',
  wrap(async (req, res) => {
    const { session_id, message, section } = req.body || {};
    if (!message || !String(message).trim())
      return res.status(400).json({ error: 'message is required' });
    res.json(
      await copilot.chat(req, {
        sessionId: session_id || null,
        message: String(message),
        section: section ? String(section).slice(0, 40) : null,
      }),
    );
  }),
);

router.post(
  '/sessions/:id/confirm',
  wrap(async (req, res) => {
    res.json(
      await copilot.confirm(req, {
        sessionId: req.params.id,
        approve: req.body?.approve === true,
        section: req.body?.section
          ? String(req.body.section).slice(0, 40)
          : null,
      }),
    );
  }),
);

router.delete(
  '/sessions/:id',
  wrap(async (req, res) => {
    await copilot.ensureCopilotSchema();
    await pool.query(
      `DELETE FROM copilot_sessions WHERE id = $1 AND agent_id = $2`,
      [req.params.id, req.agent.id],
    );
    res.status(204).end();
  }),
);

module.exports = router;
