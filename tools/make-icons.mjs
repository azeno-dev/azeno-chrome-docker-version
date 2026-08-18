/**
 * Generates the extension icon set.
 *
 * The mark is the popup's version rail seen head-on: three stacked bars, the
 * top one bright and full width (the newest release), the ones below shorter
 * and dimmer (older versions). Same idea as the chips, legible at 16px.
 *
 * Run with `npm run icons`. Anti-aliasing is done by 4x4 supersampling against
 * a rounded-rectangle signed distance field, so no image library is needed.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

const INDIGO = [0x4b, 0x4b, 0xd6];
const WHITE = [0xff, 0xff, 0xff];

// Geometry on a 128-unit grid, scaled to each output size.
const TILE = { inset: 6, radius: 28 };
const BARS = [
  { y: 35, width: 72, alpha: 1 },
  { y: 57, width: 52, alpha: 0.62 },
  { y: 79, width: 38, alpha: 0.38 },
];
const BAR_X = 28;
const BAR_HEIGHT = 14;
const BAR_RADIUS = 7;

/** Signed distance to a rounded rectangle; negative inside. */
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Fraction of a pixel covered by the shape, via 4x4 subsamples. */
function coverage(px, py, scale, shape) {
  const STEPS = 4;
  let hits = 0;
  for (let sy = 0; sy < STEPS; sy += 1) {
    for (let sx = 0; sx < STEPS; sx += 1) {
      const x = (px + (sx + 0.5) / STEPS) / scale;
      const y = (py + (sy + 0.5) / STEPS) / scale;
      if (shape(x, y) <= 0) hits += 1;
    }
  }
  return hits / (STEPS * STEPS);
}

export function renderIcon(size) {
  const scale = size / 128;
  const pixels = Buffer.alloc(size * size * 4);

  const tile = (x, y) => sdRoundRect(
    x, y, TILE.inset, TILE.inset, 128 - TILE.inset, 128 - TILE.inset, TILE.radius,
  );
  const bars = BARS.map((bar) => ({
    alpha: bar.alpha,
    sdf: (x, y) => sdRoundRect(x, y, BAR_X, bar.y, BAR_X + bar.width, bar.y + BAR_HEIGHT, BAR_RADIUS),
  }));

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const tileAlpha = coverage(px, py, scale, tile);
      let [r, g, b] = INDIGO;

      // Composite each bar over the tile colour.
      for (const bar of bars) {
        const a = coverage(px, py, scale, bar.sdf) * bar.alpha;
        if (a === 0) continue;
        r = Math.round(r * (1 - a) + WHITE[0] * a);
        g = Math.round(g * (1 - a) + WHITE[1] * a);
        b = Math.round(b * (1 - a) + WHITE[2] * a);
      }

      const offset = (py * size + px) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = Math.round(tileAlpha * 255);
    }
  }
  return pixels;
}

// ---- minimal PNG encoder ----------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // bytes 10-12 stay 0: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const from = y * size * 4;
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Only write files when run directly, so the renderer can be imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = join(OUT_DIR, `icon-${size}.png`);
    writeFileSync(file, encodePng(size, renderIcon(size)));
    console.log(`wrote ${file}`);
  }
}
