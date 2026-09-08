import { beforeEach, describe, expect, it, vi } from 'vitest';

const broadcastToTenant = vi.fn();

vi.mock('../utils/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('../services/socket.service', () => ({
  broadcastToTenant,
  broadcastToConversation: vi.fn(),
  getIo: vi.fn(),
}));
vi.mock('../services/ai.service', () => ({
  maybeAutoReply: vi.fn(),
}));
vi.mock('../lib/r2', () => ({
  R2_ENABLED: false,
  uploadToR2: vi.fn(),
  streamFromR2: vi.fn(),
  getPresignedGetUrl: vi.fn(),
}));

const { pool } = require('../lib/db.js');
const query = vi.spyOn(pool, 'query');
const express = require('express');
const request = require('supertest');
const widgetRouter = require('./widget.controller.js');

const app = express();
app.use(express.json());
app.use('/api/widget', widgetRouter);
app.use(
  (
    error: Error,
    _req: unknown,
    res: { status: (code: number) => { json: (body: object) => void } },
    _next: unknown,
  ) => {
    res.status(500).json({ error: error.message });
  },
);

describe('POST /api/widget/session', () => {
  beforeEach(() => {
    query.mockReset();
    broadcastToTenant.mockReset();
  });

  it('rejects a missing or non-string brand identifier before querying storage', async () => {
    for (const body of [{}, { brandId: 42 }]) {
      const response = await request(app)
        .post('/api/widget/session')
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'brandId is required' });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('restores an existing visitor session with its latest open conversation', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'visitor-1', tenant_id: 'tenant-1' }],
      })
      .mockResolvedValueOnce({ rows: [{ brand_name: 'Acme Support' }] })
      .mockResolvedValueOnce({ rows: [{ display_name: 'Ada' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'conversation-1',
            status: 'open',
            csat_requested: false,
            csat_score: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app).post('/api/widget/session').send({
      brandId: ' brand-1 ',
      sessionToken: 'session-1',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      sessionToken: 'session-1',
      conversationId: 'conversation-1',
      messages: [],
      brandName: 'Acme Support',
      visitorName: 'Ada',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('session_token = $1 AND brand_id = $2'),
      ['session-1', 'brand-1'],
    );
  });
});
