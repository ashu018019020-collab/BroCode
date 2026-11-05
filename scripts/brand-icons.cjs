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
const INNER = { cx: 256, cy: 256, hw: 104, hh: 104, r: 38 };

/** The orbit ribbon: an ellipse turned by -20 degrees, behind the tile on top, in front below. */
const RING = { cx: 256, cy: 268, a: 238, b: 152, width: 9, angle: (-20 * Math.PI) / 180 };

const MARK_NORMAL = {
  tile: TILE,
  inner: INNER,
  ring: true,
  glyph: {
    width: 34,
    segments: [
      { points: [[212, 200], [168, 256], [212, 312]], stops: [[0, [120, 240, 255]], [1, [26, 176, 244]]] },
      { points: [[274, 190], [240, 322]], stops: [[0, [255, 255, 255]], [1, [206, 238, 255]]] },
      { points: [[300, 200], [344, 256], [300, 312]], stops: [[0, [255, 248, 255]], [1, [226, 110, 246]]] },
    ],
  },
};

/**
 * 16-32 px is a different optical problem, not a smaller copy of the same one: three glyphs inside a
 * 208-unit screen land under two pixels of stroke and merge into a white smudge, which is exactly how
 * a logo becomes unreadable in a tab. The small variant keeps only `<` and `>`, spreads them,
 * thickens the stroke and drops the ribbon (sub-pixel noise at that size). It is the same mark.
 */
const MARK_SMALL = {
  tile: TILE,
  inner: { cx: 256, cy: 256, hw: 124, hh: 124, r: 56 },
  ring: false,
  gloss: 0.4,
  glyph: {
    width: 68,
    segments: [
      { points: [[222, 186], [148, 256], [222, 326]], stops: [[0, [240, 254, 255]], [1, [120, 226, 255]]] },
      { points: [[290, 186], [364, 256], [290, 326]], stops: [[0, [255, 242, 255]], [1, [212, 148, 250]]] },
    ],
  },
};

/** The tile gradient, top-left to bottom-right: cyan -> electric blue -> purple -> magenta. */
const TILE_STOPS = [
  [0, [58, 232, 255]],
  [0.18, [40, 184, 250]],
  [0.48, [70, 120, 255]],
  [0.74, [150, 82, 246]],
  [1, [222, 62, 226]],
];
/** The ribbon runs cyan at the left to magenta at the right, as in the artwork. */
const RING_STOPS = [
  [0, [96, 245, 255]],
  [0.35, [86, 170, 255]],
  [0.68, [176, 96, 255]],
  [1, [255, 92, 222]],
];
const INNER_COLOR = [7, 4, 14];
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

/** The ribbon's own frame: rotate the point around the ellipse centre. */
function ringLocal(x, y) {
  const cos = Math.cos(RING.angle);
  const sin = Math.sin(RING.angle);
  const dx = x - RING.cx;
  const dy = y - RING.cy;
  return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
}
/** Signed distance to the ribbon band, in mark units: negative on the band. */
function sdRing(x, y) {
  const { u, v } = ringLocal(x, y);
  const f = (u / RING.a) ** 2 + (v / RING.b) ** 2 - 1;
  const g = Math.hypot((2 * u) / (RING.a * RING.a), (2 * v) / (RING.b * RING.b)) || 1e-6;
  return f / g;
}

/** The tile surface: gradient, top-left gloss, bottom shade and the bevelled rim. */
function tileColor(x, y, tileD, glossAmount = 1) {
  let c = gradient(TILE_STOPS, (x - 40 + (y - 40)) / 880);
  const gloss = clamp01(1 - Math.hypot(x - 132, y - 108) / 340);
  c = mixColor(c, [255, 255, 255], gloss * gloss * 0.34 * glossAmount);
  const shade = clamp01((y - 286) / 190) * clamp01((x - 60) / 260);
  c = mixColor(c, [46, 8, 82], shade * 0.22 * glossAmount);
  const edge = clamp01(1 + tileD / 7);
  const lit = clamp01((430 - (x + y)) / 430) * edge * 0.5;
  const dark = clamp01((x + y - 470) / 470) * edge * 0.4;
  c = mixColor(c, [255, 255, 255], lit);
  return mixColor(c, [16, 4, 34], dark);
}

/** The ribbon colour: gradient along the screen plus the specular line that makes it a ribbon. */
function ringColor(x, y, ringD) {
  let c = gradient(RING_STOPS, (x - 24) / 452);
  const spec = clamp01(1 - Math.abs(ringD + RING.width * 0.34) / (RING.width * 0.6));
  c = mixColor(c, [255, 255, 255], spec * 0.6);
  const under = clamp01((ringD - RING.width * 0.35) / (RING.width * 0.7));
  return mixColor(c, [70, 26, 130], under * 0.25);
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

  const ribbon = mark.ring === false ? Infinity : sdRing(mx, my);
  const ribbonCover = Number.isFinite(ribbon) ? cover(Math.abs(ribbon) - RING.width) : 0;
  const behind = Number.isFinite(ribbon) ? ringLocal(mx, my).v <= 0 : false;

  // The half of the ribbon that passes behind the tile.
  if (ribbonCover > 0 && behind) put(ringColor(mx, my, ribbon), ribbonCover);

  const tileD = sdRoundRect(mx, my, tile);
  if (tileD <= 0) put(tileColor(mx, my, tileD, mark.gloss ?? 1), cover(tileD));
  if (tileD > 0) {
    if (ribbonCover > 0 && !behind) put(ringColor(mx, my, ribbon), ribbonCover);
    return { r, g, b, a };
  }

  const innerD = sdRoundRect(mx, my, inner);
  if (innerD <= 0) {
    let c = INNER_COLOR;
    // Glass screen: a faint top-left sheen and a lit lower edge, as in the artwork.
    const sheen = clamp01(1 - Math.hypot(mx - 186, my - 176) / 210);
    c = mixColor(c, [58, 74, 132], sheen * sheen * 0.5);
    const floor = clamp01((my - 300) / 100) * clamp01(1 + innerD / 12);
    c = mixColor(c, [70, 44, 130], floor * 0.35);
    put(c, cover(innerD));
  }
  if (innerD > 0) {
    if (ribbonCover > 0 && !behind) put(ringColor(mx, my, ribbon), ribbonCover);
    return { r, g, b, a };
  }

  let best = Infinity;
  let bestColor = null;
  for (const segment of glyph.segments) {
    let toStroke = Infinity;
    for (let i = 1; i < segment.points.length; i += 1) {
      toStroke = Math.min(toStroke, sdSegment(mx, my, ...segment.points[i - 1], ...segment.points[i]));
    }
    if (toStroke < best) {
      best = toStroke;
      bestColor = gradient(segment.stops, (my - 190) / 132);
    }
  }
  // A thin dark separation keeps the strokes from fusing into one white slab.
  put([16, 8, 26], cover(best - glyph.width / 2 - 2) * 0.55);
  put(bestColor, cover(best - glyph.width / 2));

  if (ribbonCover > 0 && !behind) put(ringColor(mx, my, ribbon), ribbonCover);
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
const stopTags = (list) => list.map(([at, c]) => `      <stop offset="${at}" stop-color="${hex(c)}" />`).join('\n');

function svg() {
  const { tile, inner, glyph } = MARK_NORMAL;
  const seg = (segment) => `M ${segment.points.map(([x, y]) => `${x} ${y}`).join(' L ')}`;
  const deg = (RING.angle * 180) / Math.PI;
  const gradients = glyph.segments
    .map(
      (item, i) => `    <linearGradient id="g${i}" x1="0" y1="190" x2="0" y2="322" gradientUnits="userSpaceOnUse">
${stopTags(item.stops)}
    </linearGradient>`,
    )
    .join('\n');
  const strokes = glyph.segments
    .map(
      (item, i) =>
        `  <path d="${seg(item)}" fill="none" stroke="url(#g${i})" stroke-width="${glyph.width}" stroke-linecap="round" stroke-linejoin="round" />`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="BroCode">
  <!-- Generated by scripts/brand-icons.cjs - edit the geometry there, never this file. -->
  <defs>
    <linearGradient id="tile" x1="56" y1="56" x2="456" y2="456" gradientUnits="userSpaceOnUse">
${stopTags(TILE_STOPS)}
    </linearGradient>
    <radialGradient id="gloss" cx="132" cy="108" r="340" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="286" x2="0" y2="456" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2e0852" stop-opacity="0" />
      <stop offset="1" stop-color="#2e0852" stop-opacity="0.22" />
    </linearGradient>
    <linearGradient id="screen" x1="152" y1="152" x2="360" y2="360" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1a2440" />
      <stop offset="0.55" stop-color="#07040e" />
      <stop offset="1" stop-color="#170a2a" />
    </linearGradient>
    <linearGradient id="ring" x1="24" y1="0" x2="476" y2="0" gradientUnits="userSpaceOnUse">
${stopTags(RING_STOPS)}
    </linearGradient>
${gradients}
    <clipPath id="tileClip">
      <rect x="${tile.cx - tile.hw}" y="${tile.cy - tile.hh}" width="${tile.hw * 2}" height="${tile.hh * 2}" rx="${tile.r}" />
    </clipPath>
    <clipPath id="ribbonBack"><rect x="0" y="0" width="${SPACE}" height="${RING.cy}" /></clipPath>
    <clipPath id="ribbonFront"><rect x="0" y="${RING.cy}" width="${SPACE}" height="${SPACE - RING.cy}" /></clipPath>
  </defs>
  <g transform="rotate(${deg} ${RING.cx} ${RING.cy})">
    <ellipse cx="${RING.cx}" cy="${RING.cy}" rx="${RING.a}" ry="${RING.b}" fill="none" stroke="url(#ring)" stroke-width="${RING.width * 2}" clip-path="url(#ribbonBack)" />
  </g>
  <rect x="${tile.cx - tile.hw}" y="${tile.cy - tile.hh}" width="${tile.hw * 2}" height="${tile.hh * 2}" rx="${tile.r}" fill="url(#tile)" />
  <g clip-path="url(#tileClip)">
    <rect x="${tile.cx - tile.hw}" y="${tile.cy - tile.hh}" width="${tile.hw * 2}" height="${tile.hh * 2}" fill="url(#gloss)" />
    <rect x="${tile.cx - tile.hw}" y="${tile.cy - tile.hh}" width="${tile.hw * 2}" height="${tile.hh * 2}" fill="url(#shade)" />
    <rect x="${tile.cx - tile.hw}" y="${tile.cy - tile.hh}" width="${tile.hw * 2}" height="${tile.hh * 2}" rx="${tile.r}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="4" />
  </g>
  <rect x="${inner.cx - inner.hw}" y="${inner.cy - inner.hh}" width="${inner.hw * 2}" height="${inner.hh * 2}" rx="${inner.r}" fill="url(#screen)" />
  <rect x="${inner.cx - inner.hw + 3}" y="${inner.cy - inner.hh + 3}" width="${inner.hw * 2 - 6}" height="${inner.hh * 2 - 6}" rx="${inner.r - 3}" fill="none" stroke="#5a4aa0" stroke-opacity="0.45" stroke-width="2" />
${strokes}
  <g transform="rotate(${deg} ${RING.cx} ${RING.cy})">
    <ellipse cx="${RING.cx}" cy="${RING.cy}" rx="${RING.a}" ry="${RING.b}" fill="none" stroke="url(#ring)" stroke-width="${RING.width * 2}" clip-path="url(#ribbonFront)" />
  </g>
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
  { file: 'brocode-mark-1024.png', size: 1024 },
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
