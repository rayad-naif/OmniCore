'use strict';

/**
 * hrms/core/cloudinaryShim.js
 * The small part of the `cloudinary` and `multer-storage-cloudinary` APIs the
 * HRMS code uses, implemented on top of core/storage.js (R2 or local disk).
 * Results keep Cloudinary's field names (secure_url, public_id) so the ported
 * routes and stored documents work unchanged; public_id is the storage key.
 */

const path = require('node:path');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const storage = require('./storage');

function keyFromOptions(opts = {}, originalName = '') {
  const folder = String(opts.folder || 'files').replace(/^gg-hrms\/?/, '') || 'files';
  let name = String(opts.public_id || crypto.randomUUID());
  // public_id may already contain folders (e.g. "activity-logs/station/2026-07").
  const parts = name.split('/').filter(Boolean);
  name = parts.pop() || crypto.randomUUID();
  if (!path.extname(name)) {
    const ext = path.extname(originalName || '');
    if (ext) name += ext.toLowerCase();
    else if (opts.resource_type === 'raw' && opts.format !== 'bin') name += '.txt';
  }
  return storage.keyFor([folder, ...parts].join('/'), name);
}

async function uploadBuffer(buffer, opts = {}, originalName = '', mimetype = '') {
  const key = keyFromOptions(opts, originalName);
  const type =
    opts.content_type ||
    (mimetype && mimetype !== 'application/octet-stream' ? mimetype : '') ||
    storage.contentTypeFor(key);
  await storage.put(key, buffer, type);
  const url = storage.urlFor(key);
  return {
    public_id: key,
    secure_url: url,
    url,
    bytes: buffer.length,
    resource_type: opts.resource_type || 'auto',
    format: path.extname(key).slice(1),
    original_filename: originalName || path.basename(key),
  };
}

const v2 = {
  config() {},
  uploader: {
    upload_stream(opts, callback) {
      const chunks = [];
      return new Writable({
        write(chunk, _enc, done) {
          chunks.push(Buffer.from(chunk));
          done();
        },
        final(done) {
          uploadBuffer(Buffer.concat(chunks), opts)
            .then((result) => callback(null, result))
            .catch((err) => callback(err))
            .finally(() => done());
        },
      });
    },
    async upload(input, opts = {}) {
      let buffer;
      if (Buffer.isBuffer(input)) buffer = input;
      else if (/^data:[^;]+;base64,/.test(String(input))) {
        buffer = Buffer.from(String(input).split(',')[1], 'base64');
      } else {
        throw new Error('Only buffers and data URIs can be uploaded');
      }
      return uploadBuffer(buffer, opts);
    },
    async destroy(publicId) {
      await storage.remove(publicId);
      return { result: 'ok' };
    },
  },
};

/** multer storage engine compatible with multer-storage-cloudinary. */
class CloudinaryStorage {
  constructor({ params } = {}) {
    this.params = params || {};
  }

  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on('data', (c) => chunks.push(c));
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const opts =
          typeof this.params === 'function'
            ? await this.params(req, file)
            : this.params;
        const result = await uploadBuffer(
          Buffer.concat(chunks),
          opts,
          file.originalname,
          file.mimetype,
        );
        cb(null, {
          path: result.secure_url,
          filename: result.public_id,
          size: result.bytes,
        });
      } catch (err) {
        cb(err);
      }
    });
  }

  _removeFile(_req, file, cb) {
    storage
      .remove(file.filename)
      .then(() => cb(null))
      .catch(cb);
  }
}

module.exports = { v2, CloudinaryStorage, uploadBuffer };
