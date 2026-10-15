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
 * A contributor-only tool (docs/development.md → Contributor-only tools). It needs fontkitten (glyph outlines)
 * and sharp (SVG → PNG), which are NOT declared in package.json: they arrive as Astro's own dependencies
 * after `npm ci`. Imported lazily, so a missing one is one clear ERROR line (exit 1), not a stack trace.
 *
 * Usage: node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordmarkSvg, iconSvg, ICONS } from './loop-logo.mjs';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'src', 'assets');
const USAGE = 'usage: node scripts/make-logo.mjs path/to/Syncopate-Bold.ttf';

/** The two optional packages, imported on demand; a missing one -> an Error naming both and how to get them.
 * `importer` is injectable for the test. */
export async function loadDeps(importer = (/** @type {string} */ m) => import(m)) {
  try {
    const [fk, sh] = await Promise.all([importer('fontkitten'), importer('sharp')]);
    return { create: fk.create, sharp: sh.default };
  } catch (err) {
    throw new Error(`make-logo needs the optional packages fontkitten and sharp (Astro's own dependencies, not declared in package.json): run npm ci, or npm install --no-save fontkitten sharp (${(err && err.message) || err})`, { cause: err });
  }
}

async function main(argv) {
  const fontPath = argv[0];
  if (!fontPath || argv.length > 1) {
    console.error(USAGE);
    return 1;
  }
  const { create, sharp } = await loadDeps();
  const font = /** @type {import('fontkitten').Font} */ (create(fs.readFileSync(fontPath)));
  if (!/Syncopate/.test(font.familyName) || font.unitsPerEm !== 2048) throw new Error(`not Syncopate Bold: ${font.familyName}`);
  const glyph = (/** @type {string} */ ch) => {
    const g = font.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0)));
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
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(`ERROR: ${(err && err.message) || err}`);
    process.exitCode = 1;
  });
}
