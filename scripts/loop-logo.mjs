/* The LOOP logo, as pure functions (no I/O): the ring geometry, the tile icons and the wordmark.
 * scripts/make-logo.mjs feeds them the Syncopate Bold outlines and writes the committed assets in
 * web/src/assets/ (scripts/loop-logo.test.mjs pins both the geometry and the committed files).
 *
 * The symbol is a ring of THREE arcs in a 100×100 box, clockwise from 12 o'clock: sleep, recovery,
 * strain (the page's three dials). For a stroke width sw: r = 50 − sw/2 (the stroke stays inside the
 * box), C = 2πr, each third = C/3, each arc L = third − sw − 3 with round caps (so 3 units of gap show
 * between two arcs), dasharray "L C−L", first arc rotated −90° + half the dash gap in degrees, the
 * next two +120° / +240°. The wordmark "LOOP" draws L and P as Syncopate Bold outlines and both O as
 * rings: a plain white one, then the three-arc one. */

export const COLORS = {
  sleep: '#7ba1bb', // --sleep
  recovery: '#19ec06', // --good
  strain: '#0093e7', // --strain
  ink: '#ffffff', // --ink
  tileTop: '#283037', // --ground-top
  tileBottom: '#111619', // --ground
};

// the arcs in clockwise order from 12 o'clock: [class, colour]; the class maps to the token in the page
const ARCS = [
  ['lw-sleep', COLORS.sleep],
  ['lw-recovery', COLORS.recovery],
  ['lw-strain', COLORS.strain],
];

/* Tile icons: `size` px square, the ring `ring` px wide centred in it, stroke width `sw` in the ring's
 * 100-unit box, corner radius `radius` (0 = a full square: iOS rounds the home-screen icon itself). */
export const ICONS = {
  icon: { size: 128, ring: 80, sw: 11, radius: 28 },
  favicon: { size: 32, ring: 24, sw: 14, radius: 7 },
  touch: { size: 180, ring: 112.5, sw: 11, radius: 0 },
};

/* Wordmark proportions, in em of the letters' font size. Syncopate's caps are 0.67em, its O 0.71em.
 * inkGapEm = the visible gap between any two neighbours (L|O, O|O, O|P), measured ink to ink: the
 * glyphs' side bearings differ (P's left one is ~0.105em), so advance-based spacing looked uneven. */
export const WORDMARK = {
  sw: 18,
  ringEm: 0.71,
  overshootEm: 0.02,
  inkGapEm: 0.14,
};

const fmt = (n) => String(Number(n.toFixed(3)));

export function ringGeometry(sw) {
  const r = 50 - sw / 2;
  const C = 2 * Math.PI * r;
  const third = C / 3;
  const arc = third - sw - 3;
  const start = -90 + (((third - arc) / C) * 360) / 2;
  return { r, C, third, arc, starts: [start, start + 120, start + 240] };
}

/* One ring in its 100×100 box: 'plain' = a currentColor circle, 'arcs' = the three coloured arcs
 * (each with its token class unless `classes` is false, and the hex as the attribute fallback). */
export function ringMarkup(sw, kind, { classes = true } = {}) {
  const g = ringGeometry(sw);
  const base = `cx="50" cy="50" r="${fmt(g.r)}" fill="none"`;
  if (kind === 'plain') return `<circle ${base} stroke="currentColor" stroke-width="${fmt(sw)}"/>`;
  return ARCS.map(([cls, colour], i) =>
    `<circle ${classes ? `class="${cls}" ` : ''}${base} stroke="${colour}" stroke-width="${fmt(sw)}" stroke-linecap="round" stroke-dasharray="${fmt(g.arc)} ${fmt(g.C - g.arc)}" transform="rotate(${fmt(g.starts[i])} 50 50)"/>`,
  ).join('');
}

export function iconSvg({ size, ring, sw, radius }) {
  const o = (size - ring) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.tileTop}"/><stop offset="1" stop-color="${COLORS.tileBottom}"/></linearGradient></defs>` +
    `<rect width="${size}" height="${size}"${radius ? ` rx="${radius}"` : ''} fill="url(#t)"/>` +
    `<g transform="translate(${fmt(o)} ${fmt(o)}) scale(${fmt(ring / 100)})">${ringMarkup(sw, 'arcs', { classes: false })}</g>` +
    '</svg>\n'
  );
}

/* Wordmark layout in 1000-unit em, y down, baseline at y = 0. Glyphs come in font units (y up):
 * { d, advance, minX, maxX } for L and P (minX / maxX = the ink's horizontal extent), plus the font's
 * unitsPerEm. */
export function wordmarkLayout({ unitsPerEm, L, P }) {
  const s = 1000 / unitsPerEm;
  const size = WORDMARK.ringEm * 1000;
  const y = WORDMARK.overshootEm * 1000 - size;
  const gap = WORDMARK.inkGapEm * 1000;
  // x = where the next ink starts: after L's ink, after each ring
  let x = L.maxX * s + gap;
  const rings = [];
  for (let i = 0; i < 2; i++) {
    rings.push({ x, y, size });
    x += size + gap;
  }
  const p = { x: x - P.minX * s }; // P's origin, so its ink (not its side bearing) starts at x
  const left = L.minX * s;
  return {
    scale: s,
    l: { x: 0 },
    rings,
    p,
    viewBox: { x: left, y, w: p.x + P.maxX * s - left, h: size },
  };
}

export function wordmarkSvg(glyphs) {
  const lay = wordmarkLayout(glyphs);
  const s = fmt(lay.scale);
  const letter = (g, x) => `<path fill="currentColor" transform="matrix(${s} 0 0 -${s} ${fmt(x)} 0)" d="${g.d}"/>`;
  const ring = (r, kind) => `<g transform="translate(${fmt(r.x)} ${fmt(r.y)}) scale(${fmt(r.size / 100)})">${ringMarkup(WORDMARK.sw, kind)}</g>`;
  const vb = lay.viewBox;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}" role="img" aria-label="LOOP">` +
    letter(glyphs.L, lay.l.x) +
    ring(lay.rings[0], 'plain') +
    ring(lay.rings[1], 'arcs') +
    letter(glyphs.P, lay.p.x) +
    '</svg>\n'
  );
}
