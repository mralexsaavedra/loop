/* The code points of the "HC Text" subset (Inter, SIL OFL 1.1): ONE list, read by
 * scripts/subset-text-font.mjs (what goes into hc-text.woff2) and by web/layouts/Plan.astro (the
 * @font-face unicode-range), so a character outside the subset falls back to the system sans.
 * Basic Latin + Latin-1 (every Spanish letter and sign: á é í ó ú ü ñ ¿ ¡ º ª « » ° ± · ½ ×), plus
 * the typographic signs the page prints (dashes, quotes, ellipsis, arrows, ≈ ≥ ≤ −, Δ, ₂, €, ▲ ▼ ■).
 * Emoji and ✓ stay on the system fonts. */
export const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x394, 0x394],
  [0x2013, 0x2014],
  [0x2018, 0x201d],
  [0x2022, 0x2022],
  [0x2026, 0x2026],
  [0x2032, 0x2032],
  [0x2039, 0x203a],
  [0x2082, 0x2082],
  [0x20ac, 0x20ac],
  [0x2190, 0x2193],
  [0x2212, 0x2212],
  [0x2248, 0x2248],
  [0x2264, 0x2265],
  [0x25a0, 0x25a0],
  [0x25b2, 0x25b2],
  [0x25bc, 0x25bc],
];

const hex = (n) => n.toString(16).toUpperCase();

/** Every character of the subset, as one string (the subsetter's input). */
export function subsetText() {
  let s = '';
  for (const [a, b] of RANGES) for (let c = a; c <= b; c++) s += String.fromCodePoint(c);
  return s;
}

/** The CSS unicode-range value, e.g. "U+20-7E,U+A0-FF,U+394,…". */
export function unicodeRange() {
  return RANGES.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(',');
}
