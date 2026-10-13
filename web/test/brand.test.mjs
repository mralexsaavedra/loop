/* The LOOP brand in the built page (web/layouts/Plan.astro): the product
 * name as the document title, the tile favicon + home-screen icon as data: URIs (the page stays one
 * self-contained file), and the wordmark inside the top bar on every tab (layouts/Plan.astro), its arcs coloured by the
 * score tokens. The geometry itself is pinned by scripts/loop-logo.test.mjs.
 * Run `npm run pretest` (or `npm test`) first: it reads an already-built fixture. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssRules } from './css-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const html = fs.readFileSync(path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const rules = parseCssRules(css);
const decl = (selector, prop) => rules.filter((r) => r.selector === selector).flatMap((r) => r.decls).find(([p]) => p === prop)?.[1];

test('the document is titled with the product name, also as the home-screen app name', () => {
  assert.match(head, /<title>LOOP<\/title>/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="LOOP"\s*\/?>/);
});

test('favicon: the tile SVG inlined as a data: URI (no request)', () => {
  const m = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)"\s*\/?>/.exec(head);
  assert.ok(m, 'an SVG favicon link');
  const svg = decodeURIComponent(m[1]);
  assert.equal(svg, fs.readFileSync(path.join(WEB_ROOT, 'src', 'assets', 'loop-favicon.svg'), 'utf8'));
});

test('home-screen icon: a 180×180 PNG apple-touch-icon inlined as base64', () => {
  const m = /<link rel="apple-touch-icon" href="data:image\/png;base64,([^"]+)"\s*\/?>/.exec(head);
  assert.ok(m, 'an apple-touch-icon link');
  const png = Buffer.from(m[1], 'base64');
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
  assert.ok(m[1].length < 12 * 1024, `apple-touch-icon payload ${m[1].length} B stays small`);
});

test('the wordmark sits inside the top bar, between the avatar and the date pill, before every tab panel, once', () => {
  const at = html.indexOf('<button type="button" class="wordmark"');
  assert.ok(at > html.indexOf('<div class="topbar"'), 'inside the top bar');
  assert.ok(at > html.indexOf('id="avatar-btn"') && at < html.indexOf('class="date-pill"'), 'avatar · wordmark · pill');
  assert.ok(at < html.indexOf('<div class="dock"'), 'before the dock');
  assert.ok(at < html.indexOf('class="tab-panel"'), 'before the panels');
  const mark = /<button type="button" class="wordmark"[^>]*>([\s\S]*?)<\/button>/.exec(html)[1];
  assert.match(mark, /^<svg [^>]*role="img"[^>]*aria-label="LOOP"/);
  assert.doesNotMatch(mark, /<text\b|font-family/, 'outlines, never the font');
  assert.equal([...html.matchAll(/class="wordmark"/g)].length, 1);
});

test('the wordmark is a button back to Inicio (the default tab, scrolled to the top), named for screen readers', () => {
  const tag = /<button type="button" class="wordmark"[^>]*>/.exec(html)[0];
  assert.match(tag, /onclick="setTab\(defaultTab\(\)\)"/, 'the first visible tab = Inicio unless page.hideTabs hides it');
  assert.match(tag, /aria-label="LOOP · Home"/);
});

test('the wordmark shows on every tab: no rule hides it while the home panel is hidden', () => {
  assert.ok(!rules.some((r) => r.selector.includes('[hidden])') && r.selector.includes('wordmark')), 'never hidden off Inicio');
});

test('the wordmark arcs take the score tokens, so the colours stay single-sourced', () => {
  assert.equal(decl('.wordmark .lw-sleep', 'stroke'), 'var(--sleep)');
  assert.equal(decl('.wordmark .lw-recovery', 'stroke'), 'var(--good)');
  assert.equal(decl('.wordmark .lw-strain', 'stroke'), 'var(--strain)');
  assert.equal(decl('.wordmark', 'color'), 'var(--ink)');
  assert.equal(decl('.wordmark', 'justify-content'), 'center');
});

test('the shipped page never names the reference app', () => {
  assert.doesNotMatch(html, /whoop/i);
});
