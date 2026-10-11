/* Avatar button + profile sheet, build level (components/Avatar.astro, layouts/Plan.astro): the top bar
 * carries ONE avatar button that opens the `profile` view of the detail sheet; PROFILE is baked with the
 * photo reduced to a flag; a photo is inlined ONCE as a data URI (single file, no request); with no
 * profile data at all the button shows a generic icon. SYNTHETIC inputs only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { es as esP, en as enP } from '../src/i18n/profile-templates.mjs';
import { loadInputs } from '../../lib/load/inputs.mjs';
import { resolveTargets } from '../../lib/nutrition/targets.mjs';
import { goalOptions } from '../../lib/profile/goal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);
const exampleHtml = () => fs.readFileSync(path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html'), 'utf8');
const topbar = (html) => (html.match(/<div class="topbar"[^>]*>([\s\S]*?)<nav class="tabnav"/) || [])[1] || '';
const baked = (html) => JSON.parse(html.match(/var PROFILE = (\{[\s\S]*?\});\n/)[1]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);

function keyTree(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keyTree(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
}

/** Build a throwaway repo root: the tracked nutrition seeds (+ `files`: relative path -> content). */
function build({ mode, files = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-build-'));
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'nutrition'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'data', 'training'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'nutrition', 'ingredients.json'), path.join(tmp, 'data', 'nutrition', 'ingredients.json'));
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'training', 'training-data.example.json'), path.join(tmp, 'data', 'training', 'training-data.example.json'));
    const plan = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.example.json');
    fs.copyFileSync(plan, path.join(tmp, 'data', 'nutrition', mode === 'example' ? 'plan-data.example.json' : 'plan-data.json'));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), content);
    }
    const outDir = path.join(tmp, 'out');
    const r = spawnSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'astro'), ['build', '--root', WEB_ROOT, '--outDir', outDir], {
      env: { ...process.env, HC_REPO_ROOT: tmp, DATA_MODE: mode, LOCALE: 'en' },
      encoding: 'utf8',
    });
    const htmlPath = path.join(outDir, 'index.html');
    return { r, html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('profile-templates.mjs has identical key trees in es/en and no empty strings', () => {
  assert.deepEqual(keyTree(esP), keyTree(enP));
  for (const dict of [esP, enP]) for (const k of keyTree(dict)) assert.notEqual(String(k.split('.').reduce((o, p) => o[p], dict)).trim(), '', k);
});

test('example build: ONE avatar button in the top bar (initials, no photo) opening the profile view; PROFILE baked, profile.js before detail.js', () => {
  const html = exampleHtml();
  const bar = topbar(html);
  assert.equal((html.match(/id="avatar-btn"/g) || []).length, 1);
  assert.match(bar, /<button type="button" id="avatar-btn" class="avatar-btn" data-detail="profile" aria-haspopup="dialog" aria-label="Open profile">/);
  assert.match(bar, /<span class="avatar-ini" aria-hidden="true">[A-Z]{1,2}<\/span>/);
  assert.doesNotMatch(bar, /<img/);
  const p = baked(html);
  assert.equal(p.photo, false);
  assert.equal(p.hasData, true);
  assert.ok(p.bikes.length && p.shoes.length && p.devices.length);
  assert.equal('age' in p, false, 'the age is computed client-side');
  assert.equal('hiddenDevices' in p, false, 'hidden names are applied at build time, never baked');
  assert.ok(!p.devices.some((d) => d.name === 'Demo Phone App'));
  assert.equal(p.devices.find((d) => d.manual).manual, 'sample-bike-computer-manual.pdf', 'only the manual file name is baked');  assert.ok(html.indexOf('HC.registerView("profile"') < html.indexOf('var VIEW_HASH_RE'), 'profile.js registers its view before detail.js runs');
  const { plan } = loadInputs({ repoRoot: REPO_ROOT, dataMode: 'example' });
  assert.deepEqual(p.goals, goalOptions(resolveTargets(plan)), 'the goal setting\'s options are the lib\'s own');
  assert.equal(p.goals.length, 3);
  assert.ok(html.indexOf('window.HCNutri={') < html.indexOf('HC.registerView("profile"'), 'nutri-day.js (the goal\'s owner) runs before profile.js');
  const nav = (html.match(/<nav class="tabnav"[\s\S]*?<\/nav>/) || [''])[0];
  assert.ok(nav && !nav.includes('profile'), 'not a tab');
});

test('build-level: a photo is inlined ONCE as a data URI in the button; PROFILE keeps only a flag; nothing is fetched', () => {
  const { r, html } = build({
    mode: 'personal',
    files: {
      'profile/profile.json': JSON.stringify({ birthdate: '1990-01-02', heightCm: 170 }),
      'data/profile/strava-profile.json': JSON.stringify({ fetchedAt: '2030-01-01T00:00:00Z', firstname: 'Pat', lastname: 'Demo', bikes: [], shoes: [], devices: [] }),
      'data/profile/avatar.jpg': JPEG,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const b64 = JPEG.toString('base64');
  assert.equal(html.split(b64).length - 1, 1, 'the image bytes appear exactly once');
  assert.match(topbar(html), /<img id="avatar-img" class="avatar-img" src="data:image\/jpeg;base64,/);
  assert.equal(baked(html).photo, true);
  assert.equal(baked(html).name, 'Pat Demo');
});

test('build-level: no profile data at all -> a generic icon and hasData false (the sheet shows the onboarding hint)', () => {
  const { r, html } = build({ mode: 'personal' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(topbar(html), /<svg class="avatar-icon"/);
  assert.equal(baked(html).hasData, false);
});

test('build-level: a malformed profile/profile.json does NOT fail the build: a clear warning, the file ignored, Strava data kept', () => {
  const { r, html } = build({
    mode: 'personal',
    files: {
      'profile/profile.json': JSON.stringify({ heightCm: 'tall', name: 'Ignored Name' }),
      'data/profile/strava-profile.json': JSON.stringify({ fetchedAt: '2030-01-01T00:00:00Z', firstname: 'Pat', lastname: 'Demo', bikes: [], shoes: [], devices: [] }),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr + r.stdout, /WARNING: .*profile\.json is invalid[\s\S]*heightCm/);
  assert.equal(baked(html).name, 'Pat Demo');
  assert.equal(baked(html).heightCm, null);
});
