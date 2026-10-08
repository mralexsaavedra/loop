/* Navigation shell (web/layouts/Plan.astro + web/src/tabs/Home.astro) on the built example page:
 * - top bar: avatar left · centred date pill "‹ Today ›" (the client-filled <time> inside; the day
 *   stepping chevrons ship hidden, client/today-date.js shows them) · freshness / Sync right;
 * - the bottom dock: the tab bar (role=tablist, four role=tab buttons, aria-pressed on the active one)
 *   and, outside the tablist, the "+" action button + its popover, shipped HIDDEN (nav-actions.js
 *   reveals only the actions that exist on this page: never a dead control in a static build);
 * - the collapsed dial row host (#home-mini) inside the Inicio panel. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/i18n/en.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(path.dirname(here), '.test-dist', 'en-example', 'index.html'), 'utf8');
const N = en.strings.nav;

const between = (start, end) => {
  const i = html.indexOf(start);
  assert.ok(i !== -1, `missing ${start}`);
  const j = html.indexOf(end, i);
  return html.slice(i, j === -1 ? undefined : j);
};

test('top bar: avatar first, then the centred "Today" pill with the empty client-filled date, then freshness', () => {
  const bar = between('<div class="topbar"', '<div class="dock"');
  const avatar = bar.indexOf('id="avatar-btn"');
  const pill = bar.indexOf('class="date-pill"');
  const fresh = bar.indexOf('id="freshness"');
  assert.ok(avatar !== -1 && avatar < pill && pill < fresh, 'avatar · pill · freshness');
  assert.match(bar, new RegExp(`<span class="date-pill-lbl" id="day-word" aria-hidden="true">${N.today}</span>`));
  assert.match(bar, /<time id="today-date" class="today-date"><\/time>/, 'nothing time-based baked');
});

test('top bar pill: ‹ / › day-stepping buttons ship hidden with their labels; the date label is a live, "back to today" button', () => {
  const bar = between('<div class="date-pill"', '<div class="fresh"');
  assert.match(bar, new RegExp(`role="group" aria-label="${N.day.group}"`));
  const prev = bar.indexOf('id="day-prev"'), lbl = bar.indexOf('id="day-lbl"'), next = bar.indexOf('id="day-next"');
  assert.ok(prev !== -1 && prev < lbl && lbl < next, '‹ · label · ›');
  assert.match(bar, new RegExp(`<button type="button" class="day-step" id="day-prev" aria-label="${N.day.prev}" hidden>`));
  assert.match(bar, new RegExp(`<button type="button" class="day-step" id="day-next" aria-label="${N.day.next}" hidden>`));
  assert.match(bar, new RegExp(`id="day-lbl" aria-disabled="true" aria-live="polite" data-back="${N.day.back}"`));
});

test('dock: a role=tablist of four role=tab buttons with aria-pressed, and the "+" outside the tablist', () => {
  const dock = between('<div class="dock"', '<div class="tab-panel"');
  const nav = (dock.match(/<nav class="tabnav"[\s\S]*?<\/nav>/) || [''])[0];
  assert.match(nav, new RegExp(`role="tablist" aria-label="${N.ariaLabel}"`));
  const tabs = [...nav.matchAll(/<button id="t-([a-z]+)" role="tab" aria-pressed="(true|false)"/g)];
  assert.deepEqual(tabs.map((m) => m[1]), ['home', 'entreno', 'health', 'nutricion']);
  assert.equal(tabs.filter((m) => m[2] === 'true').length, 1, 'one active tab');
  assert.doesNotMatch(nav, /act-btn/, 'the action button is not a tab');
  assert.match(dock, new RegExp(`<button type="button" class="act-btn" id="act-btn" aria-expanded="false" aria-controls="act-pop" aria-label="${N.actions.open}" data-label-close="${N.actions.close}">`));
});

test('the action root and every action ship hidden; only real actions exist (add food, Sync)', () => {
  assert.match(html, /<div class="act" id="act" hidden>/, 'revealed by nav-actions.js when an action is available');
  assert.match(html, new RegExp(`<div class="act-pop" id="act-pop" role="dialog" aria-label="${N.actions.label}" hidden>`));
  const acts = [...html.matchAll(/<button type="button" class="act-item" data-act="([a-z]+)" hidden>/g)].map((m) => m[1]);
  assert.deepEqual(acts, ['food', 'sync']);
  assert.match(html, /<div class="act-scrim" id="act-scrim" hidden><\/div>/);
  for (const k of ['addFood', 'sync']) assert.ok(html.includes(`<span>${N.actions[k]}</span>`), k);
});

test('no visible hero header: one visually hidden h1, the collapsed dial row host sits in the Inicio panel', () => {
  assert.doesNotMatch(html, /<header>|class="kicker"|<p class="sub">/);
  const h1 = [...html.matchAll(/<h1\b[^>]*>/g)];
  assert.equal(h1.length, 1);
  assert.match(h1[0][0], /class="sr-only"/);
  const home = between('<div class="tab-panel" data-tab="home"', '<div class="tab-panel" data-tab="entreno"');
  assert.match(home, /<div id="home-mini" class="dial-mini"><\/div>/);
  assert.ok(home.indexOf('id="home-mini"') < home.indexOf('id="home-dials"'));
});
