/* Page header (web/layouts/Plan.astro): page.h1 / page.sub are optional. Without them the page opens
 * straight onto the dials: no visible header, a visually hidden <h1> from page.title keeps one h1 in
 * the document. The top bar always carries the date line host (filled client-side by
 * client/today-date.js, so nothing time-based is baked) next to the freshness line / Sync button.
 * Since the navigation shell (2026-10), no build draws a hero header: page.h1 (else page.title) is the
 * visually hidden h1, and page.kicker / page.sub are accepted but not drawn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { astroBuild } from '../../scripts/lib/astro-build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const REPO_ROOT = path.dirname(WEB_ROOT);
const exampleHtmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const examplePlanPath = path.join(REPO_ROOT, 'data', 'nutrition', 'plan-data.example.json');

const h1s = (html) => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
const topbar = (html) => (html.match(/<header class="topbar"[^>]*>([\s\S]*?)<div class="dock"/) || [])[1] || '';

/** Build the tracked example inputs under os.tmpdir() with the page block edited by `edit`. */
function buildWithPage(edit) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'header-'));
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'nutrition'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'data', 'training'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'nutrition', 'ingredients.json'), path.join(tmp, 'data', 'nutrition', 'ingredients.json'));
    fs.copyFileSync(path.join(REPO_ROOT, 'data', 'training', 'training-data.example.json'), path.join(tmp, 'data', 'training', 'training-data.example.json'));
    const plan = JSON.parse(fs.readFileSync(examplePlanPath, 'utf8'));
    plan.page = edit({ ...plan.page });
    fs.writeFileSync(path.join(tmp, 'data', 'nutrition', 'plan-data.example.json'), JSON.stringify(plan));
    const outDir = path.join(tmp, 'out');
    const r = astroBuild({ root: WEB_ROOT, outDir,
      env: { ...process.env, HC_REPO_ROOT: tmp, DATA_MODE: 'example', LOCALE: 'en' },
    });
    const htmlPath = path.join(outDir, 'index.html');
    return { r, html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('example build: page.h1 is the one visually hidden h1, no hero (kicker / sub) is drawn, and the top bar carries the (empty, client-filled) date line next to the freshness group', () => {
  const html = fs.readFileSync(exampleHtmlPath, 'utf8');
  const plan = JSON.parse(fs.readFileSync(examplePlanPath, 'utf8'));
  const all = h1s(html);
  assert.equal(all.length, 1, 'exactly one h1');
  assert.match(all[0][0], /<h1 class="sr-only"/);
  assert.ok(all[0][1].includes(plan.page.h1.replace(/&/g, '&amp;')));
  assert.doesNotMatch(html, /<header>|<p class="sub">|class="kicker"/);
  const bar = topbar(html);
  assert.match(bar, /<time id="today-date" class="today-date"><\/time>/, 'no date baked: builds stay byte-identical');
  assert.match(bar, /id="freshness"/);
});

test('build-level: without page.h1 / page.sub (and kicker) there is no visible header, one visually hidden h1 from the title, and no empty subtitle', () => {
  const { r, html } = buildWithPage((p) => { delete p.h1; delete p.sub; delete p.kicker; return p; });
  assert.equal(r.status, 0, r.stderr);
  const all = h1s(html);
  assert.equal(all.length, 1, 'the document keeps exactly one h1');
  assert.match(all[0][0], /<h1 class="sr-only"/);
  assert.ok(all[0][1].includes('Weekly Nutrition Plan'), 'the page title');
  assert.doesNotMatch(html, /<header>/, 'no visible header block');
  assert.doesNotMatch(html, /class="sub"/);
  assert.match(topbar(html), /<time id="today-date" class="today-date"><\/time>/);
});
