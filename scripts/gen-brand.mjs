/**
 * Generates every brand asset from one geometry definition.
 *
 *   node scripts/gen-brand.mjs
 *
 * Emits, with no image dependency at all (`zlib` plus a hand-rolled CRC32):
 *
 *   public/icons/icon-{16,32,48,128}.png   toolbar icons
 *   public/brand/mark.svg                  in-app header logo
 *   assets/brand/banner.svg                wide wordmark, for the README
 *
 * The geometry comes from `scripts/brand.mjs`, which records how each number was
 * measured off the source artwork in `assets/brand/source/`. Redrawing rather
 * than downscaling the JPEG is deliberate: the source is lossy, has no alpha and
 * carries a black backdrop, and its defining feature — a hairline rule — would
 * disappear at 16 px. Vector redraw gives crisp edges, real transparency, and
 * per-size optical tuning. See SIZE_TUNING for the one place measurements are
 * knowingly deviated from.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BRAND, MARK, MARK_UI_RULE, SIZE_TUNING, SVG_PADDING, TILE_RADIUS } from './brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------ PNG writing ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- the mark --------------------------------- */

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/**
 * The mark's parts in pixel space for one icon size.
 *
 * The mark is fitted by height (it is taller than it is wide) and centred. Rule
 * width and dot radius come from the size table; everything else is the source
 * geometry scaled.
 */
function geometry(size) {
  const tune = SIZE_TUNING[size];
  const contentH = size - 2 * tune.padding;
  const s = contentH / MARK.height;
  const cx = size / 2;
  const cy = size / 2;
  return {
    scale: s,
    disc: { x: cx + MARK.disc.cx * s, y: cy + MARK.disc.cy * s, r: MARK.disc.r * s },
    rule: { x: cx, y0: cy + MARK.rule.top * s, y1: cy + MARK.rule.bottom * s, w: tune.ruleWidth },
    dotNavy: { x: cx + MARK.dotNavy.cx * s, y: cy + MARK.dotNavy.cy * s, r: tune.dotR },
    dotTeal: { x: cx + MARK.dotTeal.cx * s, y: cy + MARK.dotTeal.cy * s, r: tune.dotR },
  };
}

function inTile(x, y, size) {
  const radius = TILE_RADIUS * size;
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  return Math.hypot(dx, dy) <= radius;
}

function sample(size, x, y) {
  if (!inTile(x, y, size)) return [0, 0, 0, 0];
  const g = geometry(size);
  const ink = hex(BRAND.ink);

  // Painted in order, the rule in its own colour, then the discs over it — the
  // same stacking as the artwork, where the rule passes behind the dots.
  let colour = ink;
  const onRule = Math.abs(x - g.rule.x) <= g.rule.w / 2 && y >= g.rule.y0 && y <= g.rule.y1;
  if (onRule) colour = hex(BRAND.navy);
  if (Math.hypot(x - g.disc.x, y - g.disc.y) <= g.disc.r) colour = hex(BRAND.light);
  // Re-draw the rule over the disc: in the source it cuts through it.
  if (onRule && Math.hypot(x - g.disc.x, y - g.disc.y) <= g.disc.r) colour = hex(BRAND.navy);
  if (Math.hypot(x - g.dotNavy.x, y - g.dotNavy.y) <= g.dotNavy.r) colour = hex(BRAND.navy);
  if (Math.hypot(x - g.dotTeal.x, y - g.dotTeal.y) <= g.dotTeal.r) colour = hex(BRAND.teal);

  return [...colour, 255];
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const [sr, sg, sb, sa] = sample(size, x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }
      const idx = (y * size + x) * 4;
      if (a > 0) {
        rgba[idx] = Math.round(r / a);
        rgba[idx + 1] = Math.round(g / a);
        rgba[idx + 2] = Math.round(b / a);
        rgba[idx + 3] = Math.round(a / (ss * ss));
      }
    }
  }
  return encodePng(size, size, rgba);
}

/* ------------------------------- SVG assets -------------------------------- */

const round = (n) => Number(n.toFixed(4));

/** The mark as SVG elements inside a `viewBox` whose centre is the origin. */
function markSvgParts({ ruleWidth = MARK.rule.width } = {}) {
  const half = MARK.height / 2;
  return {
    viewBox: `${round(-MARK.width / 2)} ${round(-half)} ${round(MARK.width)} ${MARK.height}`,
    body: [
      `<circle cx="${MARK.disc.cx}" cy="${MARK.disc.cy}" r="${MARK.disc.r}" fill="${BRAND.light}"/>`,
      `<rect x="${round(-ruleWidth / 2)}" y="${MARK.rule.top}" width="${ruleWidth}" height="${round(
        MARK.rule.bottom - MARK.rule.top,
      )}" fill="${BRAND.navy}"/>`,
      `<circle cx="${MARK.dotNavy.cx}" cy="${MARK.dotNavy.cy}" r="${MARK.dotNavy.r}" fill="${BRAND.navy}"/>`,
      `<circle cx="${MARK.dotTeal.cx}" cy="${MARK.dotTeal.cy}" r="${MARK.dotTeal.r}" fill="${BRAND.teal}"/>`,
    ].join(''),
  };
}

/** The header logo: the mark on the same tile as the PNG icons. */
function markSvg(size) {
  const { body } = markSvgParts({ ruleWidth: MARK_UI_RULE });
  const scale = (size * (1 - 2 * SVG_PADDING)) / MARK.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Pendle Frens">
<rect width="${size}" height="${size}" rx="${round(TILE_RADIUS * size)}" fill="${BRAND.ink}"/>
<g transform="translate(${size / 2} ${size / 2}) scale(${round(scale)})">
${body}
</g>
</svg>
`;
}

/**
 * The wide wordmark. Letter-spaced caps in the panel's own font stack, so it
 * reads as the same product rather than as a pasted-in image.
 */
function bannerSvg() {
  const { body } = markSvgParts();
  const width = 1200;
  const height = 320;
  // The mark's own coordinates are already centred on the origin.
  const markScale = (height * 0.62) / MARK.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Pendle Frens">
<rect width="${width}" height="${height}" fill="${BRAND.ink}"/>
<g transform="translate(230 ${height / 2}) scale(${round(markScale)})">
${body}
</g>
<text x="380" y="${height / 2 + 3}" fill="${BRAND.light}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="72" font-weight="600" letter-spacing="16" dominant-baseline="central">PENDLE FRENS</text>
</svg>
`;
}

/* ---------------------------------- emit ---------------------------------- */

const ICON_DIR = join(ROOT, 'public', 'icons');
const BRAND_DIR = join(ROOT, 'public', 'brand');
const ASSET_DIR = join(ROOT, 'assets', 'brand');
mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(BRAND_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

for (const size of Object.keys(SIZE_TUNING).map(Number)) {
  const file = join(ICON_DIR, `icon-${size}.png`);
  writeFileSync(file, render(size));
  console.log(`wrote ${file.replace(ROOT, '.')}`);
}
writeFileSync(join(BRAND_DIR, 'mark.svg'), markSvg(40));
console.log('wrote ./public/brand/mark.svg');
writeFileSync(join(ASSET_DIR, 'banner.svg'), bannerSvg());
console.log('wrote ./assets/brand/banner.svg');
