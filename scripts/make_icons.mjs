// Generates PNG icons with no dependencies (zlib only): a basketball on a dark rounded square.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function icon(size, opaque) {
  const bg = [24, 28, 38], ball = [233, 118, 44], seam = [40, 24, 14];
  const c = size / 2, R = size * 0.34, radius = size * 0.2, seamW = size * 0.028;
  return png(size, (x, y) => {
    // rounded square background
    const dx = Math.max(Math.abs(x + 0.5 - c) - (c - radius), 0), dy = Math.max(Math.abs(y + 0.5 - c) - (c - radius), 0);
    const inSquare = opaque || Math.hypot(dx, dy) <= radius;
    if (!inSquare) return [0, 0, 0, 0];
    const px = x + 0.5 - c, py = y + 0.5 - c, d = Math.hypot(px, py);
    if (d > R) return [...bg, 255];
    const ang = Math.atan2(py, px);
    const onSeam = Math.abs(px) < seamW || Math.abs(py) < seamW ||
      Math.abs(Math.hypot(px - R * 0.95, py - R * 0.95) - R * 1.05) < seamW ||
      Math.abs(Math.hypot(px + R * 0.95, py + R * 0.95) - R * 1.05) < seamW;
    void ang;
    if (d > R - seamW * 1.2) return [...seam, 255];
    return onSeam ? [...seam, 255] : [...ball, 255];
  });
}
fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'icons', 'icon-192.png'), icon(192, true));
fs.writeFileSync(path.join(ROOT, 'icons', 'icon-512.png'), icon(512, true));
fs.writeFileSync(path.join(ROOT, 'icons', 'apple-touch-icon.png'), icon(180, true));
fs.writeFileSync(path.join(ROOT, 'icons', 'favicon-64.png'), icon(64, false));
console.log('icons written');
