'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const R2_ENABLED = !!(
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_ENDPOINT &&
  process.env.R2_BUCKET_NAME
);

let _client;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

const BUCKET = process.env.R2_BUCKET_NAME;

/**
 * Upload a Buffer to R2.
 * @param {Buffer} buffer
 * @param {string} key       safe filename (no path traversal)
 * @param {string} mimeType
 * @returns {Promise<void>}
 */
async function uploadToR2(buffer, key, mimeType) {
  await client().send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType || 'application/octet-stream',
  }));
}

/**
 * Stream an R2 object into an Express response.
 * @param {string}   key
 * @param {Response} res  Express response — the function sets headers and pipes
 * @returns {Promise<boolean>} false if the object doesn't exist
 */
async function streamFromR2(key, res) {
  try {
    const obj = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (obj.ContentType)   res.setHeader('Content-Type',   obj.ContentType);
    if (obj.ContentLength) res.setHeader('Content-Length', String(obj.ContentLength));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    obj.Body.pipe(res);
    return true;
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

module.exports = { R2_ENABLED, uploadToR2, streamFromR2 };
