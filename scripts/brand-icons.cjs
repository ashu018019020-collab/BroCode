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
 *   public/brand/brocode-mark-1024.png     raster master at 2× the tile, transparent field
 *   public/brand/icon-{16,32,48,96}.png    favicon sizes, transparent behind the mark
 *   public/brand/icon-192.png              install icon (manifest, "any")
 *   public/brand/icon-512.png              install icon (manifest "any", OG card source)
 *   public/brand/maskable-512.png          mark inside the safe-area padding Android masks want
 *   public/brand/apple-touch-icon-180.png  iOS home screen (iOS paints black behind transparency)
 *   public/favicon.ico                     16/32/48 packed as PNG entries (what `/favicon.ico` needs)
 *
 * WHY PURE JS: `npm run og` needs a local Chrome/Edge, which a build box does not have. This renders
 * with signed-distance shapes and analytic antialiasing, so the mark is reproducible anywhere Node
 * runs, with no image library. Do not replace it with a manual export.
 *
 * The mark is the official BroCode diamond: two giant code chevrons `‹ ›` interlocked bottom-to-top,
 * their tube strokes gloss-shaded like the supplied 3D artwork — cyan → blue → violet → magenta
 * flowing through every arm, a dark extrusion peeking toward the centre slit, a soft gloss along
 * each tube's upper edge. The field outside the tubes is transparent everywhere except the two
 * launcher artifacts (maskable + apple-touch), which take a brand-navy plate: Android crops a
 * maskable icon to its own shape and iOS paints black behind alpha, so a plate is what keeps the
 * mark readable there. The tab icons and the manifest "any" icons stay fully transparent.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'brand');

/* ------------------------------- the mark -------------------------------- */

const SPACE = 512;
/** Tube half-width. 72 units ≈ 14% of the canvas, the supplied artwork's stroke proportion. */
const TUBE = 36;

/**
 * The two chevrons. Each is a bent capsule: from `tipTop` through `vertex` to `tipBot`, round caps,
 * round join. `stops` colour the tube along the path (t = 0 at the top tip, 0.5 at the bend, 1 at
 * the bottom tip); `shadow` is the extrusion offset — toward the centre slit, as in the artwork.
 */
const CHEVRONS = [
  {
    vertex: [50, 256],
    tipTop: [206, 50],
    tipBot: [206, 462],
    stops: [[0, [59, 130, 246]], [0.5, [59, 210, 250]], [1, [212, 40, 236]]],
    shadow: [24, 0],
  },
  {
    vertex: [462, 256],
    tipTop: [306, 50],
    tipBot: [306, 462],
    stops: [[0, [43, 105, 240]], [0.5, [176, 70, 244]], [1, [64, 196, 248]]],
    shadow: [-24, 0],
  },
];

const MARK_NORMAL = { chevrons: CHEVRONS, half: TUBE };

/**
 * 16–32 px is a different optical problem, not a smaller copy of the same one: a 36-unit stroke is
 * 1.1 px wide at 16 px and the mark melts into a faint smudge. The small variant is the same mark —
 * same chevrons, same gradients — with the tube re-inflated to ~16% of the canvas so the slit, the
 * bend and the diagonals survive at tab size.
 */
const MARK_SMALL = { chevrons: CHEVRONS, half: 42 };

/** The 3D render's extrusion: deep navy peeking out of the inner edges of every arm. */
const SHADOW_COLOR = [13, 28, 84];
/** The glossy highlight riding the upper edge of each tube. */
const GLOSS_ALPHA = 0.15;
/** Brand plate behind the launcher artifacts, corner-to-corner navy → deep indigo. */
const PLATE = [[0, [17, 24, 58]], [1, [40, 22, 80]]];

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

/** Distance to a segment, for the chevron arms. */
function sdSegment(x, y, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/**
 * Signed distance to one chevron (negative inside the tube) plus, for the point's colour, the path
 * parameter t (0 at the top tip → 0.5 at the bend → 1 at the bottom tip) and the signed lateral
 * offset from the nearest arm's centreline, positive toward the visually-up side — that is where
 * the gloss band sits.
 */
function chevronAt(c, half, x, y) {
  let best = Infinity;
  let t = 0.5;
  let lateral = 0;
  const arm = (tip, bottom) => {
    const d = sdSegment(x, y, c.vertex[0], c.vertex[1], tip[0], tip[1]);
    if (d >= best) return;
    const vx = tip[0] - c.vertex[0];
    const vy = tip[1] - c.vertex[1];
    const wx = x - c.vertex[0];
    const wy = y - c.vertex[1];
    const proj = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
    t = bottom ? (1 + proj) / 2 : (1 - proj) / 2;
    const vxu = vx / (Math.hypot(vx, vy) || 1);
    const vyu = vy / (Math.hypot(vx, vy) || 1);
    // normals: (vy,-vx) vs (-vy,vx) — take the one pointing up (screen y grows downward)
    const nx = vyu < 0 ? -vyu : vyu;
    const ny = vyu < 0 ? vxu : -vxu;
    lateral = (x - (c.vertex[0] + vxu * proj * Math.hypot(vx, vy))) * nx
      + (y - (c.vertex[1] + vyu * proj * Math.hypot(vx, vy))) * ny;
    best = d;
  };
  arm(c.tipTop, false);
  arm(c.tipBot, true);
  return { d: best - half, t, lateral };
}

/**
 * Colour + coverage for one point in mark space. `pxPerUnit` = output pixels per mark unit, which
 * is what turns a distance into analytic antialiased coverage. `plate` paints the brand background
 * first; without it the artifact is background-free and only the tubes carry alpha.
 */
function sample(x, y, { scale = 1, pxPerUnit, mark, plate = false }) {
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

  const mx = (x - SPACE / 2) / scale + SPACE / 2;
  const my = (y - SPACE / 2) / scale + SPACE / 2;

  if (plate) put(gradient(PLATE, clamp01(x / SPACE) * 0.5 + clamp01(y / SPACE) * 0.5), 1);

  // Paint every extrusion, then the faces over them.
  for (const c of mark.chevrons) {
    const shifted = chevronAt(c, mark.half, mx - c.shadow[0], my - c.shadow[1]);
    put(SHADOW_COLOR, cover(shifted.d));
  }

  let toFace = Infinity;
  for (const c of mark.chevrons) {
    const at = chevronAt(c, mark.half, mx, my);
    if (at.d < toFace) toFace = at.d;
  }
  const faceCover = cover(toFace);
  if (faceCover > 0) {
    // the arm whose tube owns this pixel supplies the colour along its path
    const owned = mark.chevrons
      .map((c) => ({ c, at: chevronAt(c, mark.half, mx, my) }))
      .sort((p, q) => p.at.d - q.at.d)[0];
    put(gradient(owned.c.stops, owned.at.t), faceCover);
    // gloss: a soft white band in the upper half of the tube of whichever arm owns the pixel
    const half = mark.half;
    if (owned.at.lateral > half * 0.12 && owned.at.lateral < half * 0.52) {
      put([255, 255, 255], faceCover * GLOSS_ALPHA);
    }
  }
  return { r, g, b, a };
}

/** Render one square, straight-alpha RGBA buffer. */
function render(size, options = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const pxPerUnit = size / SPACE;
  const scale = options.scale ?? 1;
  const mark = options.mark ?? (size <= 32 ? MARK_SMALL : MARK_NORMAL);
  // tubes are 1.1 mark units per pixel at 16 px: sampling once per pixel would alias the slit away.
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
          const c = sample(markX, markY, {
            scale, pxPerUnit: pxPerUnit * scale, mark, plate: options.plate,
          });
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
  const defs = [];
  const strokes = [];
  CHEVRONS.forEach((c, i) => {
    const width = MARK_NORMAL.half * 2;
    // per-arm gradients: SVG cannot bend a linear gradient around the corner of a path
    const armGrad = (id, tip, colorAtTip) => {
      defs.push(`<linearGradient id="${id}" x1="${tip[0]}" y1="${tip[1]}" x2="${c.vertex[0]}" y2="${c.vertex[1]}" gradientUnits="userSpaceOnUse">`
        + `<stop offset="0" stop-color="${hex(colorAtTip)}" /><stop offset="1" stop-color="${hex(gradient(c.stops, 0.5))}" /></linearGradient>`);
    };
    armGrad(`face${i}a`, c.tipTop, c.stops[0][1]);
    armGrad(`face${i}b`, c.tipBot, c.stops[2][1]);
    const d = `M ${c.tipTop[0]} ${c.tipTop[1]} L ${c.vertex[0]} ${c.vertex[1]} L ${c.tipBot[0]} ${c.tipBot[1]}`;
    strokes.push(`<path d="${d}" transform="translate(${c.shadow[0]} ${c.shadow[1]})" stroke="${hex(SHADOW_COLOR)}" stroke-width="${width}" />`);
    strokes.push(`<path d="M ${c.tipTop[0]} ${c.tipTop[1]} L ${c.vertex[0]} ${c.vertex[1]}" stroke="url(#face${i}a)" stroke-width="${width}" />`);
    strokes.push(`<path d="M ${c.tipBot[0]} ${c.tipBot[1]} L ${c.vertex[0]} ${c.vertex[1]}" stroke="url(#face${i}b)" stroke-width="${width}" />`);
    strokes.push(`<path d="${d}" transform="translate(0 -15)" stroke="rgba(255,255,255,${GLOSS_ALPHA})" stroke-width="22" />`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="BroCode">
  <!-- Generated by scripts/brand-icons.cjs — edit the geometry there, never this file. -->
  <defs>
${defs.map((d) => `    ${d}`).join('\n')}
  </defs>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
${strokes.map((s) => `    ${s}`).join('\n')}
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
  // The raster master: the supplied artwork's own resolution, transparent, for any export
  // (social card, docs, store listings) that needs more than the 512 tile.
  { file: 'brocode-mark-1024.png', size: 1024 },
  // Launchers get the brand plate. Android crops a maskable icon to its own shape and iOS paints
  // black behind alpha, so these two are the only artifacts that are not background-free.
  { file: 'maskable-512.png', size: 512, options: { scale: 0.78, plate: true } },
  { file: 'apple-touch-icon-180.png', size: 180, options: { scale: 0.86, plate: true } },
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
