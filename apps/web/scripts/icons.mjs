// Writes the app icons into public/icons (PNG, no dependencies). Run once after a design
// change: node scripts/icons.mjs. The mark: a white open book with a check on indigo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
const BG = [0x43, 0x38, 0xca];
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distance from point p to segment ab.
function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The mark inside a box of `scale` (1 = full icon), centred. */
function mark(x, y, scale) {
  const u = (x - 0.5) / scale + 0.5;
  const v = (y - 0.5) / scale + 0.5;
  const w = 0.035;
  // Book: two pages as polylines.
  const book =
    seg(u, v, 0.2, 0.32, 0.5, 0.38) < w ||
    seg(u, v, 0.5, 0.38, 0.8, 0.32) < w ||
    seg(u, v, 0.2, 0.32, 0.2, 0.7) < w ||
    seg(u, v, 0.8, 0.32, 0.8, 0.7) < w ||
    seg(u, v, 0.2, 0.7, 0.5, 0.76) < w ||
    seg(u, v, 0.5, 0.76, 0.8, 0.7) < w ||
    seg(u, v, 0.5, 0.38, 0.5, 0.76) < w;
  const check =
    seg(u, v, 0.58, 0.5, 0.64, 0.58) < w * 0.9 || seg(u, v, 0.64, 0.58, 0.74, 0.44) < w * 0.9;
  return book || check;
}

function icon(size, { scale = 1, radius = 0.22 } = {}) {
  return png(size, (x, y) => {
    // Rounded square for the plain icons; full bleed for maskable (radius 0).
    const cx = Math.min(x, 1 - x);
    const cy = Math.min(y, 1 - y);
    if (radius > 0 && cx < radius && cy < radius && Math.hypot(radius - cx, radius - cy) > radius) {
      return [0, 0, 0, 0];
    }
    return mark(x, y, scale) ? [...FG, 255] : [...BG, 255];
  });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon-192.png', OUT), icon(192));
writeFileSync(new URL('icon-512.png', OUT), icon(512));
// Maskable: the mark stays inside the 80% safe zone.
writeFileSync(new URL('icon-maskable-512.png', OUT), icon(512, { scale: 0.75, radius: 0 }));
// iOS rounds the corners itself and shows transparency as black.
writeFileSync(new URL('apple-touch-icon.png', OUT), icon(180, { radius: 0 }));
writeFileSync(
  new URL('favicon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Slovak</title><rect width="24" height="24" rx="5" fill="#4338ca"/><path d="M4.8 7.7 12 9.1l7.2-1.4v9.1L12 18.2l-7.2-1.4zM12 9.1v9.1M13.9 12l1.4 1.9 2.4-3.4" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/></svg>\n`,
);
console.log('icons written');
