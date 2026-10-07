#!/usr/bin/env node
/* Rebuild web/src/fonts/hc-text.woff2: the "HC Text" subset of Inter (the page's text font, inlined
 * as base64 @font-face by web/layouts/Plan.astro).
 *
 * Source: InterVariable.ttf from the official Inter 4.1 release archive
 *   https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
 *   (sha256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e)
 * Inter is SIL OFL 1.1 with NO Reserved Font Name (see web/src/fonts/OFL-Inter.txt), so the subset may
 * keep its name; the page still calls it "HC Text" (like "HC Num") so a locally installed full Inter
 * never mixes with the subset.
 *
 * What it keeps: the code points of web/src/fonts/text-font-ranges.mjs; the weight axis cut to
 * 400-800 (every weight the CSS uses: 400 to 800, incl. 650 / 750) and the optical-size axis pinned
 * to 14 (text); the default-on shaping features (kerning, ligatures, contextual alternates, marks) and
 * NOT `tnum`: the page sets `font-variant-numeric: tabular-nums` on body (for the "HC Num" numerals),
 * and Inter's tabular set also widens the hyphen, colon and space, which gaps running text
 * ("7 - day"). Text figures stay proportional; aligned numbers use --num. harfbuzz (subset-font, a
 * devDependency) does the subsetting and instancing.
 *
 * Usage: node scripts/subset-text-font.mjs path/to/InterVariable.ttf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { subsetText } from '../web/src/fonts/text-font-ranges.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'src', 'fonts', 'hc-text.woff2');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('usage: node scripts/subset-text-font.mjs path/to/InterVariable.ttf (from Inter-4.1.zip)');
  process.exit(1);
}
const out = await subsetFont(fs.readFileSync(src), subsetText(), {
  targetFormat: 'woff2',
  variationAxes: { wght: { min: 400, max: 800 }, opsz: 14 },
  keepFeatures: ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig', 'case'],
});
fs.writeFileSync(OUT, out);
console.log(`${path.relative(ROOT, OUT)} ${out.length} bytes`);
