/* The client scripts run the lib's OWN pure functions, emitted at build time (clientSource, inlined by
 * layouts/Plan.astro before util.js), never hand-kept copies: HC_ADH = lib/nutrition/adherence.mjs.
 * Guard: the client files no longer define the copied functions, and the built page carries the
 * emitted source before the script that uses it. Reads the fixture built by `npm run pretest`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimScript } from '../src/slim-script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
const src = (name) => fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', name), 'utf8');

// client file -> the global it reads + the lib functions it must not re-define
const COPIES = {
  'adherence.js': { global: 'HC_ADH', fns: ['fin', 'isComplete', 'dayState', 'adherence'] },
};

for (const [file, { global, fns }] of Object.entries(COPIES)) {
  test(`${file} defines none of the lib's functions (${fns.join(', ')}) and reads them from ${global}`, () => {
    const s = src(file);
    for (const fn of fns) assert.doesNotMatch(s, new RegExp(`function ${fn}\\(`), `${file}: function ${fn} is a copy of the lib`);
    assert.match(s, new RegExp(`\\b${global}\\b`), `${file} reads ${global}`);
  });

  test(`the built page inlines var ${global} (clientSource) before ${file}`, () => {
    assert.ok(html, `missing ${htmlPath}: run npm run pretest`);
    const g = html.indexOf(`var ${global}=`) >= 0 ? html.indexOf(`var ${global}=`) : html.indexOf(`var ${global} =`);
    const at = html.indexOf(slimScript(src(file)));
    assert.ok(g > 0, `var ${global} inlined`);
    assert.ok(at > 0, `${file} inlined whole`);
    assert.ok(g < at, `${global} before ${file}`);
  });
}
