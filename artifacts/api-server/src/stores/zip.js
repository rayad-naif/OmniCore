'use strict';

/** Minimal ZIP writer (deflate) for the WordPress plugin download. */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

let TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1)
    c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Zips `dir` so that its files live under `rootName/` inside the archive. */
function zipDirectory(dir, rootName) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(
      `${rootName}/${path.relative(dir, file).split(path.sep).join('/')}`,
    );
    const data = fs.readFileSync(file);
    const packed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30); // extra + comment length
    central.writeUInt32LE(0, 34); // disk + internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The OmniCore Commerce plugin folder (repository checkout or STORES_PLUGIN_DIR). */
function pluginDir() {
  const candidates = [
    process.env.STORES_PLUGIN_DIR,
    path.join(process.cwd(), 'artifacts/woocommerce-plugin/omnicore-commerce'),
    path.join(process.cwd(), '../woocommerce-plugin/omnicore-commerce'),
    path.join(
      process.cwd(),
      '../../artifacts/woocommerce-plugin/omnicore-commerce',
    ),
  ].filter(Boolean);
  return (
    candidates.find((d) =>
      fs.existsSync(path.join(d, 'omnicore-commerce.php')),
    ) || null
  );
}

module.exports = { zipDirectory, pluginDir, crc32 };
