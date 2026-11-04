#!/usr/bin/env node
/**
 * `npm run brand:write` — the ONE source of the BroCode icon.
 *
 * The brand used to be three hand-made bitmaps that nothing generated: `public/brocode.png` (128),
 * `brocode-192.png`, `brocode-256.png`. Each new size was somebody's manual export, so the tab icon,
 * the sidebar tile, the install icon and the apple-touch icon could drift apart and nothing noticed.
 *
 * This script draws the mark ONCE — the geometry below, in a 512×512 space — and derives every
 * artifact the shell, the PWA manifest and the OG card name:
 *
 *   public/brand/brocode-mark.svg          vector master (infinitely sharp, transparent field)
 *   public/brand/icon-{16,32,48,96}.png    favicon sizes, transparent behind the rounded tile
 *   public/brand/icon-192.png              install icon (manifest, "any")
 *   public/brand/icon-512.png              install icon (manifest "any", OG card source)
 *   public/brand/maskable-512.png          full-bleed plate with the safe-area padding Android wants
 *   public/brand/apple-touch-icon-180.png  iOS home screen — opaque, because iOS paints the corners
 *   public/favicon.ico                     16/32/48 packed as PNG entries (what `/favicon.ico` needs)
 *
 * WHY PURE JS: `npm run og` needs a local Chrome/Edge, which a build box does not have. This renders
 * with signed-distance shapes and analytic antialiasing, so the mark is reproducible anywhere Node
 * runs, with no image library. Do not replace it with a manual export.
 *
 * The mark is the official BroCode tile: a cyan → blue → purple rounded square, a night-black inner
 * tile and the `< / >` code glyph in ice white. The supplied artwork's outer ring and glow are left
 * to CSS (`drop-shadow` on the sidebar tile): at 16 px a ring is sub-pixel noise, and a favicon has
 * to stay legible at exactly that size.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'brand');

/* ------------------------------- the mark -------------------------------- */

const SPACE = 512;
const TILE = { cx: 256, cy: 256, hw: 200, hh: 200, r: 104 };
const INNER = { cx: 256, cy: 256, hw: 106, hh: 106, r: 44 };
const GLYPH = {
  width: 40,
  points: [
    [[216, 204], [174, 256], [216, 308]], // <
    [[272, 198], [240, 314]], // /
    [[296, 204], [338, 256], [296, 308]], // >
  ],
};
const MARK_NORMAL = { tile: TILE, inner: INNER, glyph: GLYPH };

/**
 * 16–32 px is a different optical problem, not a smaller copy of the same one: three glyphs inside a
 * 212-unit tile land under two pixels of stroke and merge into a white smudge, which is exactly how
 * a logo becomes unreadable in a tab. The small variant keeps only `<` and `>`, spreads them and
 * thickens the stroke so the tab icon reads as code brackets rather than a blob. It is the same
 * mark — same tile, same gradient — with the detail the pixels can actually carry.
 */
const MARK_SMALL = {
  tile: TILE,
  inner: { cx: 256, cy: 256, hw: 118, hh: 118, r: 52 },
  glyph: {
    width: 58,
    points: [
      [[218, 194], [158, 256], [218, 318]], // <
      [[294, 194], [354, 256], [294, 318]], // >
    ],
  },
};

/** The tile gradient, top-left to bottom-right: cyan → electric blue → purple → magenta. */
const TILE_STOPS = [
  [0, [36, 224, 255]],
  [0.35, [47, 139, 255]],
  [0.65, [124, 77, 255]],
  [1, [232, 58, 208]],
];
/** The glyph runs white at the top to ice-cyan at the bottom, as in the artwork. */
const GLYPH_STOPS = [
  [0, [255, 255, 255]],
  [1, [150, 234, 255]],
];
const INNER_COLOR = [9, 3, 16];
/** Install plates: midnight navy, so an opaque icon still looks native on a dark home screen. */
const PLATE_GRADIENT = [
  [0, [10, 20, 44]],
  [1, [22, 8, 40]],
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
function gradient(stops, t) {
  const at = clamp01(t);
  for (let i = 1; i < stops.length; i += 1) {
    if (at <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mixColor(c0, c1, (at - t0) / (t1 - t0 || 1));
    }
  }
  return stops[stops.length - 1][1];
}

/** Signed distance to a rounded rectangle, in mark units: negative inside. */
function sdRoundRect(x, y, { cx, cy, hw, hh, r }) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Distance to a segment, for the glyph strokes. */
function sdSegment(x, y, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/**
 * Colour + coverage for one point in mark space.
 *
 *   `plate` — fill the corners with the install plate and shrink the mark by `scale` (maskable
 *             safe area). Without it the field outside the rounded tile stays transparent.
 *   `pxPerUnit` — output pixels per mark unit, which is what turns a distance into coverage.
 */
function sample(x, y, { plate = false, scale = 1, pxPerUnit, mark }) {
  const { tile, inner, glyph } = mark;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const put = (color, coverage) => {
    if (coverage <= 0) return;
    r = color[0] * coverage + r * (1 - coverage);
    g = color[1] * coverage + g * (1 - coverage);
    b = color[2] * coverage + b * (1 - coverage);
    a = coverage + a * (1 - coverage);
  };
  const cover = (distance) => clamp01(0.5 - distance * pxPerUnit);

  if (plate) put(gradient(PLATE_GRADIENT, (x + y) / (2 * SPACE)), 1);

  const mx = (x - SPACE / 2) / scale + SPACE / 2;
  const my = (y - SPACE / 2) / scale + SPACE / 2;

  const tileD = sdRoundRect(mx, my, tile);
  put(gradient(TILE_STOPS, (mx - 56 + (my - 56)) / 800), cover(tileD));
  if (tileD > 0) return { r, g, b, a };

  const innerD = sdRoundRect(mx, my, inner);
  put(INNER_COLOR, cover(innerD));
  if (innerD > 0) return { r, g, b, a };

  let toStroke = Infinity;
  for (const segment of glyph.points) {
    for (let i = 1; i < segment.length; i += 1) {
      toStroke = Math.min(toStroke, sdSegment(mx, my, ...segment[i - 1], ...segment[i]));
    }
  }
  put(gradient(GLYPH_STOPS, (my - 194) / 124), cover(toStroke - glyph.width / 2));
  return { r, g, b, a };
}

/** Render one square, straight-alpha RGBA buffer. */
function render(size, options = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const pxPerUnit = size / SPACE;
  const scale = options.scale ?? 1;
  const mark = options.mark ?? (size <= 32 ? MARK_SMALL : MARK_NORMAL);
  // A 16 px tile is 0.78 mark units per pixel: sampling once per pixel would alias the `<` away.
  const grid = size <= 64 ? 4 : 1;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let wa = 0;
      for (let sy = 0; sy < grid; sy += 1) {
        for (let sx = 0; sx < grid; sx += 1) {
          const markX = (px + (sx + 0.5) / grid) / pxPerUnit;
          const markY = (py + (sy + 0.5) / grid) / pxPerUnit;
          const c = sample(markX, markY, { plate: options.plate, scale, pxPerUnit: pxPerUnit * scale, mark });
          wr += c.r * c.a;
          wg += c.g * c.a;
          wb += c.b * c.a;
          wa += c.a;
        }
      }
      const i = (py * size + px) * 4;
      const alpha = wa / (grid * grid);
      // Colour is the coverage-weighted mean; alpha is the mean coverage. Straight alpha, no fringe.
      rgba[i] = wa > 0 ? Math.round(wr / wa) : 0;
      rgba[i + 1] = wa > 0 ? Math.round(wg / wa) : 0;
      rgba[i + 2] = wa > 0 ? Math.round(wb / wa) : 0;
      rgba[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return rgba;
}

/* ------------------------------ PNG writing ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}
function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO with PNG entries — what every browser that still requests `/favicon.ico` reads. */
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[4] = 1; // colour planes
    entry[6] = 32; // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    directory.push(entry);
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]);
}

/* --------------------------------- SVG ----------------------------------- */

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function svg() {
  const glyphPath = MARK_NORMAL.glyph.points
    .map((segment) => `M ${segment.map(([x, y]) => `${x} ${y}`).join(' L ')}`)
    .join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="BroCode">
  <!-- Generated by scripts/brand-icons.cjs — edit the geometry there, never this file. -->
  <defs>
    <linearGradient id="tile" x1="56" y1="56" x2="456" y2="456" gradientUnits="userSpaceOnUse">
${TILE_STOPS.map(([at, c]) => `      <stop offset="${at}" stop-color="${hex(c)}" />`).join('\n')}
    </linearGradient>
    <linearGradient id="glyph" x1="0" y1="198" x2="0" y2="314" gradientUnits="userSpaceOnUse">
${GLYPH_STOPS.map(([at, c]) => `      <stop offset="${at}" stop-color="${hex(c)}" />`).join('\n')}
    </linearGradient>
  </defs>
  <rect x="${TILE.cx - TILE.hw}" y="${TILE.cy - TILE.hh}" width="${TILE.hw * 2}" height="${TILE.hh * 2}" rx="${TILE.r}" fill="url(#tile)" />
  <rect x="${INNER.cx - INNER.hw}" y="${INNER.cy - INNER.hh}" width="${INNER.hw * 2}" height="${INNER.hh * 2}" rx="${INNER.r}" fill="${hex(INNER_COLOR)}" />
  <path d="${glyphPath}" fill="none" stroke="url(#glyph)" stroke-width="${MARK_NORMAL.glyph.width}" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;
}

/* -------------------------------- output --------------------------------- */

const ARTIFACTS = [
  { file: 'icon-16.png', size: 16 },
  { file: 'icon-32.png', size: 32 },
  { file: 'icon-48.png', size: 48 },
  { file: 'icon-96.png', size: 96 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512, options: { plate: true, scale: 0.78 } },
  { file: 'apple-touch-icon-180.png', size: 180, options: { plate: true, scale: 0.86 } },
];

function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const pngs = new Map();
  const written = [];
  for (const { file, size, options } of ARTIFACTS) {
    const png = encodePNG(size, render(size, options));
    fs.writeFileSync(path.join(OUT, file), png);
    pngs.set(size, png);
    written.push(`public/brand/${file}`);
  }
  fs.writeFileSync(path.join(OUT, 'brocode-mark.svg'), svg());
  written.push('public/brand/brocode-mark.svg');

  fs.writeFileSync(
    path.join(ROOT, 'public', 'favicon.ico'),
    encodeICO([16, 32, 48].map((size) => ({ size, png: pngs.get(size) }))),
  );
  written.push('public/favicon.ico');

  console.log(`brand: ${written.length} artifacts from one geometry`);
  for (const file of written) console.log(`  ${file}`);
}

if (require.main === module) run();

module.exports = { render, encodePNG, encodeICO, svg, ARTIFACTS, MARK_NORMAL, MARK_SMALL };
