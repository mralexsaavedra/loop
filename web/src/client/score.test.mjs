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
import { fmtHours } from '../../../lib/format/numbers.mjs';

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
function render(scores, { locale = 'en', now = ASOF, T, healthNav = false, entrenoNav = healthNav, loadSectionHidden = false, dials, dialsHost, miniHost, hosts = {}, detail = false, secInfo = null, day, ctxExtra } = {}) {
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
    'hs-info-recovery': secInfo,
  };
  const ctx = {
    document: { getElementById: (id) => byId[id] || null },
    SCORES: scores, DIALS: dials, I18N_SCORE: T || (locale === 'es' ? esT : enT), LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite,
  };
  if (detail) ctx.DETAIL = { metrics: {} };
  // the top bar's day stepping (client/today-date.js window.HCDay), when the test selects a day
  if (day) ctx.HCDay = day;
  if (ctxExtra) Object.assign(ctx, ctxExtra);
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML + rec.innerHTML + load.innerHTML;
}
// a stand-in for window.HCDay: sel = the past day (null = today); `go` changes it like a chevron tap
function fakeDay(sel = null) {
  const subs = [];
  const d = { sel: () => sel, iso: () => sel || ASOF, on: (fn) => subs.push(fn), go: (x) => { sel = x; subs.forEach((fn) => fn(x)); } };
  return d;
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
  const s = sdScores();
  const html = render(s);
  assert.match(html, /sc-recovery/);
  assert.ok(html.includes('<small class="rec-unit">SD</small>'), 'the one recovery unit');
  assert.match(html, /<b class="rec-num">[^<]+<small class="rec-unit">SD<\/small><\/b><span class="rec-band">/, 'the unit attached to the number, inside it');
  assert.doesNotMatch(html, /MAD/, 'no statistician jargon on the page');
  assert.match(html, /daytime SDNN/i);
  assert.equal(count(html, 'class="dd-row"'), 4);
  assert.equal(count(html, 'class="sc-raw-v"'), 4 * 14);
  assert.match(html, new RegExp(`sc-band-${s.recovery.band}`));
  assert.equal(count(html, 'class="spark"'), 1, 'one inline SVG sparkline (recovery); the load cards carry a ring, not a sparkline');
  assert.doesNotMatch(html, /<script|src=|href=/i, 'no scripts or external refs in the rendered markup');
});

// 21 days of data = 20 prior nights: under MIN_PCT_DAYS, so recovery keeps the SD headline (fallback)
const sdScores = () => fixtureScores({ days: 21 });
const recCard = (s, opts = {}) => { const hosts = {}; render(s, { ...opts, hosts }); return hosts.rec.innerHTML; };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('recovery card (text diet): big value + band word + ONE short trend line; the baseline, the full trend sentence, confidence and SDNN live in the ⓘ block', () => {
  const s = sdScores();
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
  const t7 = (s.recovery.trend7 > 0 ? '+' : '') + s.recovery.trend7.toFixed(1);
  assert.equal(text(trend[1].replace(/<span class="sc-arrow[^>]*>[^<]*<\/span>/, '')), `${enT.recovery.trendShort.replace('{value}', t7)} · ${enT.recovery.bands[s.recovery.band]}`.replace(/\s+/g, ' '));
  assert.ok(text(trend[1]).split(' ').length <= 8, 'one short line');
  assert.ok(html.indexOf('rec-big') < html.indexOf('rec-trend'), 'headline first, trend under it');
  // nothing lost: every moved sentence is in the card's ⓘ block (no Salud section block here)
  const info = html.match(/<div class="hs-info" id="rec-info" hidden>([\s\S]*?)<\/div><!--\/rec-info-->/);
  assert.ok(info, 'a hidden ⓘ block');
  assert.match(html, /<button type="button" class="hs-i" data-hs-info="rec-info" aria-expanded="false" aria-controls="rec-info"/);
  const body = text(info[1]);
  assert.ok(body.includes(enT.recovery.vsBaseLbl));
  assert.ok(body.includes(enT.recovery.trendLbl.replace('{value}', t7)));
  if (s.recovery.delta7 != null) assert.ok(body.includes(enT.recovery.deltaLbl.replace('{value}', (s.recovery.delta7 > 0 ? '+' : '') + s.recovery.delta7.toFixed(1))));
  assert.ok(body.includes(enT.recovery.confLbl.replace('{level}', enT.recovery.confLevels[s.recovery.confidence.level])));
  assert.ok(body.includes(enT.recovery.sdnnLbl));
  assert.ok(body.includes(enT.recovery.unitNote));
  const outside = html.replace(info[0], '');
  for (const moved of [enT.recovery.vsBaseLbl, enT.recovery.sdnnLbl, enT.recovery.unitNote]) assert.ok(!outside.includes(moved), `"${moved}" only behind the ⓘ`);
  assert.doesNotMatch(outside, /rec-chips|rec-vs|rec-unit-note/);
  assert.doesNotMatch(html, /class="sc-val"/, 'the trend is never the big heading any more');
  s.recovery.today = null;
  const none = recCard(s);
  assert.ok(none.includes(enT.recovery.noToday));
  assert.doesNotMatch(none, /rec-big/, 'no night composite -> no big number');
  assert.match(none, /rec-trend/);
});

test('recovery card inside Salud: the moved notes join the Recovery section\'s own ⓘ block (#hs-info-recovery), so the card draws no second ⓘ', () => {
  const secInfo = { innerHTML: '<p>section note</p>' };
  const hosts = {};
  render(fixtureScores(), { hosts, secInfo });
  const card = hosts.rec.innerHTML;
  assert.doesNotMatch(card, /rec-info|class="hs-i"/, 'no second ⓘ on the card');
  assert.ok(secInfo.innerHTML.startsWith('<p>section note</p>'), 'the section\'s own notes stay first');
  assert.match(secInfo.innerHTML, /<div class="rec-info-notes">[\s\S]*<\/div>$/);
  assert.ok(secInfo.innerHTML.includes(enT.recovery.unitNote) && secInfo.innerHTML.includes(enT.recovery.sdnnLbl));
  // a second render replaces the card's notes, never stacks them
  render(fixtureScores(), { hosts: {}, secInfo });
  assert.equal(secInfo.innerHTML.split('rec-info-notes').length - 1, 1);
});

test('recovery card: contributors are THE contributor row (icon, name, latest value + unit, ±SD sub line, ▲ / ▼ / • by the band); baseline and n sit in the ⓘ; the raw 14-day lists are folded', () => {
  const s = fixtureScores();
  const html = recCard(s);
  const rows = [...html.matchAll(/<li class="dd-row" data-row="([a-zA-Z]+)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(rows.map((r) => r[1]), s.recovery.components.map((c) => c.key));
  assert.ok(rows.length <= 4, 'at most 4 contributor rows');
  const info = text(html.match(/<div class="hs-info" id="rec-info" hidden>([\s\S]*?)<\/div><!--\/rec-info-->/)[1]);
  for (const [i, c] of s.recovery.components.entries()) {
    const body = rows[i][2];
    const dec = c.unit === 'min' ? 0 : 1;
    const last = c.daily[c.daily.length - 1].value;
    assert.match(body, /^<svg class="dd-ico"/, 'the row opens with its icon');
    assert.doesNotMatch(body, /rec-dot|sc-dot/, 'no state colour dot');
    const tone = { above: 'better', below: 'worse', at: 'typical' }[c.band];
    const side = c.band === 'above' ? c.dir : c.band === 'below' ? -c.dir : 0;
    assert.ok(body.includes(`<span class="dd-mk dd-${tone}" aria-hidden="true">${side > 0 ? '▲' : side < 0 ? '▼' : '•'}</span><span class="sr-only">${enT.recovery.cmp[tone]}</span>`), 'the trend glyph: raw direction, coloured by meaning');
    assert.ok(body.includes(enT.recovery.components[c.key]));
    assert.ok(text(body).includes(c.unit === 'h' ? fmtHours(last) : `${last.toFixed(dec)} ${c.unit}`), 'latest value + unit (hours as h:mm, no unit)');
    assert.ok(text(body).includes(`${(c.trend7 > 0 ? '+' : '') + c.trend7.toFixed(1)} SD`), 'SD vs baseline, the same unit as the composite');
    assert.ok(!text(body).includes('n='), 'n moved to the ⓘ');
    const baseline = c.unit === 'h' ? enT.recovery.baselineLbl.replace('{value}', fmtHours(c.baseline)).replace(' {unit}', '') : enT.recovery.baselineLbl.replace('{value}', c.baseline.toFixed(dec)).replace('{unit}', c.unit);
    assert.ok(!text(body).includes(baseline), 'baseline moved to the ⓘ');
    assert.ok(info.includes(`${enT.recovery.components[c.key]}: ${baseline} · n=${c.n}`), 'baseline · n per contributor in the ⓘ');
    assert.doesNotMatch(body, /sc-raw-v/, 'no raw number list inline');
  }
  // the fixture's resting HR fell this week (better): ▼ in the better colour, never a red arrow
  assert.match(rows.find((r) => r[1] === 'rhr')[2], /<span class="dd-mk dd-better" aria-hidden="true">▼<\/span>/);
  const fold = html.match(/<details class="rec-raw"><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/);
  assert.ok(fold, 'the raw lists sit in a collapsed <details>');
  assert.equal(fold[1], enT.recovery.rawSummary);
  assert.equal(count(fold[2], 'class="sc-raw-v"'), 4 * 14, 'every raw value kept, just folded');
  assert.equal(esT.recovery.rawSummary, 'Últimos 14 días');
  assert.equal(enT.recovery.rawSummary, 'Last 14 days');
  assert.match(recCard(s, { locale: 'es' }), /<summary>Últimos 14 días<\/summary>/);
});

test('recovery card: layout blocks headline | sparkline | contributors', () => {
  const html = recCard(fixtureScores());
  const at = ['class="rec-head"', 'class="sc-spark rec-spark"', 'class="dd-rows rec-contrib"'].map((n) => html.indexOf(n));
  assert.ok(at.every((v, i) => v !== -1 && (i === 0 || v > at[i - 1])), `order ${at}`);
  assert.match(html, /<div class="rec-layout">/);
});

test('colour only on the direction arrow: no grade-fill classes on the recovery card', () => {
  const html = render(fixtureScores());
  assert.match(html, /<span class="sc-arrow db-(good|flat|bad)" aria-hidden="true">[▲•▼]<\/span>/, 'THE trend glyph, coloured by the shared tone classes');
  assert.doesNotMatch(html, /sc-(red|amber|green|grade)/);
});

test('load: one compact card per modality (gym/run/bike): last session RE, "LOAD · date", a trend pill; gated ones show the reason behind ⓘ and no number', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { hosts, dials: buildDials(s, HEALTH) });
  const html = hosts.load.innerHTML;
  assert.equal((html.match(/class="ld-card[ "]/g) || []).length, 3);
  for (const m of s.load.modalities) assert.match(html, new RegExp(`data-mod="${m.key}"`));
  const run = s.load.modalities.find((m) => m.key === 'run');
  assert.equal(run.trend.ok, true);
  const card = html.match(/<div class="ld-card" data-mod="run"[\s\S]*?<\/div>/)[0];
  assert.match(card, new RegExp(`<b class="ld-num">${run.last.re}</b>`), 'big number = the last scored session RE');
  assert.match(card, /<svg class="ld-ring"[^>]*>[\s\S]*<path class="ld-fill" d="M/, 'small ring with the dial arc of that session');
  assert.match(card, /class="ld-tick"/, 'typical-day tick');
  assert.match(card, new RegExp(`<span class="ld-lbl" aria-hidden="true">${enT.dials.load.label} · `), 'LOAD · date');
  const band = run.trend.band;
  const tone = { steady: 'flat', above: 'good', below: 'good', ramping: 'bad', wellBelow: 'bad' }[band];
  assert.match(card, new RegExp(`<span class="ld-pill ld-${tone}">[▲▼•] ${run.trend.trendPct > 0 ? '\\+' : ''}${run.trend.trendPct}%</span>`), 'pill = 7-day vs 42-day, toned by band');
  assert.match(card, /aria-label="Run load\. last session [^"]*Relative Effort \d+\. 7-day vs 42-day load/, 'the card reads out in full');
  const gated = s.load.modalities.filter((m) => !m.trend.ok);
  assert.equal(count(html, 'class="ld-card ld-off"'), gated.length);
  if (gated.length) assert.match(html, new RegExp(enT.load.gated.baselineBuilding.slice(0, 20)));
  assert.match(html, /vs your own run days/, 'the relative score moved behind ⓘ, not dropped');
});

test('load card without a value (the user\'s Run card: no recent session, "—") shows no delta pill: a "▼ -64%" beside "—" read as a value', () => {
  const s = fixtureScores();
  const run = s.load.modalities.find((m) => m.key === 'run');
  assert.equal(run.trend.ok, true);
  run.last = null;
  const dials = buildDials(s, HEALTH);
  dials.load.modalities.find((m) => m.key === 'run').last = null;
  const hosts = {};
  render(s, { hosts, dials });
  const card = hosts.load.innerHTML.match(/<div class="ld-card" data-mod="run"[\s\S]*?<\/div>/)[0];
  assert.match(card, /<b class="ld-num">—<\/b>/);
  assert.doesNotMatch(card, /ld-pill/, 'no trend pill without a value');
  assert.doesNotMatch(card, /7-day vs 42-day/, 'nor in the accessible name');
  // the user's Run card: the trend is ok but the dial is gated (too few run days for a typical day) →
  // the dial's "Building" word, never the trend's delta beside "—"
  const s2 = fixtureScores();
  const d2 = buildDials(s2, HEALTH);
  Object.assign(d2.load.modalities.find((m) => m.key === 'run'), { state: 'gated', reason: 'fewDays' });
  const h2 = {};
  render(s2, { hosts: h2, dials: d2 });
  const c2 = h2.load.innerHTML.match(/<div class="ld-card ld-off" data-mod="run"[\s\S]*?<\/div>/)[0];
  assert.match(c2, /<b class="ld-num">—<\/b>/);
  assert.ok(c2.includes(`<span class="ld-pill ld-flat">${enT.dials.load.gated}</span>`));
  assert.doesNotMatch(c2, /[▲▼] [+-]?\d+%/);
});

test('load section: the relative score, coverage, other activities and caveats sit in a hidden ⓘ block the header button controls', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { hosts });
  const html = hosts.load.innerHTML;
  assert.match(html, /<section class="hs-sec sc-load[^"]*" aria-labelledby="ld-h"><div class="hs-head"><h3 class="hs-lbl" id="ld-h">Load<\/h3><button type="button" class="hs-i" data-hs-info="ld-info" aria-expanded="false" aria-controls="ld-info"/);
  const info = html.match(/<div class="hs-info" id="ld-info" hidden>([\s\S]*?)<\/div><div class="ld-cards">/);
  assert.ok(info, 'the ⓘ block precedes the cards and ships hidden');
  for (const needle of ['sc-cov-scored', 'sc-other', 'class="sc-caveat"', 'sc-mod-line', enT.load.pillHelp.slice(0, 30)]) assert.ok(info[1].includes(needle), needle);
  assert.doesNotMatch(html.slice(html.indexOf('<div class="ld-cards">')), /sc-caveat|sc-cov|sc-other/, 'no notes among the cards');
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

test('advice = the one-line "outlook" bar under "My day": icon, the short title, a chevron; the sentence is its accessible name and opens the recovery sheet', () => {
  const s = fixtureScores();
  const text = renderAdvice(s.advice, 'en');
  const linked = render(s, { now: addDays(ASOF, 1), detail: true });
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(linked, new RegExp(`<div class="sc-advice outlook" data-detail="recovery" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(enT.home.outlook + ': ' + text)}"><svg class="outlook-ico"`));
  assert.ok(linked.includes(`<span class="outlook-txt">${enT.home.outlook}</span><span class="chev outlook-chev" aria-hidden="true">›</span></div>`), 'one line: the short title');
  assert.equal(enT.home.outlook, 'Your daily outlook');
  const es = render(s, { now: addDays(ASOF, 1), detail: true, locale: 'es' });
  assert.ok(es.includes(`<span class="outlook-txt">${esT.home.outlook}</span>`));
  const plain = render(s, { now: addDays(ASOF, 1) });
  assert.match(plain, /<div class="sc-advice outlook"><svg class="outlook-ico"/, 'no detail sheet baked: a plain bar');
  assert.ok(plain.includes(`<span class="outlook-txt">${text}</span>`), 'nothing to tap: the sentence itself');
  assert.doesNotMatch(plain, /class="sc-card sc-advice/, 'no longer a bordered card');
});

test('window.HCAdvice: the sentence for the recovery page (today, fresh data); empty on a past day or stale data', () => {
  const s = fixtureScores();
  const run = (opts) => {
    const out = {};
    const ctx = { window: out };
    render(s, { ...opts, ctxExtra: ctx });
    return out.HCAdvice ? out.HCAdvice() : null;
  };
  assert.equal(run({ now: addDays(ASOF, 1) }), renderAdvice(s.advice, 'en'));
  assert.equal(run({ now: addDays(ASOF, 1), day: fakeDay(addDays(ASOF, -2)) }), '', 'a past day: no advice');
  assert.equal(run({ now: addDays(ASOF, 5) }), '', 'stale: no advice');
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
    assert.match(hosts.load.innerHTML, new RegExp(`<div class="ld-card(?: ld-off)?" data-mod="${m.key}" data-detail="load-${m.key}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="`), m.key);
  }
  // the recovery card holds a <details> fold, so the card itself is not a button: a real button opens the view
  assert.match(hosts.rec.innerHTML, new RegExp(`<div class="sc-head"><span class="sc-asof">[^<]*</span><button type="button" class="cta" data-detail="recovery" aria-haspopup="dialog">${enT.recovery.historyBtn}<span aria-hidden="true"> →</span></button>`));
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

test('recovery dial (fallback, under 21 prior days): value INSIDE the ring = LAST NIGHT (signed number + small SD unit, coloured by its band); the 7-day trend lives in the detail sheet', () => {
  const s = sdScores();
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
  assert.equal(count(d, 'class="dial-zone'), 0, 'no zone arcs: the fill takes ONE state colour (its band) end to end');
  assert.equal(count(d, 'class="dial-fill"'), 1);
  assert.match(d, /class="dial-mid"/, 'baseline tick');
  assert.doesNotMatch(d, /class="dial-dot"/, 'no marker dot: the fill ends at the value');
});

test('recovery dial (% headline): "85" + small "%" inside the ring, coloured by its % band, no baseline tick; the band word in the accessible name', () => {
  const s = fixtureScores();
  const t = s.recovery.today;
  assert.ok(Number.isInteger(t.pct), 'the 49-day fixture has 48 prior nights: a percentage');
  const d = dialOf(withDials(s), 'dial-rec');
  assert.match(d, new RegExp(`dial-band-${t.pctBand}`));
  assert.ok(d.includes(`<b class="dial-num">${t.pct}<small>%</small></b>`));
  assert.ok(d.includes(`aria-label="${enT.dials.recovery.ariaPct.replace('{when}', enT.dials.recovery.lastNight).replace('{value}', t.pct).replace('{band}', enT.recovery.pctBands[t.pctBand])}"`));
  assert.doesNotMatch(d, /class="dial-mid"/, 'no baseline tick on a % ring');
  assert.doesNotMatch(d, /<small>SD<\/small>/);
});

test('recovery card (% headline): big "pct %" + % band word; the night\'s SD value and the % mapping move behind the ⓘ', () => {
  const s = fixtureScores();
  const t = s.recovery.today;
  const html = recCard(s);
  const big = html.match(/<div class="rec-big sc-band-([a-z]+)">([\s\S]*?)<\/div>/);
  assert.equal(big[1], t.pctBand);
  assert.equal(text(big[2]), `${t.pct} % ${enT.recovery.pctBands[t.pctBand]}`);
  assert.ok(html.includes(enT.recovery.pctNote), 'the ⓘ explains the mapping');
  const sd = (t.value > 0 ? '+' : '') + t.value.toFixed(1);
  assert.ok(html.includes(enT.recovery.sdLbl.replace('{value}', sd).replace('{band}', enT.recovery.bands[t.band])), 'the SD value is kept');
  assert.match(html, /class="rec-trend"/, 'the 7-day trend line stays');
});

test('% copy: band words and the mapping note exist in es + en', () => {
  for (const T of [enT, esT]) {
    assert.deepEqual(Object.keys(T.recovery.pctBands), ['good', 'mid', 'low']);
    assert.match(T.recovery.pctNote, /90/);
    assert.match(T.dials.recovery.ariaPct, /\{value\}%/);
  }
});

test('dials: label BELOW the ring, uppercase via CSS, with a chevron; no captions under the dials (they live in each dial\'s detail sheet)', () => {
  const html = withDials(fixtureScores());
  for (const lbl of [enT.dials.sleep.label, enT.dials.recovery.label, enT.dials.load.label]) {
    assert.ok(html.includes(`<figcaption class="dial-lbl">${lbl}<span class="chev dial-chev" aria-hidden="true">›</span></figcaption>`), lbl);
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

test('carried values (HC.carried): sleep + recovery dials whose night is an earlier day name it on the ring (short date, no weekday) and are dimmed, mini rings too; today\'s and a stepped-to day\'s own values are normal', () => {
  const s = fixtureScores();
  const mini = { innerHTML: '' }, dh = { innerHTML: '' };
  withDials(s, { now: addDays(ASOF, 2), miniHost: mini, dialsHost: dh });
  const html = dh.innerHTML;
  for (const cls of ['dial-rec', 'dial-sleep']) {
    const d = dialOf(html, cls);
    assert.match(d, new RegExp(`^class="dial ${cls}[^"]* carried"`), cls + ' dimmed (carried)');
    assert.doesNotMatch(d.slice(0, d.indexOf('>')), /sc-stale/, cls + ': dimmed, not the stale grey');
    assert.ok(d.includes('<span class="carried-date">29 Sep</span>'), cls + ': the night\'s date inside the ring');
    assert.match(mini.innerHTML, new RegExp(`class="dm ${cls}[^"]* carried"`), cls + ': the collapsed row dims it too');
  }
  const fresh = withDials(s);
  for (const cls of ['dial-rec', 'dial-sleep']) assert.doesNotMatch(dialOf(fresh, cls), / carried|carried-date|sc-stale/, cls + ' today');
  // a stepped-to past day shows ITS own night: never marked as carried
  const past = withDials(s, { now: addDays(ASOF, 2), day: fakeDay(ASOF) });
  for (const cls of ['dial-rec', 'dial-sleep']) assert.doesNotMatch(dialOf(past, cls), / carried|carried-date|sc-stale/, cls + ' past day');
  // > STALE_DAYS old: the stronger stale grey wins (no dim stacked on it), the date stays
  const old = dialOf(withDials(s, { now: addDays(ASOF, 5) }), 'dial-sleep');
  assert.match(old, /^class="dial dial-sleep sc-stale"/);
  assert.ok(old.includes('<span class="carried-date">29 Sep</span>'));
  // load never carries: its dials read the viewer's day only ("No data" / rest, never an earlier day's value)
  const ld = withDials(s, { now: addDays(ASOF, 2) });
  const i = ld.indexOf('class="dial dial-load'), load = ld.slice(i, ld.indexOf('</figure>', i));
  assert.doesNotMatch(load, / carried"|carried-date/);
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

test('sleep dial: sleep performance % in the ring (asleep / need), hours + need in the accessible name (es decimal comma)', () => {
  const s = fixtureScores();
  const last = s.recovery.components.find((c) => c.key === 'sleepDur').daily.at(-1).value;
  const dials = buildDials(s, HEALTH);
  const html = withDials(s, { locale: 'es', T: esT });
  const d = dialOf(html, 'dial-sleep');
  assert.ok(Number.isInteger(dials.sleep.pct));
  assert.equal(dials.sleep.pct, Math.min(100, Math.round((100 * last) / 7.5)));
  assert.ok(d.includes(`<b class="dial-num">${dials.sleep.pct}<small>%</small></b>`), 'the % inside the ring');
  assert.ok(d.includes(fmtHours(last)), 'hours as h:mm in the accessible name');
  assert.ok(d.includes('7:30'), 'need (= the target) in the accessible name');
  assert.ok(d.includes(esT.dials.sleep.label));
  // fallback: a dial without a % keeps the hours
  const h = dialOf(render(s, { dials: { ...dials, sleep: { ...dials.sleep, pct: null } }, locale: 'es', T: esT }), 'dial-sleep');
  assert.match(h, /<b class="dial-num">\d:\d\d<small><\/small><\/b>/, 'hours as h:mm, no unit');
});

test('load dial: one visible modality (default = first ungated), no pills on Inicio (they are in the load deep-dive), gated greyed with the existing copy', () => {
  const s = fixtureScores();
  const html = withDials(s);
  const D = buildDials(s, HEALTH).load;
  assert.doesNotMatch(html, /dial-switch|dial-mod|aria-pressed/, 'no gym / run / bike pills under the dials');
  assert.equal(count(html, '<figure class="dial dial-load'), D.modalities.length, 'every modality keeps its (hidden) dial for scMod');
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
  assert.ok(!html.split('<section class="hs-sec sc-load')[0].includes('last session Tue 29 Sep'), 'the last session line is in the load detail sheet (and on Entreno\'s card), not on Inicio');
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
const visibleFig = (html) => (html.match(/<figure class="dial dial-load[^"]*" data-dmod="([a-z]+)"[^>]*?(?<!hidden)>/) || [])[1];
// the modality the load dial opens on = its one visible figure (the pills moved to the load deep-dive)
const pressedMod = visibleFig;

test('load dial default: the modality with a session on the viewer\'s today, not the first ungated one', () => {
  const ok = buildDials(fixtureScores(), HEALTH).load.modalities.filter((m) => m.state === 'ok').map((m) => m.key);
  assert.ok(ok.length >= 2, `fixture needs two ungated modalities, got ${ok}`);
  const [first, second] = ok;
  const s = withToday(fixtureScores(), { [second]: 94 });
  const html = withDials(s);
  assert.equal(visibleFig(html), second, 'its dial is the visible one');
  assert.ok(figOf(html, second).includes('<b class="dial-num">94<small>RE</small></b>'));
  assert.match(html, new RegExp(`<figure class="dial dial-load[^"]*" data-dmod="${first}" hidden`), 'the first ungated one is hidden');
  assert.equal(count(html.match(/<figure class="dial dial-load[^>]*>/g).join(''), ' hidden>'), 2, 'one visible load dial');
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

test('scMod: shows only the chosen modality\'s load dial on Inicio and in the collapsed row (the pills live in the load deep-dive)', () => {
  const el = (key) => ({ key, hidden: false, getAttribute: (a) => (a === 'data-dmod' ? key : null) });
  const panes = ['gym', 'run', 'bike'].map((k) => el(k));
  const minis = ['gym', 'run', 'bike'].map((k) => el(k));
  const hosts = { 'home-dials': { querySelectorAll: () => panes }, 'home-mini': { querySelectorAll: () => minis } };
  const ctx = { document: { getElementById: (id) => hosts[id] || null } };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  ctx.scMod('bike');
  assert.deepEqual(panes.map((p) => p.hidden), [true, true, false]);
  assert.deepEqual(minis.map((p) => p.hidden), [true, true, false], 'the collapsed row follows');
  ctx.scMod('gym');
  assert.deepEqual(panes.map((p) => p.hidden), [false, true, true]);
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
  const card = recCard(sdScores());
  assert.ok(card.includes(enT.recovery.unitNote), 'the card explains the unit (behind its ⓘ)');
  const es = (() => { const hosts = {}; render(sdScores(), { locale: 'es', hosts }); return hosts.rec.innerHTML; })();
  assert.ok(es.includes('<small class="rec-unit">desv.</small>'));
  assert.ok(es.includes(esT.recovery.unitNote));
  assert.doesNotMatch(es, /MAD/);
  const dial = dialOf(withDials(sdScores()), 'dial-rec');
  assert.match(dial, / SD/, 'the dial: same unit');
  assert.doesNotMatch(dial, / sd\b/);
});

test('recovery dial colour: ONE state colour per band (good / mid / low), the same tokens on Inicio and the detail hero', () => {
  const css = fs.readFileSync(path.join(here, '..', 'styles', 'score.css'), 'utf8');
  const rule = (sel) => { const m = new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css); return m ? m[1] : ''; };
  assert.match(rule('.dial-band-above'), /--dial-c:\s*var\(--good\)/);
  assert.match(rule('.dial-band-at'), /--dial-c:\s*var\(--mid\)/, 'at baseline = the mid (yellow) state, never the blue trend colour');
  assert.match(rule('.dial-band-below'), /--dial-c:\s*var\(--low\)/);
  assert.doesNotMatch(css, /\.dial-zone/, 'no zone arcs left to tint part of the ring');
});

/* ---- day stepping (the top bar's ‹ TODAY ›): the dials follow the selected day ---- */

test('day stepping: today selected renders byte-identically to a page without day stepping', () => {
  const s = fixtureScores();
  const D = buildDials(s, HEALTH);
  const a = { dialsHost: { innerHTML: '' }, miniHost: { innerHTML: '' } };
  const b = { dialsHost: { innerHTML: '' }, miniHost: { innerHTML: '' } };
  const plain = render(s, { dials: D, ...a, detail: true });
  const stepped = render(s, { dials: D, ...b, detail: true, day: fakeDay(null) });
  assert.equal(stepped, plain);
  assert.equal(b.dialsHost.innerHTML, a.dialsHost.innerHTML);
  assert.equal(b.miniHost.innerHTML, a.miniHost.innerHTML);
});

test('day stepping: a past day shows THAT day\'s sleep %, recovery % and load, opens the dials on that day, hides the advice', () => {
  const s = fixtureScores();
  const D = buildDials(s, HEALTH);
  const t = addDays(ASOF, -4);
  const past = D.days.find((x) => x.date === t);
  assert.equal(past.recovery.state, 'ok');
  const dialsHost = { innerHTML: '' }, miniHost = { innerHTML: '' };
  const home = render(s, { dials: D, dialsHost, miniHost, detail: true, day: fakeDay(t) });
  const h = dialsHost.innerHTML;
  assert.match(h, new RegExp(`dial-rec dial-band-${past.recovery.band}`));
  assert.ok(h.includes(`<b class="dial-num">${past.recovery.pct}<small>%</small></b>`), 'the day\'s recovery %');
  assert.ok(h.includes(`<b class="dial-num">${past.sleep.pct}<small>%</small></b>`), 'the day\'s sleep %');
  assert.ok(h.includes(past.recovery.fill) && h.includes(past.sleep.fill), 'the day\'s baked rings');
  // load: the session of that day from the baked recent days (run on even indexes: day -4 has one)
  const run = D.load.modalities.find((m) => m.key === 'run');
  const day = run.days.find((x) => x.date === t);
  assert.ok(day && day.re > 0);
  assert.ok(h.includes(`<b class="dial-num">${day.re}<small>RE</small></b>`));
  assert.match(h, /data-dmod="run"(?![^>]*hidden)/, 'the switch opens on the modality trained that day');
  assert.equal(count(h, `data-date="${t}"`), count(h, 'data-detail='), 'every dial opens its deep-dive on that day');
  assert.equal(count(miniHost.innerHTML, `data-date="${t}"`), count(miniHost.innerHTML, 'data-detail='), 'the collapsed row too');
  assert.doesNotMatch(h, /Last night/);
  assert.match(h, /aria-label="Recovery as of \w{3} \d+ \w{3}: /, 'the night is named by its date');
  assert.doesNotMatch(home, /sc-advice/, 'the advice reads the current 7-day trend: hidden on a past day');
  assert.doesNotMatch(h, /dial-stale|sc-stale/, 'a past day is never greyed as stale');
});

test('day stepping: a past day without its data reads "No data" / no session, never another day\'s value', () => {
  const s = fixtureScores();
  const D = buildDials(s, HEALTH);
  const t = addDays(ASOF, -20); // reachable by the 30-day cap but older than the 14 baked days
  const dialsHost = { innerHTML: '' };
  render(s, { dials: D, dialsHost, day: fakeDay(t) });
  const h = dialsHost.innerHTML;
  assert.equal(count(h, '<span class="dial-word">No data</span>'), 2, 'sleep + recovery');
  assert.match(h, /dial-load dial-rest[^>]*>[\s\S]*?<span class="dial-word">No session<\/span>/);
  assert.doesNotMatch(h, /dial-num/);
});

test('day stepping: a change re-renders the dials and the collapsed row; back to today restores today\'s markup', () => {
  const s = fixtureScores();
  const D = buildDials(s, HEALTH);
  const dialsHost = { innerHTML: '' }, miniHost = { innerHTML: '' }, hosts = {};
  const day = fakeDay(null);
  render(s, { dials: D, dialsHost, miniHost, hosts, day, detail: true });
  const today = dialsHost.innerHTML, todayMini = miniHost.innerHTML, todayHome = hosts.home.innerHTML;
  const t = addDays(ASOF, -1);
  day.go(t);
  assert.notEqual(dialsHost.innerHTML, today);
  assert.match(miniHost.innerHTML, new RegExp(`data-date="${t}"`));
  assert.equal(hosts.home.innerHTML, '', 'the advice host empties');
  day.go(null);
  assert.equal(dialsHost.innerHTML, today);
  assert.equal(miniHost.innerHTML, todayMini);
  assert.equal(hosts.home.innerHTML, todayHome);
});

/* ---- day strain dial (DIALS.strain, lib/score/strain.mjs) ---- */
const STRAIN = { ok: true, asOf: ASOF, days: [{ date: addDays(ASOF, -1), s: 8.3 }, { date: ASOF, s: 12.4 }] };

test('strain dial: calibrated strain replaces the load dial — "12.4" inside, the Load label, opens the strain view, no modality pills', () => {
  const s = { ...fixtureScores(), strain: STRAIN };
  const dialsHost = { innerHTML: '' }, miniHost = { innerHTML: '' };
  render(s, { dials: buildDials(s, HEALTH), dialsHost, miniHost, detail: true });
  const h = dialsHost.innerHTML;
  const d = dialOf(h, 'dial-load dial-strain');
  assert.match(d, /<b class="dial-num">12\.4<small><\/small><\/b>/);
  assert.match(d, /data-detail="strain"/);
  assert.match(d, new RegExp(`<figcaption class="dial-lbl">${enT.dials.load.label}`));
  assert.doesNotMatch(h, /dial-switch|dial-mod|data-dmod/, 'no gym / run / bike pills on Inicio');
  assert.equal(count(h, 'class="dial-svg"'), 3);
  assert.equal(count(miniHost.innerHTML, '<div class="dm '), 3, 'the collapsed row follows: three rings');
  assert.match(miniHost.innerHTML, /dm dial-load dial-strain[^>]*data-detail="strain"/);
});

test('strain dial: day stepping shows that day\'s strain; a day the data does not reach reads "No data"', () => {
  const s = { ...fixtureScores(), strain: STRAIN };
  const D = buildDials(s, HEALTH);
  const past = { innerHTML: '' };
  render(s, { dials: D, dialsHost: past, day: fakeDay(addDays(ASOF, -1)) });
  assert.match(dialOf(past.innerHTML, 'dial-load dial-strain'), /<b class="dial-num">8\.3</);
  const none = { innerHTML: '' };
  render(s, { dials: D, dialsHost: none, day: fakeDay(addDays(ASOF, -5)) });
  assert.match(dialOf(none.innerHTML, 'dial-load dial-strain dial-off'), /<span class="dial-word">No data<\/span>/);
});

test('strain dial: not calibrated (strain ok false / absent) -> the per-modality load dials (their pills are in the load deep-dive)', () => {
  const s = { ...fixtureScores(), strain: { ok: false, reason: 'fewDays', asOf: ASOF, n: 3 } };
  const h = render(s, { dials: buildDials(s, HEALTH) });
  assert.doesNotMatch(h, /dial-strain|dial-switch/);
  assert.match(h, /<figure class="dial dial-load[^"]*" data-dmod="/);
});

test('recovery card head: no duplicate title — only the as-of date, the History CTA and the ⓘ, in that order', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { now: addDays(ASOF, 1), hosts, detail: true });
  const head = hosts.rec.innerHTML.match(/<div class="sc-head">([\s\S]*?)<\/div>/)[1];
  const parts = [...head.matchAll(/<(span|button) [^>]*class="([^"]+)"/g)].map((m) => m[2]).filter((c) => !/chev|sc-asof-/.test(c));
  assert.deepEqual(parts, ['sc-asof', 'cta', 'hs-i'], 'date, History, ⓘ');
  assert.match(head, /<button type="button" class="cta" data-detail="recovery" aria-haspopup="dialog">History<span aria-hidden="true"> →<\/span><\/button>/);
  assert.match(head, /<button type="button" class="hs-i" data-hs-info="rec-info" aria-expanded="false" aria-controls="rec-info" aria-label="About Recovery">/);
  assert.doesNotMatch(hosts.rec.innerHTML, /<h[1-6]|sc-title/, 'no card title: the Salud section heading names it');
  assert.ok(!text(head).includes(enT.recovery.heading), 'the section name is not repeated in the head');
});

test('carried values (HC.carried): Salud\'s recovery card dims a headline night from an earlier day (its date already heads it); today\'s night is normal; stale keeps the card grey only', () => {
  const s = fixtureScores();
  const big = (now) => { const hosts = {}; render(s, { now, hosts }); return hosts.rec.innerHTML.match(/<div class="rec-big[^"]*"/)[0]; };
  assert.equal(big(addDays(ASOF, 2)).includes(' carried"'), true, 'carried night dimmed');
  assert.doesNotMatch(big(ASOF), /carried/);
  const hosts = {};
  render(s, { now: addDays(ASOF, 2), hosts });
  assert.ok(hosts.rec.innerHTML.includes('<div class="rec-when">Tue 29 Sep</div>'), 'its date names the night (weekday kept: full width)');
  assert.doesNotMatch(big(addDays(ASOF, 5)), /carried/, 'stale: the card\'s grey is the stronger state');
});
