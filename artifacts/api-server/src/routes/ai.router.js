'use strict';

/**
 * ai.router.js
 * POST /api/ai/rephrase   — agent copilot text rephrase
 */

const { Router }      = require('express');
const { requireAuth } = require('../middleware/auth');
const { rephraseText } = require('../services/ai.service');
const logger          = require('../utils/logger');

const router = Router();
router.use(requireAuth);

router.post('/rephrase', async (req, res, next) => {
  try {
    const { draft, tone } = req.body || {};
    if (!draft?.trim()) {
      return res.status(400).json({ error: 'draft is required' });
    }

    const rephrased = await rephraseText({ draft: draft.trim(), tone });
    logger.info({ agentId: req.agent?.id }, 'ai_rephrase');
    return res.json({ rephrased });
  } catch (err) {
    logger.error({ err }, 'ai_rephrase_error');
    next(err);
  }
});

module.exports = router;
