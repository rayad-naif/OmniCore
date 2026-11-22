import { describe, expect, it } from 'vitest';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-'.padEnd(64, 'x');
process.env.HRMS_UPLOAD_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  `hrms-test-${process.pid}`,
);
delete process.env.R2_ACCESS_KEY_ID;

const WS_A = '11111111-2222-4333-8444-555555555555';
const WS_B = '99999999-8888-4777-8666-555555555555';

describe('HR tokens', () => {
  const tokens = require('./tokens.js');

  it('binds tokens to a workspace and keeps them apart from OmniCore tokens', () => {
    const access = tokens.signAccess({ _id: 'u1', role: 'admin' }, WS_A);
    const decoded = tokens.verifyAccess(access);
    expect(decoded.tid).toBe(WS_A);
    expect(decoded.role).toBe('admin');
    expect(tokens.peekTenant(access)).toBe(WS_A);

    // An OmniCore dashboard token (signed with JWT_SECRET directly) is rejected.
    const jwt = require('jsonwebtoken');
    const omni = jwt.sign(
      { sub: 'u1', tenantId: WS_A },
      process.env.JWT_SECRET,
    );
    expect(() => tokens.verifyAccess(omni)).toThrow();
    expect(tokens.peekTenant(omni)).toBeNull();

    // Refresh and access tokens are not interchangeable.
    const refresh = tokens.signRefresh({ _id: 'u1' }, WS_A);
    expect(() => tokens.verifyAccess(refresh)).toThrow();
    expect(tokens.verifyRefresh(refresh).tid).toBe(WS_A);
  });
});

describe('HR workspace context and models', () => {
  const mongoose = require('./mongoose.js');
  const { runAsTenant, currentTenantId } = require('./context.js');

  it('names one database per workspace, short enough for MongoDB Atlas', () => {
    const name = mongoose.__hrms.dbNameFor(WS_A);
    expect(name).toBe('hrms_11111111222243338444555555555555');
    expect(name.length).toBeLessThanOrEqual(38);
    expect(mongoose.__hrms.dbNameFor(WS_B)).not.toBe(name);
  });

  it('refuses to touch a model without a workspace context', () => {
    const schema = new mongoose.Schema({ name: String });
    const Widget = mongoose.model('HrTestWidget', schema);
    expect(Widget.modelName).toBe('HrTestWidget');
    expect(() => Widget.find({})).toThrow(/no workspace context/);
    expect(mongoose.models.HrTestWidget).toBe(Widget);
    expect(mongoose.models.Unknown).toBeUndefined();
  });

  it('keeps the workspace across async boundaries', async () => {
    const seen = await runAsTenant(WS_B, async () => {
      await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setImmediate(r));
      return currentTenantId();
    });
    expect(seen).toBe(WS_B);
    expect(currentTenantId()).toBeNull();
  });
});

describe('HR time zones', () => {
  const { tzOffsetMs } = require('./time.js');
  it('replaces the fixed UTC+5 with the workspace time zone', () => {
    const summer = new Date('2026-07-01T12:00:00Z');
    const winter = new Date('2026-01-01T12:00:00Z');
    expect(tzOffsetMs(summer, 'Asia/Karachi')).toBe(5 * 3600_000);
    expect(tzOffsetMs(summer, 'America/New_York')).toBe(-4 * 3600_000);
    expect(tzOffsetMs(winter, 'America/New_York')).toBe(-5 * 3600_000);
    expect(tzOffsetMs(summer, 'UTC')).toBe(0);
  });
});

describe('HR file storage', () => {
  const storage = require('./storage.js');
  const { runAsTenant } = require('./context.js');

  it('stores files per workspace behind signed, tamper-proof links', async () => {
    const key = runAsTenant(WS_A, () =>
      storage.keyFor('avatars', '../../evil name.png'),
    );
    expect(key.startsWith(`hrms/${WS_A}/avatars/`)).toBe(true);
    expect(key).not.toContain('..');

    await storage.put(key, Buffer.from('png-bytes'), 'image/png');
    expect((await storage.read(key))?.toString()).toBe('png-bytes');

    const url = storage.urlFor(key);
    expect(storage.keyFromUrl(url)).toBe(key);
    const q = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(storage.verifySignedRequest(q)).toBe(true);
    expect(
      storage.verifySignedRequest({ ...q, k: key.replace(WS_A, WS_B) }),
    ).toBe(false);
    expect(storage.verifySignedRequest({ ...q, s: 'nope' })).toBe(false);

    const temp = Object.fromEntries(
      new URL(storage.urlFor(key, { expiresInSeconds: 60 }), 'http://x')
        .searchParams,
    );
    expect(storage.verifySignedRequest(temp)).toBe(true);
    expect(
      storage.verifySignedRequest({ ...temp, e: String(Number(temp.e) + 1) }),
    ).toBe(false);

    await storage.remove(key);
    expect(await storage.read(key)).toBeNull();
    expect(() => storage.urlFor('../../etc/passwd')).toThrow();
  });

  it('accepts Cloudinary-style uploads from the ported code', async () => {
    const { v2 } = require('./cloudinaryShim.js');
    const result = await runAsTenant(WS_B, () =>
      v2.uploader.upload(Buffer.from('hello'), {
        folder: 'gg-hrms/agreements',
        public_id: 'activity-logs/station/PC-1/2026-07',
        resource_type: 'raw',
      }),
    );
    expect(result.public_id).toBe(
      `hrms/${WS_B}/agreements/activity-logs/station/PC-1/2026-07.txt`,
    );
    expect(result.secure_url.startsWith('/api/hrms/files/')).toBe(true);
    await v2.uploader.destroy(result.public_id);
  });
});

describe('HR router helpers', () => {
  const { sanitize, resolveTenant } = require('../index.js');
  const tokens = require('./tokens.js');

  it('strips MongoDB operators from request bodies', () => {
    const body = sanitize({
      email: { $ne: null },
      'a.b': 1,
      ok: [{ $gt: 1, v: 2 }],
      name: 'x',
    });
    expect(body).toEqual({ email: {}, ok: [{ v: 2 }], name: 'x' });
  });

  it('takes the workspace from the HR token, or ?w= only for public job applications', async () => {
    const token = tokens.signAccess({ _id: 'u', role: 'employee' }, WS_A);
    expect(
      await resolveTenant({
        headers: { authorization: `Bearer ${token}` },
        path: '/v1/leaves',
        query: {},
        method: 'GET',
      }),
    ).toBe(WS_A);
    expect(
      await resolveTenant({
        headers: {},
        path: '/v1/employees',
        query: { w: WS_A },
        method: 'GET',
      }),
    ).toBeNull();
    const req: Record<string, unknown> = {
      headers: {},
      path: '/v1/recruitment/applications',
      query: { w: WS_B },
      method: 'POST',
    };
    expect(await resolveTenant(req)).toBe(WS_B);
    expect(req.hrmsAuthKind).toBe('public');
  });
});
