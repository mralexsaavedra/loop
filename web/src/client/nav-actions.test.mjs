/* web/src/client/nav-actions.js — the bottom dock's "+" action button and its popover. Runs the classic
 * script in a vm over the DOM stub. Contract: the button ships hidden and shows only when at least one
 * REAL action is available (the food add sheet = the food API answered; Sync = the freshness group is
 * shown, i.e. /api/sync/status answered); only available actions are listed; open / close via the
 * button, Escape and the scrim; Tab stays inside (button + visible items); focus returns to the button. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'nav-actions.js'), 'utf8');

function page({ freshness = false, food = false } = {}) {
  const doc = new StubDocument();
  doc._listeners = {};
  doc.addEventListener = (evt, fn) => { (doc._listeners[evt] = doc._listeners[evt] || []).push(fn); };
  doc.activeElement = null;
  const focusable = (el) => { el.focus = () => { doc.activeElement = el; }; return el; };
  const root = doc.el('act', { hidden: true });
  const btn = focusable(doc.el('act-btn', { tag: 'button', attrs: { 'aria-expanded': 'false', 'aria-label': 'Actions', 'data-label-close': 'Close actions' }, parent: root }));
  const pop = doc.el('act-pop', { hidden: true, parent: root });
  const scrim = doc.el('act-scrim', { hidden: true });
  const items = {
    food: focusable(doc.el(null, { tag: 'button', classes: ['act-item'], attrs: { 'data-act': 'food' }, hidden: true, parent: pop })),
    sync: focusable(doc.el(null, { tag: 'button', classes: ['act-item'], attrs: { 'data-act': 'sync' }, hidden: true, parent: pop })),
  };
  doc.el('freshness', { hidden: !freshness });
  const syncBtn = doc.el('sync-btn', { tag: 'button' });
  syncBtn.clicks = 0;
  syncBtn.click = () => { syncBtn.clicks += 1; };
  const opened = [];
  const window = {};
  if (food) {
    window.HCViews = { 'food-add': {} };
    window.HCDetail = { open: (key, date, opts) => opened.push({ key, date, opts }) };
  }
  const ctx = { document: doc, window };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const fire = (target, type, extra = {}) => {
    const e = { type, target, key: extra.key, shiftKey: !!extra.shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (doc._listeners[type] || []).forEach((fn) => fn(e));
    return e;
  };
  return { doc, window, root, btn, pop, scrim, items, syncBtn, opened, fire };
}

test('no action available (example / static build): the button stays hidden, nothing is listed', () => {
  const p = page();
  assert.equal(p.root.hidden, true, 'never a dead control');
  assert.equal(p.items.food.hidden, true);
  assert.equal(p.items.sync.hidden, true);
  assert.equal(typeof p.window.HCActions.refresh, 'function');
});

test('only the available actions are listed: Sync once the freshness group shows, food once the food API answered', () => {
  const p = page({ freshness: true });
  assert.equal(p.root.hidden, false);
  assert.equal(p.items.sync.hidden, false);
  assert.equal(p.items.food.hidden, true, 'no food API: no add-food row');
  // the food boot answers later and calls refresh()
  p.window.HCViews = { 'food-add': {} };
  p.window.HCDetail = { open: () => {} };
  p.window.HCActions.refresh();
  assert.equal(p.items.food.hidden, false);
  // the freshness endpoint went away: Sync drops out, food stays
  p.doc.getElementById('freshness').hidden = true;
  p.window.HCActions.refresh();
  assert.equal(p.items.sync.hidden, true);
  assert.equal(p.root.hidden, false);
});

test('open / close: the button toggles the popover, "+" becomes a close control, focus moves in and returns', () => {
  const p = page({ freshness: true, food: true });
  p.fire(p.btn, 'click');
  assert.equal(p.pop.hidden, false);
  assert.equal(p.scrim.hidden, false);
  assert.equal(p.btn.getAttribute('aria-expanded'), 'true');
  assert.equal(p.btn.getAttribute('aria-label'), 'Close actions');
  assert.equal(p.doc.activeElement, p.items.food, 'focus on the first listed action');
  p.fire(p.btn, 'click');
  assert.equal(p.pop.hidden, true);
  assert.equal(p.scrim.hidden, true);
  assert.equal(p.btn.getAttribute('aria-expanded'), 'false');
  assert.equal(p.btn.getAttribute('aria-label'), 'Actions');
  assert.equal(p.doc.activeElement, p.btn);
});

test('Escape and a tap on the scrim (outside) close it and return focus to the button', () => {
  const p = page({ freshness: true });
  p.fire(p.btn, 'click');
  const e = p.fire(p.items.sync, 'keydown', { key: 'Escape' });
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.pop.hidden, true);
  assert.equal(p.doc.activeElement, p.btn);
  p.fire(p.btn, 'click');
  p.fire(p.scrim, 'click');
  assert.equal(p.pop.hidden, true);
  assert.equal(p.doc.activeElement, p.btn);
  // closed: Escape is not ours
  assert.equal(p.fire(p.btn, 'keydown', { key: 'Escape' }).defaultPrevented, false);
});

test('focus trap: Tab cycles over the button and the visible actions only', () => {
  const p = page({ freshness: true, food: true });
  p.fire(p.btn, 'click');
  p.doc.activeElement = p.items.sync;
  let e = p.fire(p.items.sync, 'keydown', { key: 'Tab' });
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.doc.activeElement, p.btn, 'last -> first (the close button)');
  e = p.fire(p.btn, 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(p.doc.activeElement, p.items.sync, 'first -> last');
});

test('actions: food opens the existing add sheet with the button as opener; Sync clicks the existing Sync button', () => {
  const p = page({ freshness: true, food: true });
  p.fire(p.btn, 'click');
  p.fire(p.items.food, 'click');
  assert.equal(p.pop.hidden, true, 'the popover closes first');
  assert.equal(p.opened.length, 1);
  assert.equal(p.opened[0].key, 'food-add');
  assert.equal(p.opened[0].opts.opener, p.btn);
  p.fire(p.btn, 'click');
  p.fire(p.items.sync, 'click');
  assert.equal(p.syncBtn.clicks, 1);
  assert.equal(p.pop.hidden, true);
  assert.equal(p.doc.activeElement, p.btn);
});

test('an action that went away while the popover was open is not run', () => {
  const p = page({ freshness: true });
  p.fire(p.btn, 'click');
  p.doc.getElementById('freshness').hidden = true;
  p.fire(p.items.sync, 'click');
  assert.equal(p.syncBtn.clicks, 0);
});
