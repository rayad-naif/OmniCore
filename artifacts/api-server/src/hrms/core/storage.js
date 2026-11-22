'use strict';

/**
 * hrms/core/storage.js
 * File storage for the HR module (avatars, signed agreements, ID card scans,
 * activity-log text files, activity screenshots).
 *
 * Replaces Cloudinary and ImageKit from the original HRMS:
 *   - Cloudflare R2 when OmniCore's R2_* variables are set (recommended);
 *   - otherwise the server's disk under HRMS_UPLOAD_DIR (default uploads/hrms).
 *
 * Every key starts with hrms/<workspace id>/, and files are served by
 * GET /api/hrms/files/:name?k=<key>&s=<signature>[&e=<expiry>] — the HMAC
 * signature makes the URL unguessable (like Cloudinary's URLs) without
 * needing the viewer's token in an <img> tag. Screenshot URLs also expire.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const r2 = require('../../lib/r2');
const { requireTenantId } = require('./context');
const { fileSignature } = require('./tokens');

const LOCAL_ROOT = path.resolve(
  process.env.HRMS_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'hrms'),
);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function useR2() {
  return Boolean(r2.R2_ENABLED);
}

const safeSegment = (s) =>
  String(s || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120) || 'file';

/** Builds a workspace-scoped key: hrms/<tenant>/<folder…>/<name>. */
function keyFor(folder, name, tenantId = requireTenantId()) {
  const folders = String(folder || 'files')
    .split('/')
    .filter(Boolean)
    .map(safeSegment);
  return ['hrms', safeSegment(tenantId), ...folders, safeSegment(name)].join(
    '/',
  );
}

function tenantOfKey(key) {
  const parts = String(key || '').split('/');
  return parts[0] === 'hrms' ? parts[1] : null;
}

function assertKey(key) {
  const k = String(key || '');
  if (!k.startsWith('hrms/') || k.includes('..') || k.includes('\\')) {
    throw Object.assign(new Error('Invalid file key'), { statusCode: 400 });
  }
  return k;
}

function localPath(key) {
  const full = path.resolve(LOCAL_ROOT, assertKey(key).slice('hrms/'.length));
  if (!full.startsWith(LOCAL_ROOT + path.sep)) {
    throw Object.assign(new Error('Invalid file key'), { statusCode: 400 });
  }
  return full;
}

function contentTypeFor(name, fallback = 'application/octet-stream') {
  return MIME[path.extname(String(name)).toLowerCase()] || fallback;
}

async function put(key, buffer, contentType) {
  assertKey(key);
  const type = contentType || contentTypeFor(key);
  if (useR2()) {
    await r2.uploadToR2(buffer, key, type);
  } else {
    const file = localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
  }
  return { key, bytes: buffer.length, contentType: type };
}

async function read(key) {
  assertKey(key);
  if (useR2()) return r2.readFromR2(key);
  try {
    return await fs.readFile(localPath(key));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function remove(key) {
  if (!key || !String(key).startsWith('hrms/')) return;
  if (useR2()) {
    await r2.deleteFromR2(key).catch((err) => {
      if (err?.$metadata?.httpStatusCode !== 404) throw err;
    });
  } else {
    await fs.rm(localPath(key), { force: true });
  }
}

/** Deletes every file of one workspace (super admin "delete HR data"). */
async function removeWorkspace(tenantId) {
  if (useR2()) return false; // R2 objects are removed by a bucket lifecycle rule / manually
  await fs.rm(path.join(LOCAL_ROOT, safeSegment(tenantId)), {
    recursive: true,
    force: true,
  });
  return true;
}

/**
 * Signed URL for a stored file. `expiresInSeconds` makes it temporary
 * (screenshots); otherwise it is permanent like the original Cloudinary URLs.
 */
function urlFor(key, { expiresInSeconds } = {}) {
  assertKey(key);
  const name = encodeURIComponent(safeSegment(path.basename(key)));
  const params = new URLSearchParams({ k: key });
  if (expiresInSeconds) {
    const e = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    params.set('e', e);
    params.set('s', fileSignature(`${key}|${e}`));
  } else {
    params.set('s', fileSignature(key));
  }
  return `/api/hrms/files/${name}?${params.toString()}`;
}

function verifySignedRequest({ k, s, e }) {
  if (!k || !s) return false;
  const expected = e ? fileSignature(`${k}|${e}`) : fileSignature(k);
  const a = Buffer.from(String(s));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (e && Number(e) < Date.now() / 1000) return false;
  return true;
}

/** Key from a URL produced by urlFor() (null for foreign URLs). */
function keyFromUrl(url) {
  try {
    const u = new URL(String(url), 'http://local');
    if (!u.pathname.startsWith('/api/hrms/files/')) return null;
    return u.searchParams.get('k');
  } catch {
    return null;
  }
}

/** Express handler for GET /api/hrms/files/:name */
async function serveFile(req, res) {
  const { k, s, e } = req.query;
  if (!verifySignedRequest({ k, s, e })) {
    return res.status(403).json({ success: false, message: 'Invalid or expired file link' });
  }
  const key = assertKey(k);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const type = contentTypeFor(key);
  res.setHeader(
    'Content-Disposition',
    `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${safeSegment(path.basename(key))}"`,
  );
  res.setHeader(
    'Cache-Control',
    e ? 'private, max-age=300' : 'private, max-age=86400',
  );
  if (useR2()) {
    const ok = await r2.streamFromR2(key, res);
    if (!ok) res.status(404).json({ success: false, message: 'File not found' });
    return undefined;
  }
  const buf = await read(key);
  if (!buf) return res.status(404).json({ success: false, message: 'File not found' });
  res.setHeader('Content-Type', type);
  return res.send(buf);
}

module.exports = {
  keyFor,
  tenantOfKey,
  put,
  read,
  remove,
  removeWorkspace,
  urlFor,
  keyFromUrl,
  serveFile,
  contentTypeFor,
  verifySignedRequest,
  useR2,
};
