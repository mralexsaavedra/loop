#!/usr/bin/env node
/* Regenerate the LOOP logo assets in web/src/assets/ (the geometry lives in scripts/loop-logo.mjs):
 *   loop-wordmark.svg   the "LOOP" wordmark, inlined in Inicio (web/src/tabs/Home.astro)
 *   loop-icon.svg       the 128 px rounded tile icon (master copy)
 *   loop-favicon.svg    the 32 px tile, the page's <link rel="icon"> (data: URI, web/layouts/Plan.astro)
 *   loop-touch-icon.png the 180×180 full-square tile, the page's apple-touch-icon (data: URI)
 *
 * The L and P of the wordmark are OUTLINES of Syncopate Bold (Astigmatic, Apache License 2.0, see
 * web/src/fonts/LICENSE-Syncopate.txt): the page never loads the font. The font file is not committed;
 * fetch it from Google Fonts' repository:
 *   https://raw.githubusercontent.com/google/fonts/main/apache/syncopate/Syncopate-Bold.ttf
 *   (sha256 c71f5a40a83115518443c13474e5132804f4a91ce26e26fd9718cd3814ad4b2e)
 * fontkitten (glyph outlines) and sharp (SVG → PNG) are Astro's own dependencies, nothing extra to install.
 *
 * Usage: node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'fontkitten';
import sharp from 'sharp';
import { wordmarkSvg, iconSvg, ICONS } from './loop-logo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'src', 'assets');

const fontPath = process.argv[2];
if (!fontPath) {
  console.error('usage: node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf');
  process.exit(1);
}
const font = create(fs.readFileSync(fontPath));
if (!/Syncopate/.test(font.familyName) || font.unitsPerEm !== 2048) throw new Error(`not Syncopate Bold: ${font.familyName}`);
const glyph = (ch) => {
  const g = font.glyphForCodePoint(ch.codePointAt(0));
  return { d: g.path.toSVG(), advance: g.advanceWidth, minX: g.bbox.minX, maxX: g.bbox.maxX };
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'loop-wordmark.svg'), wordmarkSvg({ unitsPerEm: font.unitsPerEm, L: glyph('L'), P: glyph('P') }));
fs.writeFileSync(path.join(OUT, 'loop-icon.svg'), iconSvg(ICONS.icon));
fs.writeFileSync(path.join(OUT, 'loop-favicon.svg'), iconSvg(ICONS.favicon));
await sharp(Buffer.from(iconSvg(ICONS.touch)))
  .png({ compressionLevel: 9, palette: false })
  .toFile(path.join(OUT, 'loop-touch-icon.png'));
console.log(`wrote ${fs.readdirSync(OUT).filter((f) => f.startsWith('loop-')).join(', ')} to ${path.relative(ROOT, OUT)}/`);
