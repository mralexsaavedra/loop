/* Tests for the Home tab client renderer (web/src/client/score.js): runs the classic script in a
 * vm with baked SCORES/I18N_SCORE/LOCALE globals and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScores } from '../../../lib/score/index.mjs';
import { renderAdvice } from '../../../lib/score/advice-copy.mjs';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { buildDials } from '../view/dial.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'score.js'), 'utf8');

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;

function fixtureScores({ days = 49, shift = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-client-'));
  try {
    const ds = Array.from({ length: days }, (_, i) => addDays(ASOF, i - (days - 1)));
    const w = (name, header, rows) => fs.writeFileSync(path.join(dir, name), header + '\n' + rows.join('\n') + '\n');
    w('hrv.csv', 'date,value,source', ds.map((d, i) => `${d},${(60 + wig(i)) * (i >= days - 7 ? Math.exp(0.1 * shift) : 1)},W`));
    w('rhr.csv', 'date,value,source', ds.map((d, i) => `${d},${50 + wig(i) * 0.5 - (i >= days - 7 ? shift : 0)},W`));
    w('sleep-daily.csv', 'date,asleep_hours,source,bedtime,waketime', ds.map((d, i) => `${d},${7.5 + wig(i) * 0.2},W,${23 + wig(i) * 0.1},${7 + wig(i) * 0.1}`));
    const rows = ['date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules'];
    ds.forEach((d, i) => {
      if (i % 2 === 0) rows.push(`${d},Running,40,,140,,165,Strava API,5,${50 + (i % 7)},`);
      if (i % 5 === 0) rows.push(`${d},Cycling,60,,140,,165,Strava API,20,20,`);
      if (i % 4 === 0) rows.push(`${d},Tennis,60,,,,,Strava API,,15,`);
      if (i === 3) rows.push(`${d},Running,6,,,,,Strava API,,1,`); // junk
    });
    fs.writeFileSync(path.join(dir, 'workouts.csv'), rows.join('\n') + '\n');
    return buildScores(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const HEALTH = { recovery: { hasData: true, sleep: { target: 7.5 } } };

// Returns #home-advice + #score-recovery (Salud) + #score-load (Entreno), in that order; pass `hosts` to
// inspect each one separately.
function render(scores, { locale = 'en', now = ASOF, T, healthNav = false, entrenoNav = healthNav, loadSectionHidden = false, dials, dialsHost, miniHost, hosts = {}, detail = false } = {}) {
  const host = { innerHTML: '' };
  const rec = (hosts.rec = hosts.rec || { innerHTML: '' });
  const load = (hosts.load = hosts.load || { innerHTML: '' });
  hosts.home = host;
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const byId = {
    'home-advice': host, 'score-recovery': rec, 'score-load': load,
    'home-dials': dialsHost || null, 'home-mini': miniHost || null, 't-health': healthNav ? {} : null, 't-entreno': entrenoNav ? {} : null,
    'sec-load': { hidden: loadSectionHidden },
  };
  const ctx = {
    document: { getElementById: (id) => byId[id] || null },
    SCORES: scores, DIALS: dials, I18N_SCORE: T || (locale === 'es' ? esT : enT), LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML + rec.innerHTML + load.innerHTML;
}
const count = (html, needle) => html.split(needle).length - 1;

test('empty state: no data renders .train-empty and nothing else', () => {
  const html = render({ hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null });
  assert.match(html, /train-empty/);
  assert.doesNotMatch(html, /sc-card/);
});

test('no data: #score-recovery (Salud) and #score-load (Entreno) get an empty state too, never stay blank', () => {
  const hosts = {};
  render({ hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null }, { hosts });
  assert.match(hosts.rec.innerHTML, /train-empty/);
  assert.match(hosts.load.innerHTML, /train-empty/);
});

test('isolation: a throwing advice or host write never blanks the other blocks', () => {
  const s = fixtureScores();
  s.advice = { key: Object.keys(enT.advice)[0], get vars() { throw new Error('boom'); } };
  const hosts = {};
  assert.doesNotThrow(() => render(s, { hosts }));
  assert.match(hosts.rec.innerHTML, /sc-recovery/, 'recovery card still written');
  assert.match(hosts.load.innerHTML, /sc-load/, 'load card still written');
  const s2 = fixtureScores();
  const brokenRec = {};
  Object.defineProperty(brokenRec, 'innerHTML', { set() { throw new Error('boom'); }, get() { return ''; } });
  const h2 = { rec: brokenRec };
  assert.doesNotThrow(() => render(s2, { hosts: h2 }));
  assert.match(h2.load.innerHTML, /sc-load/, 'a failing #score-recovery write does not stop #score-load');
});

test('a missing host element or missing SCORES does not throw', () => {
  assert.doesNotThrow(() => render(undefined));
});

test('full render: recovery trend with band, per-component rows and 14 raw dailies each', () => {
  const s = fixtureScores();
  const html = render(s);
  assert.match(html, /sc-recovery/);
  assert.ok(html.includes('<small class="rec-unit">SD</small>'), 'the one recovery unit');
  assert.doesNotMatch(html, /MAD/, 'no statistician jargon on the page');
  assert.match(html, /daytime SDNN/i);
  assert.equal(count(html, 'class="rec-comp"'), 4);
  assert.equal(count(html, 'class="sc-raw-v"'), 4 * 14);
  assert.match(html, new RegExp(`sc-band-${s.recovery.band}`));
  assert.equal(count(html, 'class="spark"'), 1 + s.load.modalities.length, 'inline SVG sparklines (recovery + one per modality)');
  assert.doesNotMatch(html, /<script|src=|href=/i, 'no scripts or external refs in the rendered markup');
});

const recCard = (s, opts = {}) => { const hosts = {}; render(s, { ...opts, hosts }); return hosts.rec.innerHTML; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('recovery card (Whoop-style): the HEADLINE is last night (big number + band word); the 7-day trend is a small secondary line', () => {
  const s = fixtureScores();
  const html = recCard(s);
  const t = s.recovery.today;
  const v = (t.value > 0 ? '+' : '') + t.value.toFixed(1);
  const big = html.match(/<div class="rec-big sc-band-([a-z]+)">([\s\S]*?)<\/div>/);
  assert.ok(big, 'a big-number headline');
  assert.equal(big[1], t.band, 'coloured by last night\'s band');
  assert.equal(text(big[2]), `${v} SD ${enT.recovery.bands[t.band]}`, 'last night\'s value + band word');
  assert.match(html, new RegExp(`<div class="rec-when">${enT.recovery.whenLastNight}</div>`));
  const trend = html.match(/<div class="rec-trend">([\s\S]*?)<\/div>/);
  assert.ok(trend, 'the 7-day trend is its own small line');
  assert.ok(text(trend[1]).includes(enT.recovery.trendLbl.replace('{value}', (s.recovery.trend7 > 0 ? '+' : '') + s.recovery.trend7.toFixed(1))));
  assert.ok(html.indexOf('rec-big') < html.indexOf('rec-trend'), 'headline first, trend under it');
  assert.doesNotMatch(html, /class="sc-val"/, 'the trend is never the big heading any more');
  s.recovery.today = null;
  const none = recCard(s);
  assert.ok(none.includes(enT.recovery.noToday));
  assert.doesNotMatch(none, /rec-big/, 'no night composite -> no big number');
  assert.match(none, /rec-trend/);
});

test('recovery card: contributors are compact rows (state dot, name, latest value + unit, baseline · SD · n) and the raw 14-day lists are folded', () => {
  const s = fixtureScores();
  const html = recCard(s);
  const rows = [...html.matchAll(/<div class="rec-comp" data-comp="([a-zA-Z]+)">([\s\S]*?)<\/div><!--\/comp-->/g)];
  assert.deepEqual(rows.map((r) => r[1]), s.recovery.components.map((c) => c.key));
  for (const [i, c] of s.recovery.components.entries()) {
    const body = rows[i][2];
    const dec = c.unit === 'h' ? 2 : c.unit === 'min' ? 0 : 1;
    const last = c.daily[c.daily.length - 1].value;
    assert.match(body, new RegExp(`<span class="rec-dot sc-dot-${c.band}"`), 'state colour dot');
    assert.ok(body.includes(enT.recovery.components[c.key]));
    assert.ok(text(body).includes(`${last.toFixed(dec)} ${c.unit}`), 'latest value + unit');
    assert.ok(text(body).includes(enT.recovery.baselineLbl.replace('{value}', c.baseline.toFixed(dec)).replace('{unit}', c.unit)), 'baseline');
    assert.ok(text(body).includes(`${(c.trend7 > 0 ? '+' : '') + c.trend7.toFixed(1)} SD`), 'SD vs baseline, the same unit as the composite');
    assert.ok(text(body).includes(`n=${c.n}`));
    assert.doesNotMatch(body, /sc-raw-v/, 'no raw number list inline');
  }
  const fold = html.match(/<details class="rec-raw"><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/);
  assert.ok(fold, 'the raw lists sit in a collapsed <details>');
  assert.equal(fold[1], enT.recovery.rawSummary);
  assert.equal(count(fold[2], 'class="sc-raw-v"'), 4 * 14, 'every raw value kept, just folded');
  assert.equal(esT.recovery.rawSummary, 'Últimos 14 días');
  assert.equal(enT.recovery.rawSummary, 'Last 14 days');
  assert.match(recCard(s, { locale: 'es' }), /<summary>Últimos 14 días<\/summary>/);
});

test('recovery card: confidence + SDNN chips on ONE line; layout blocks headline | sparkline | contributors', () => {
  const html = recCard(fixtureScores());
  const chips = html.match(/<div class="sc-chips rec-chips">([\s\S]*?)<\/div>/);
  assert.ok(chips);
  assert.equal(count(chips[1], 'class="sc-chip"'), 2);
  const at = ['class="rec-head"', 'class="sc-spark rec-spark"', 'class="rec-contrib"'].map((n) => html.indexOf(n));
  assert.ok(at.every((v, i) => v !== -1 && (i === 0 || v > at[i - 1])), `order ${at}`);
  assert.match(html, /<div class="rec-layout">/);
});

test('colour only on the direction arrow: no grade-fill classes on the recovery card', () => {
  const html = render(fixtureScores());
  assert.match(html, /sc-arrow sc-arrow-(above|at|below)/);
  assert.doesNotMatch(html, /sc-(red|amber|green|grade)/);
});

test('load: one card per modality (gym/run/bike), gated ones show the reason and no direction', () => {
  const s = fixtureScores();
  const html = render(s);
  assert.equal(count(html, 'class="sc-load-card"'), 3);
  for (const m of s.load.modalities) assert.match(html, new RegExp(`data-mod="${m.key}"`));
  const gated = s.load.modalities.filter((m) => !m.trend.ok);
  assert.equal(count(html, 'sc-gated'), gated.length);
  if (gated.length) assert.match(html, new RegExp(enT.load.gated.baselineBuilding.slice(0, 20)));
  const run = s.load.modalities.find((m) => m.key === 'run');
  assert.equal(run.trend.ok, true);
  assert.match(html, /vs your own run days/);
});

test('coverage counters and the other line are shown; the other line says it is not scored', () => {
  const s = fixtureScores();
  const html = render(s);
  for (const k of ['scored', 'unscored', 'invalid', 'droppedJunk', 'superseded', 'preEpoch']) {
    assert.match(html, new RegExp(`sc-cov-${k}">${s.load.coverage[k]}<`), k);
  }
  assert.ok(s.load.coverage.droppedJunk >= 1);
  assert.match(html, /sc-other/);
  assert.match(html, /not scored/i);
});

test('the four accurate caveats + SDNN + not-medical render; the retired strength claim does not', () => {
  const html = render(fixtureScores());
  assert.equal(count(html, 'class="sc-caveat"'), 7);
  assert.match(html, /HR-derived/);
  assert.match(html, /not comparable/i);
  assert.match(html, /auto-label/i);
  assert.match(html, /no comparable load before/i);
  assert.match(html, /not medical advice/i);
  assert.doesNotMatch(html, /under-?weights? strength/i);
});

test('advice is rendered with the shared copy when fresh (identical to renderAdvice)', () => {
  const s = fixtureScores();
  assert.ok(s.advice, 'fixture should produce advice');
  const html = render(s, { now: addDays(ASOF, 1) });
  assert.match(html, /sc-advice/);
  assert.ok(html.includes(renderAdvice(s.advice, 'en')), 'client sentence === lib sentence');
  const es = render(s, { locale: 'es', now: addDays(ASOF, 1) });
  assert.ok(es.includes(renderAdvice(s.advice, 'es')));
});

test('stale: > 3 days old is greyed, shows "as of <date>" and the note, and suppresses advice', () => {
  const s = fixtureScores();
  const html = render(s, { now: addDays(ASOF, 5) });
  assert.match(html, /sc-stale/);
  assert.ok(html.includes('as of Tue 29 Sep'), 'the shared display date, never ISO');
  assert.match(html, /sc-stale-note/);
  assert.doesNotMatch(html, /sc-advice/);
});

test('stale boundary: exactly 3 days is fresh, 4 days is stale', () => {
  const s = fixtureScores();
  assert.doesNotMatch(render(s, { now: addDays(ASOF, 3) }), /sc-stale/);
  assert.match(render(s, { now: addDays(ASOF, 4) }), /sc-stale/);
});

test('insufficient recovery: shows the insufficient state, no numbers, no advice', () => {
  const s = fixtureScores({ days: 10 });
  assert.equal(s.recovery.gated, true);
  const html = render(s);
  assert.match(html, /sc-insufficient/);
  assert.equal(count(html, 'class="sc-comp"'), 0);
  assert.doesNotMatch(html, /sc-advice/);
});

test('null asOf never produces NaN/undefined text', () => {
  const s = fixtureScores();
  s.recovery.asOf = null; s.load.asOf = null; s.asOf = null;
  const html = render(s);
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test('es locale uses decimal commas for recovery values', () => {
  const s = fixtureScores();
  const html = render(s, { locale: 'es' });
  const v = Math.abs(s.recovery.trend7).toFixed(1).replace('.', ',');
  assert.ok(html.includes(v), `expected ${v} in es render`);
});

test('baked date strings are validated before rendering: a non-ISO asOf/reEpoch never reaches the markup', () => {
  const s = fixtureScores();
  s.recovery.asOf = '<img src=x onerror=alert(1)>';
  s.load.asOf = '2026-09-29"><i id=xss>';
  s.load.reEpoch = 'javascript:1';
  const html = render(s);
  assert.doesNotMatch(html, /<img|id=xss|javascript:|onerror/);
});

test('glance vs detail (Whoop): Inicio keeps the dials + advice; the recovery card goes to Salud, load cards + caveats to Entreno', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { now: addDays(ASOF, 1), dials: buildDials(s, HEALTH), hosts });
  assert.match(hosts.home.innerHTML, /sc-dials/);
  assert.match(hosts.home.innerHTML, /sc-advice/);
  assert.doesNotMatch(hosts.home.innerHTML, /sc-recovery|sc-load|sc-caveat/, 'no detail cards on Inicio');
  assert.ok(hosts.home.innerHTML.indexOf('sc-dials') < hosts.home.innerHTML.indexOf('sc-advice'), 'advice under the dials');
  assert.match(hosts.rec.innerHTML, /sc-recovery/);
  assert.doesNotMatch(hosts.rec.innerHTML, /sc-load|sc-advice/);
  const load = hosts.load.innerHTML;
  assert.ok(load.indexOf('sc-load') !== -1 && load.indexOf('sc-load') < load.indexOf('sc-caveat'), 'load cards, then caveats');
  assert.doesNotMatch(load, /sc-recovery|sc-advice/);
});

test('Entreno load cards open their modality\'s detail view; the Salud recovery card carries a history button that opens the recovery view', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { now: addDays(ASOF, 1), healthNav: true, hosts, detail: true });
  for (const m of s.load.modalities) {
    assert.match(hosts.load.innerHTML, new RegExp(`<div class="sc-load-card" data-mod="${m.key}" data-detail="load-${m.key}" role="button" tabindex="0" aria-haspopup="dialog">`), m.key);
  }
  // the recovery card holds a <details> fold, so the card itself is not a button: a real button opens the view
  assert.match(hosts.rec.innerHTML, new RegExp(`<button type="button" class="dt-open-btn" data-detail="recovery" aria-haspopup="dialog">${enT.recovery.historyBtn}</button>`));
  assert.doesNotMatch(hosts.rec.innerHTML + hosts.load.innerHTML, /jumpOr\(/);
  const plain = {};
  render(s, { now: addDays(ASOF, 1), hosts: plain });
  assert.doesNotMatch(plain.rec.innerHTML + plain.load.innerHTML, /data-detail/, 'no detail sheet baked: no opener');
});

test('dial taps open the detail sheet: sleep -> sleep, recovery -> recovery, each load-modality dial -> load-<modality>; whatever tabs are hidden', () => {
  const s = fixtureScores();
  const dials = buildDials(s, HEALTH);
  for (const nav of [true, false]) {
    const hosts = {};
    const linked = render(s, { now: addDays(ASOF, 1), dials, healthNav: nav, entrenoNav: nav, detail: true, hosts });
    assert.match(dialOf(linked, 'dial-sleep'), /data-detail="sleep" role="button" tabindex="0" aria-haspopup="dialog"/);
    assert.match(dialOf(linked, 'dial-rec'), /data-detail="recovery" role="button"/);
    // #home-advice only (the dials lead it without a #home-dials host); Entreno's load cards open the same views
    for (const m of s.load.modalities) assert.equal(count(hosts.home.innerHTML, `data-detail="load-${m.key}" role="button"`), 1, `${m.key} dial`);
    assert.doesNotMatch(linked, /jumpOr\(|onkeydown=/, 'one delegated listener (client/detail.js), no inline handlers on the dials');
  }
});

/* ---- Inicio dials (Sleep / Recovery / Load) ---- */
const withDials = (s, opts = {}) => render(s, { dials: buildDials(s, HEALTH), ...opts });
const dialOf = (html, cls) => {
  const i = html.indexOf(`class="dial ${cls}`);
  assert.ok(i !== -1, `missing dial ${cls}`);
  return html.slice(i, html.indexOf('</figure>', i));
};

test('dials: three dials (sleep, recovery, load) render first, before the recovery card', () => {
  const s = fixtureScores();
  const html = withDials(s);
  assert.match(html, /class="sc-card sc-dials"/);
  for (const c of ['dial-sleep', 'dial-rec']) dialOf(html, c);
  assert.ok(html.indexOf('sc-dials') < html.indexOf('sc-recovery'));
  assert.equal(count(html, 'class="dial-svg"'), 2 + s.load.modalities.length, 'one svg per dial, one per load modality');
  assert.doesNotMatch(html, /<script|src=|href=/i);
});

test('dials: with a #home-dials host (Home.astro) the dials render there, so the health monitor can sit between them and the cards', () => {
  const s = fixtureScores();
  const dialsHost = { innerHTML: '' };
  const html = render(s, { dials: buildDials(s, HEALTH), dialsHost });
  assert.match(dialsHost.innerHTML, /class="sc-card sc-dials"/);
  assert.doesNotMatch(html, /sc-dials/);
  assert.match(html, /sc-recovery/);
});

test('collapsed dial row (#home-mini): one mini ring per dial, the SAME baked svg + label + detail opener, no recomputation', () => {
  const s = fixtureScores();
  const dialsHost = { innerHTML: '' };
  const miniHost = { innerHTML: '' };
  render(s, { now: addDays(ASOF, 1), dials: buildDials(s, HEALTH), dialsHost, miniHost, detail: true });
  const mini = miniHost.innerHTML;
  assert.match(mini, /^<div class="dm-row" role="group" aria-label="[^"]+">/);
  const items = [...mini.matchAll(/<div class="dm (dial-[a-z]+)[^"]*"([^>]*)>([\s\S]*?)<\/div>/g)];
  assert.equal(items.length, 2 + s.load.modalities.length, 'sleep, recovery, one per load modality (the switch picks one)');
  assert.equal(items.filter((m) => !/\shidden/.test(m[2])).length, 3, 'three visible: Sleep · Recovery · Load');
  // every mini ring reuses the dial's exact svg and opens the same detail view
  const svgs = (html) => [...html.matchAll(/<svg class="dial-svg"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.deepEqual(svgs(mini), svgs(dialsHost.innerHTML));
  const openers = (html) => [...html.matchAll(/data-detail="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(openers(mini), openers(dialsHost.innerHTML));
  for (const lbl of [enT.dials.sleep.label, enT.dials.recovery.label, enT.dials.load.label]) {
    assert.ok(mini.includes(`<span class="dm-lbl">${lbl}</span>`), lbl);
  }
  // the load items carry data-dmod so the modality switch moves them with the dial
  assert.equal(count(mini, 'data-dmod='), s.load.modalities.length);
});

test('collapsed dial row: no #home-mini host, nothing breaks; no data, the row stays empty', () => {
  const s = fixtureScores();
  assert.doesNotThrow(() => render(s, { dials: buildDials(s, HEALTH), dialsHost: { innerHTML: '' } }));
  const miniHost = { innerHTML: 'x' };
  render({ hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null }, { miniHost, dialsHost: { innerHTML: '' } });
  assert.equal(miniHost.innerHTML, '');
});

test('dials: absent DIALS global renders the cards exactly as before (no dial card)', () => {
  const html = render(fixtureScores());
  assert.doesNotMatch(html, /sc-dials/);
});

test('recovery dial: value INSIDE the ring = LAST NIGHT (signed number + small SD unit, coloured by its band); the 7-day trend lives in the detail sheet, never a percentage', () => {
  const s = fixtureScores();
  assert.ok(s.recovery.today, 'fixture has a composite for the asOf night');
  const d = dialOf(withDials(s), 'dial-rec');
  const t = s.recovery.today;
  assert.match(d, new RegExp(`dial-band-${t.band}`));
  const sd = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
  assert.ok(d.includes(`<b class="dial-num">${sd(t.value)}<small>SD</small></b>`), `expected ${sd(t.value)} with a small SD inside the ring`);
  // band word + "last night" stay in the accessible name; on screen only the number
  assert.ok(d.includes(`aria-label="${enT.dials.recovery.aria.replace('{when}', enT.dials.recovery.lastNight).replace('{value}', sd(t.value)).replace('{band}', enT.dials.recovery.bands[t.band])}"`));
  const trendLine = enT.dials.recovery.trendLine.replace('{dir}', enT.dials.recovery.dirs[s.recovery.trendDir]).replace('{value}', sd(s.recovery.trend7));
  assert.ok(!d.includes(trendLine), 'the trend caption moved to the detail sheet');
  assert.doesNotMatch(d, /dial-sub|dial-when|dial-trend/);
  assert.doesNotMatch(d, /%/);
  assert.equal(count(d, 'class="dial-zone'), 3, 'below / at / above zones');
  assert.match(d, /class="dial-mid"/, 'baseline tick');
  assert.doesNotMatch(d, /class="dial-dot"/, 'no marker dot: the fill ends at the value');
});

test('dials: label BELOW the ring, uppercase via CSS, with a chevron; no captions under the dials (they live in each dial\'s detail sheet)', () => {
  const html = withDials(fixtureScores());
  for (const lbl of [enT.dials.sleep.label, enT.dials.recovery.label, enT.dials.load.label]) {
    assert.ok(html.includes(`<figcaption class="dial-lbl">${lbl}<span class="dial-chev" aria-hidden="true">›</span></figcaption>`), lbl);
  }
  assert.doesNotMatch(html, /class="dial-sub"|class="dial-cap"|class="dial-scale"|class="dial-switch-lbl"/);
  assert.ok(!html.includes(enT.dials.load.scale), 'the load scale explanation is in the load detail sheet');
  assert.ok(!html.includes('Target 7.5 h'), 'the sleep target is in the sleep detail sheet');
});

test('dials: stale data keeps ONE short warning line under the dials; fresh data has none', () => {
  const s = fixtureScores();
  assert.doesNotMatch(withDials(s, { now: addDays(ASOF, 1) }), /dial-stale/);
  const stale = withDials(s, { now: addDays(ASOF, 5) });
  assert.equal(count(stale, 'class="dial-stale"'), 1);
  assert.ok(stale.includes(`<div class="dial-stale">${enT.staleNote.replace('{days}', '5')}</div>`));
});

test('recovery dial: an older night is labelled with its date, not "last night"', () => {
  const s = fixtureScores();
  const d = dialOf(withDials(s, { now: addDays(ASOF, 2) }), 'dial-rec');
  assert.ok(!d.includes(enT.dials.recovery.lastNight));
  assert.ok(d.includes('as of Tue 29 Sep'), 'the shared display date, never ISO');
});

test('recovery dial: a composite without a sleep-duration reading is labelled by date + "no sleep data", never "last night"', () => {
  const s = fixtureScores();
  s.recovery.today = { ...s.recovery.today, sleep: false };
  const d = dialOf(withDials(s), 'dial-rec');
  assert.ok(!d.includes(enT.dials.recovery.lastNight), 'not "last night", not even in the accessible name');
  assert.ok(d.includes('as of Tue 29 Sep'), 'the accessible name dates the night (the "no sleep data" line is in the detail sheet)');
  const card = recCard(s);
  assert.ok(!card.includes(`<div class="rec-when">${enT.recovery.whenLastNight}</div>`), 'the recovery card does not call it last night either');
  assert.ok(card.includes(`<div class="rec-when">${enT.recovery.whenNoSleep.replace('{date}', 'Tue 29 Sep')}</div>`));
});

test('recovery card: an older night is labelled by its date, not "Last night"', () => {
  const s = fixtureScores();
  const html = recCard(s, { now: addDays(ASOF, 1) });
  assert.ok(!html.includes(`<div class="rec-when">${enT.recovery.whenLastNight}</div>`));
  assert.ok(html.includes(`<div class="rec-when">${enT.recovery.whenDate.replace('{date}', 'Tue 29 Sep')}</div>`));
});

test('resilience: a throwing dial or card never blanks Inicio (empty-state fallback)', () => {
  const s = fixtureScores();
  const dials = buildDials(s, HEALTH);
  dials.load.modalities = null; // loadDials would throw on .map
  const html = render(s, { dials });
  assert.match(html, /sc-recovery/, 'the cards still render');
  const s2 = fixtureScores();
  s2.recovery.components = 'broken'; // recoveryHtml would throw on .forEach
  const html2 = render(s2, { dials: buildDials(fixtureScores(), HEALTH) });
  assert.match(html2, /sc-dials/, 'the dials still render');
  assert.match(html2, /sc-load/, 'the load card still renders');
  assert.match(html2, /sc-card-error/, 'the broken card shows its fallback');
});

test('recovery dial: no composite for last night -> shows the trend and says there is no data for last night', () => {
  const s = fixtureScores();
  s.recovery.today = null;
  const d = dialOf(withDials(s), 'dial-rec');
  const v = (s.recovery.trend7 > 0 ? '+' : '') + s.recovery.trend7.toFixed(1);
  assert.ok(d.includes(`aria-label="${enT.dials.recovery.ariaTrend.replace('{value}', v).replace('{band}', enT.dials.recovery.bands[s.recovery.band])}"`), 'says so in its accessible name (and in the detail sheet)');
  assert.ok(!d.includes(enT.dials.recovery.lastNight));
  assert.match(d, new RegExp(`dial-band-${s.recovery.band}`));
});

test('recovery dial: gated shows no number and is greyed', () => {
  const s = fixtureScores({ days: 10 });
  const d = dialOf(withDials(s), 'dial-rec');
  assert.match(d, /dial-off/);
  assert.doesNotMatch(d, /sd<|dial-dot/);
});

test('sleep dial: last night hours, target labelled on screen, fill capped (es decimal comma)', () => {
  const s = fixtureScores();
  const last = s.recovery.components.find((c) => c.key === 'sleepDur').daily.at(-1).value;
  const d = dialOf(withDials(s, { locale: 'es', T: esT }), 'dial-sleep');
  assert.ok(d.includes(last.toFixed(1).replace('.', ',')), 'hours with a comma');
  assert.ok(d.includes('7,5'), 'target in the accessible name (on screen it is in the sleep detail sheet)');
  assert.match(d, /<b class="dial-num">\d,\d<small>h<\/small><\/b>/, 'hours inside the ring, small unit');
  assert.ok(d.includes(esT.dials.sleep.label));
  assert.doesNotMatch(d, /%/);
});

test('load dial: one visible modality (default = first ungated), switch for all three, gated greyed with the existing copy', () => {
  const s = fixtureScores();
  const html = withDials(s);
  const D = buildDials(s, HEALTH).load;
  assert.equal(count(html, 'class="dial-mod"'), 3, 'gym / run / bike switch');
  assert.match(html, new RegExp(`class="dial-mod" data-dmod="${D.defaultKey}" aria-pressed="true"`));
  assert.equal(count(html, 'aria-pressed="true"'), 1);
  for (const m of D.modalities) {
    const vis = new RegExp(`<figure class="dial dial-load[^"]*" data-dmod="${m.key}"${m.key === D.defaultKey ? '>' : ' hidden>'}`);
    assert.match(html, vis, m.key);
  }
  for (const g of D.modalities.filter((m) => m.state === 'gated')) {
    const i = html.indexOf(`data-dmod="${g.key}"`, html.indexOf('<figure class="dial dial-load'));
    const fig = html.slice(i, html.indexOf('</figure>', i));
    assert.doesNotMatch(fig, /dial-num/, 'gated: no number');
    assert.ok(fig.includes(enT.dials.load.gated), 'gated word inside the ring (the reason is in the load detail sheet)');
  }
  assert.doesNotMatch(html, /×/, 'no acute/chronic ratio as the headline any more');
});

const figOf = (html, key) => {
  const i = html.indexOf(`data-dmod="${key}"`, html.indexOf('<figure class="dial dial-load'));
  return html.slice(i, html.indexOf('</figure>', i));
};

// run sessions around ASOF: a scored day 2 days before, an unscored day 1 day before, a scored ASOF
function withRecent(s, recent, last) {
  const run = s.load.modalities.find((m) => m.key === 'run');
  run.recent = recent;
  run.last = last;
  return s;
}
const RECENT = [
  { date: addDays(ASOF, -2), re: 44, unscored: 0 },
  { date: addDays(ASOF, -1), re: 0, unscored: 2 },
  { date: ASOF, re: 57, unscored: 0 },
];

test('load dial: the VIEWER\'s today with a workout -> today\'s RE vs the typical day; acute/chronic stays as context', () => {
  const s = withRecent(fixtureScores(), RECENT, { date: ASOF, re: 57 });
  const html = withDials(s);
  const d = buildDials(s, HEALTH).load.modalities.find((m) => m.key === 'run');
  assert.equal(d.state, 'ok');
  const fig = figOf(html, 'run');
  assert.ok(fig.includes(`<b class="dial-num">57<small>${enT.dials.load.unit}</small></b>`));
  assert.ok(fig.includes(`d="${d.days[2].fill}"`), 'the baked geometry of that day');
  assert.ok(fig.includes(`aria-label="${enT.dials.load.aria.replace('{modality}', 'Run').replace('{day}', '57').replace('{typical}', String(Math.round(d.typical)))}"`), 'typical day in the accessible name; the caption and acute/chronic context are in the load detail sheet');
});

test('load dial: rows today but no Relative Effort -> "no effort data", never rest', () => {
  const s = withRecent(fixtureScores(), RECENT, { date: addDays(ASOF, -2), re: 44 });
  const html = withDials(s, { now: addDays(ASOF, -1) });
  const fig = figOf(html, 'run');
  assert.ok(fig.includes(enT.dials.load.noEffort));
  assert.doesNotMatch(fig, new RegExp(enT.dials.load.rest));
  assert.doesNotMatch(fig, /dial-num|dial-dot/);
});

test('load dial: no session today -> "No session yet today" with the last session (date + RE) as context', () => {
  const s = withRecent(fixtureScores(), RECENT, { date: ASOF, re: 57 });
  const html = withDials(s, { now: addDays(ASOF, 1) });
  const fig = figOf(html, 'run');
  assert.ok(fig.includes(enT.dials.load.rest));
  assert.doesNotMatch(fig, /dial-num|dial-dot/);
  assert.ok(!html.includes('last session Tue 29 Sep'), 'the last session line is in the load detail sheet');
});

/* the load dial opens on what happened TODAY (viewer's clock), not on the first ungated modality */
function withToday(s, reByKey) {
  for (const m of s.load.modalities) {
    const re = reByKey[m.key];
    m.recent = re == null ? [{ date: addDays(ASOF, -3), re: 30, unscored: 0 }] : [{ date: ASOF, re, unscored: re > 0 ? 0 : 1 }];
    m.last = re > 0 ? { date: ASOF, re } : { date: addDays(ASOF, -3), re: 30 };
  }
  return s;
}
const pressedMod = (html) => (html.match(/class="dial-mod" data-dmod="([a-z]+)" aria-pressed="true"/) || [])[1];
const visibleFig = (html) => (html.match(/<figure class="dial dial-load[^"]*" data-dmod="([a-z]+)"[^>]*?(?<!hidden)>/) || [])[1];

test('load dial default: the modality with a session on the viewer\'s today, not the first ungated one', () => {
  const ok = buildDials(fixtureScores(), HEALTH).load.modalities.filter((m) => m.state === 'ok').map((m) => m.key);
  assert.ok(ok.length >= 2, `fixture needs two ungated modalities, got ${ok}`);
  const [first, second] = ok;
  const s = withToday(fixtureScores(), { [second]: 94 });
  const html = withDials(s);
  assert.equal(pressedMod(html), second, 'switch starts on today\'s modality');
  assert.equal(visibleFig(html), second, 'its dial is the visible one');
  assert.ok(figOf(html, second).includes('<b class="dial-num">94<small>RE</small></b>'));
  assert.match(html, new RegExp(`<figure class="dial dial-load[^"]*" data-dmod="${first}" hidden`), 'the first ungated one is behind the switch');
  assert.equal(count(html, 'aria-pressed="true"'), 1);
});

test('load dial default: several sessions today -> the one with the highest RE; none today -> the first ungated', () => {
  const ok = buildDials(fixtureScores(), HEALTH).load.modalities.filter((m) => m.state === 'ok').map((m) => m.key);
  const [first, second] = ok;
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [first]: 20, [second]: 60 }))), second);
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [first]: 70, [second]: 60 }))), first);
  // a session without RE today still beats a modality with nothing today
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [second]: 0 }))), second);
  // the clock decides: the same data viewed the next day falls back to the first ungated modality
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [second]: 94 }), { now: addDays(ASOF, 1) })), first);
});

test('load dial default: a session today opens its modality even when that modality is gated (greyed, gated copy, no number)', () => {
  const D = buildDials(fixtureScores(), HEALTH).load;
  const gated = D.modalities.find((m) => m.state === 'gated');
  assert.ok(gated, 'fixture needs a gated modality');
  const html = withDials(withToday(fixtureScores(), { [gated.key]: 50 }));
  assert.equal(pressedMod(html), gated.key, 'today\'s session beats the first ungated modality');
  assert.equal(visibleFig(html), gated.key);
  assert.match(html, new RegExp(`<figure class="dial dial-load dial-off[^"]*" data-dmod="${gated.key}"`), 'shown in its gated state (greyed)');
  assert.ok(figOf(html, gated.key).includes(enT.dials.load.gated), 'with the gated copy');
  assert.doesNotMatch(figOf(html, gated.key), /dial-num/, 'no number on a gated dial');
});

test('load dial default: ranking = highest RE today, then modality order; a session without RE beats nothing; gating does not change the rank', () => {
  const keys = buildDials(fixtureScores(), HEALTH).load.modalities.map((m) => m.key);
  const gated = buildDials(fixtureScores(), HEALTH).load.modalities.find((m) => m.state === 'gated').key;
  const ok = keys.filter((k) => k !== gated);
  // tie on RE -> the earlier modality in the switch order
  const [a, b] = ok;
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [b]: 60, [a]: 60 }))), keys.indexOf(a) < keys.indexOf(b) ? a : b);
  // a gated modality with the highest RE today wins over an ungated one
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [gated]: 80, [a]: 60 }))), gated);
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [gated]: 40, [a]: 60 }))), a);
  // rows without RE (noEffort) on a gated modality still beat nothing today
  assert.equal(pressedMod(withDials(withToday(fixtureScores(), { [gated]: 0 }))), gated);
});

test('caveats stay reachable: Entreno hidden (or its load section hidden) -> a compact load caveat line under the dials', () => {
  const s = fixtureScores();
  const line = (html) => (html.match(/<div class="dial-caveat dial-caveat-load">([^<]*)<\/div>/) || [])[1];
  const hosts = {};
  withDials(s, { healthNav: true, entrenoNav: false, hosts });
  assert.equal(line(hosts.home.innerHTML), enT.dials.load.caveatLine, 'Entreno hidden: the line sits on Inicio');
  assert.match(enT.dials.load.caveatLine, /HR-derived/);
  assert.match(enT.dials.load.caveatLine, /not comparable/);
  assert.match(enT.dials.load.caveatLine, /before/);
  assert.match(enT.dials.load.caveatLine, /summed/);
  withDials(s, { healthNav: true, entrenoNav: true, loadSectionHidden: true, hosts });
  assert.equal(line(hosts.home.innerHTML), enT.dials.load.caveatLine, 'load section hidden: same');
  withDials(s, { healthNav: true, entrenoNav: true, hosts });
  assert.equal(line(hosts.home.innerHTML), undefined, 'Entreno reachable: the full caveats live there, no line on Inicio');
  assert.match(hosts.load.innerHTML, /sc-caveats/, 'and Entreno keeps its caveats card');
  const es = {};
  withDials(s, { locale: 'es', healthNav: true, entrenoNav: false, hosts: es });
  assert.equal(line(es.home.innerHTML), esT.dials.load.caveatLine);
});

test('caveats stay reachable: Salud hidden -> a compact recovery caveat line under the dials', () => {
  const s = fixtureScores();
  const line = (html) => (html.match(/<div class="dial-caveat dial-caveat-rec">([^<]*)<\/div>/) || [])[1];
  const hosts = {};
  withDials(s, { healthNav: false, entrenoNav: true, hosts });
  assert.equal(line(hosts.home.innerHTML), enT.dials.recovery.caveatLine);
  assert.match(enT.dials.recovery.caveatLine, /SDNN/);
  assert.match(enT.dials.recovery.caveatLine, /not medical advice/i);
  withDials(s, { healthNav: true, entrenoNav: true, hosts });
  assert.equal(line(hosts.home.innerHTML), undefined);
  const es = {};
  withDials(s, { locale: 'es', healthNav: false, entrenoNav: true, hosts: es });
  assert.equal(line(es.home.innerHTML), esT.dials.recovery.caveatLine);
});

test('dials: stale data greys the dial; fresh data does not', () => {
  const s = fixtureScores();
  assert.doesNotMatch(dialOf(withDials(s, { now: addDays(ASOF, 1) }), 'dial-sleep'), /sc-stale/);
  const stale = withDials(s, { now: addDays(ASOF, 5) });
  for (const c of ['dial-sleep', 'dial-rec']) assert.match(dialOf(stale, c), /sc-stale/);
  assert.match(stale, /<figure class="dial dial-load[^"]* sc-stale"[^>]*data-dmod="run"/);
});

test('dials: a null asOf / date never produces NaN/undefined text', () => {
  const s = fixtureScores();
  s.recovery.asOf = null; s.load.asOf = null;
  const dials = buildDials(s, HEALTH);
  dials.sleep.date = null;
  assert.doesNotMatch(render(s, { dials }), /NaN|undefined|null/);
});

test('scMod: the switch shows only the chosen modality and moves aria-pressed', () => {
  const el = (key, isBtn) => ({
    key, hidden: false, pressed: null,
    classList: { contains: (c) => isBtn && c === 'dial-mod' },
    getAttribute: (a) => (a === 'data-dmod' ? key : null),
    setAttribute(a, v) { if (a === 'aria-pressed') this.pressed = v; },
  });
  const btns = ['gym', 'run', 'bike'].map((k) => el(k, true));
  const panes = ['gym', 'run', 'bike'].flatMap((k) => [el(k, false), el(k, false)]);
  const root = { querySelectorAll: () => [...btns, ...panes] };
  btns.forEach((b) => { b.closest = () => root; });
  const minis = ['gym', 'run', 'bike'].map((k) => el(k, false));
  const mini = { querySelectorAll: () => minis };
  const ctx = { document: { getElementById: (id) => (id === 'home-mini' ? mini : null) } };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  ctx.scMod('bike', btns[2]);
  assert.deepEqual(btns.map((b) => b.pressed), ['false', 'false', 'true']);
  assert.deepEqual(panes.map((p) => p.hidden), [true, true, true, true, false, false]);
  assert.deepEqual(minis.map((p) => p.hidden), [true, true, false], 'the collapsed row follows the switch');
});

test('load: sessions without effort data in the acute window are noted on the card', () => {
  const s = fixtureScores();
  const run = s.load.modalities.find((m) => m.key === 'run');
  run.unscoredAcute = 2;
  const html = render(s);
  const note = enT.load.unscoredNote.replace('{n}', '2');
  assert.ok(html.includes(note), 'card note');
  assert.equal(count(html, 'without effort data in the last 7 days'), 1, 'only the run card (the dial\'s note is in its detail sheet)');
});

test('one date format: every date the dials and cards print goes through HC.fmtDate, never ISO (ISO stays in attributes)', () => {
  const textOf = (html) => html.replace(/<[^>]*>/g, ' ');
  for (const locale of ['en', 'es']) {
    for (const now of [ASOF, addDays(ASOF, 1), addDays(ASOF, 2), addDays(ASOF, 10)]) {
      const s = fixtureScores();
      const nosleep = fixtureScores();
      nosleep.recovery.today = { ...nosleep.recovery.today, sleep: false };
      const text = textOf(withDials(s, { now, locale }) + withDials(nosleep, { now, locale }));
      assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/, `no raw ISO date in the text (${locale}, ${now})`);
    }
  }
  assert.ok(textOf(withDials(fixtureScores(), { now: addDays(ASOF, 10), locale: 'es' })).includes('mar 29 sept'), 'es display date');
});

test('one recovery unit: the dial, the Salud card and the detail sheet all say SD (es: desv.), from ONE i18n key; no unit literal in score.js', async () => {
  const { en: enD, es: esD } = await import('../i18n/detail-templates.mjs');
  assert.equal(enT.recovery.unit, 'SD');
  assert.equal(esT.recovery.unit, 'desv.');
  for (const [T, D, unit] of [[enT, enD, 'SD'], [esT, esD, 'desv.']]) {
    const strings = [
      T.recovery.trendLbl, T.recovery.deltaLbl, T.dials.recovery.delta, T.dials.recovery.trendLine, T.dials.recovery.trendLineNoDir,
      T.dials.recovery.aria, T.dials.recovery.ariaTrend, D.metrics.recovery.unit, D.day.recValue, D.bands.recovery,
    ];
    for (const str of strings) {
      assert.ok(str.includes(unit), `"${str}" uses the one unit ${unit}`);
      assert.doesNotMatch(str, /\bMAD\b|\bsd\b/, `"${str}" keeps no other unit`);
    }
  }
  assert.match(enT.recovery.unitNote, /typical spread/);
  assert.match(esT.recovery.unitNote, /variación típica/);
  assert.doesNotMatch(source, /'[^'\n]*\b(MAD|sd)\b[^'\n]*'/, 'score.js hard-codes no recovery unit string');
  const card = recCard(fixtureScores());
  assert.ok(card.includes(enT.recovery.unitNote), 'the card explains the unit in one line');
  const es = (() => { const hosts = {}; render(fixtureScores(), { locale: 'es', hosts }); return hosts.rec.innerHTML; })();
  assert.ok(es.includes('<small class="rec-unit">desv.</small>'));
  assert.ok(es.includes(esT.recovery.unitNote));
  assert.doesNotMatch(es, /MAD/);
  const dial = dialOf(withDials(fixtureScores()), 'dial-rec');
  assert.match(dial, / SD/, 'the dial: same unit');
  assert.doesNotMatch(dial, / sd\b/);
});
