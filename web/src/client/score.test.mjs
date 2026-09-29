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

// Returns #home + #score-recovery (Salud) + #score-load (Entreno), in that order; pass `hosts` to
// inspect each one separately.
function render(scores, { locale = 'en', now = ASOF, T, healthNav = false, entrenoNav = healthNav, dials, dialsHost, hosts = {} } = {}) {
  const host = { innerHTML: '' };
  const rec = (hosts.rec = hosts.rec || { innerHTML: '' });
  const load = (hosts.load = hosts.load || { innerHTML: '' });
  hosts.home = host;
  const RealDate = Date;
  class FakeDate extends RealDate {
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const byId = {
    home: host, 'score-recovery': rec, 'score-load': load,
    'home-dials': dialsHost || null, 't-health': healthNav ? {} : null, 't-entreno': entrenoNav ? {} : null,
  };
  const ctx = {
    document: { getElementById: (id) => byId[id] || null },
    SCORES: scores, DIALS: dials, I18N_SCORE: T || (locale === 'es' ? esT : enT), LOCALE: locale, Date: FakeDate, Math, String, Number, Array, Object, JSON, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML + rec.innerHTML + load.innerHTML;
}
const count = (html, needle) => html.split(needle).length - 1;

test('empty state: no data renders .train-empty and nothing else', () => {
  const html = render({ hasData: false, asOf: null, reEpoch: null, recovery: null, load: null, advice: null });
  assert.match(html, /train-empty/);
  assert.doesNotMatch(html, /sc-card/);
});

test('a missing host element or missing SCORES does not throw', () => {
  assert.doesNotThrow(() => render(undefined));
});

test('full render: recovery trend with band, per-component rows and 14 raw dailies each', () => {
  const s = fixtureScores();
  const html = render(s);
  assert.match(html, /sc-recovery/);
  assert.match(html, /MAD/);
  assert.match(html, /daytime SDNN/i);
  assert.equal(count(html, 'class="sc-comp"'), 4);
  assert.equal(count(html, 'class="sc-raw-v"'), 4 * 14);
  assert.match(html, new RegExp(`sc-band-${s.recovery.band}`));
  assert.equal(count(html, 'class="spark"'), 1 + s.load.modalities.length, 'inline SVG sparklines (recovery + one per modality)');
  assert.doesNotMatch(html, /<script|src=|href=/i, 'no scripts or external refs in the rendered markup');
});

test('recovery card leads with last night (MAD + band), then the 7-day trend; says so when last night is missing', () => {
  const s = fixtureScores();
  const html = render(s);
  const t = s.recovery.today;
  const line = enT.recovery.todayLbl.replace('{value}', (t.value > 0 ? '+' : '') + t.value.toFixed(1));
  assert.ok(html.includes(line), line);
  assert.ok(html.indexOf('sc-today') < html.indexOf('class="sc-val"'), 'last night before the trend');
  assert.match(html, new RegExp(`sc-today sc-band-${t.band}`));
  s.recovery.today = null;
  assert.ok(render(s).includes(enT.recovery.noToday));
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
  for (const k of ['scored', 'unscored', 'invalid', 'droppedJunk', 'preEpoch']) {
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
  assert.ok(html.includes(`as of ${ASOF}`));
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

test('es locale uses decimal commas for MAD values', () => {
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

test('detail cards are not links any more (they ARE the detail); the dials open it instead', () => {
  const s = fixtureScores();
  const hosts = {};
  render(s, { now: addDays(ASOF, 1), healthNav: true, hosts });
  assert.doesNotMatch(hosts.rec.innerHTML + hosts.load.innerHTML, /jumpOr\(/);
});

test('dial taps: sleep -> Salud #hl-sleep, recovery -> Salud #hl-recovery, load -> Entreno #score-load; only when that tab is reachable', () => {
  const s = fixtureScores();
  const dials = buildDials(s, HEALTH);
  const linked = render(s, { now: addDays(ASOF, 1), dials, healthNav: true, entrenoNav: true });
  assert.match(dialOf(linked, 'dial-sleep'), /role="button" tabindex="0" onclick="jumpOr\('hl-sleep','health'\)"/);
  assert.match(dialOf(linked, 'dial-rec'), /onclick="jumpOr\('hl-recovery','health'\)"/);
  assert.equal(count(linked, `onclick="jumpOr('score-load','entreno')"`), s.load.modalities.length, 'every load-modality dial opens the Entreno load detail');
  assert.match(linked, /onkeydown=/, 'keyboard users can activate a dial');
  const noEntreno = render(s, { now: addDays(ASOF, 1), dials, healthNav: true, entrenoNav: false });
  assert.doesNotMatch(noEntreno, /jumpOr\('score-load'/, 'no load link when Entreno is hidden');
  assert.match(noEntreno, /jumpOr\('hl-recovery'/);
  const unlinked = render(s, { now: addDays(ASOF, 1), dials, healthNav: false, entrenoNav: false });
  assert.doesNotMatch(unlinked, /jumpOr\(/, 'no links when page.hideTabs hides Salud and Entreno');
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

test('dials: absent DIALS global renders the cards exactly as before (no dial card)', () => {
  const html = render(fixtureScores());
  assert.doesNotMatch(html, /sc-dials/);
});

test('recovery dial: headline = LAST NIGHT (band word + signed sd, coloured by that band), 7-day trend + direction underneath, never a percentage', () => {
  const s = fixtureScores();
  assert.ok(s.recovery.today, 'fixture has a composite for the asOf night');
  const d = dialOf(withDials(s), 'dial-rec');
  const t = s.recovery.today;
  assert.match(d, new RegExp(`dial-band-${t.band}`));
  assert.ok(d.includes(enT.dials.recovery.bands[t.band]));
  const sd = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
  assert.ok(d.includes(`${sd(t.value)} sd`), `expected ${sd(t.value)} sd`);
  assert.ok(d.includes(enT.dials.recovery.lastNight), 'says it is last night when the data is from today');
  const trendLine = enT.dials.recovery.trendLine.replace('{dir}', enT.dials.recovery.dirs[s.recovery.trendDir]).replace('{value}', sd(s.recovery.trend7));
  assert.ok(d.includes(trendLine), `expected "${trendLine}"`);
  assert.doesNotMatch(d, /%/);
  assert.equal(count(d, 'class="dial-zone'), 3, 'below / at / above zones');
  assert.match(d, /class="dial-dot"/);
});

test('recovery dial: an older night is labelled with its date, not "last night"', () => {
  const s = fixtureScores();
  const d = dialOf(withDials(s, { now: addDays(ASOF, 2) }), 'dial-rec');
  assert.ok(!d.includes(enT.dials.recovery.lastNight));
  assert.ok(d.includes(ASOF));
});

test('recovery dial: a composite without a sleep-duration reading is labelled by date + "no sleep data", never "last night"', () => {
  const s = fixtureScores();
  s.recovery.today = { ...s.recovery.today, sleep: false };
  const d = dialOf(withDials(s), 'dial-rec');
  assert.ok(!d.includes(enT.dials.recovery.lastNight + '<'));
  assert.ok(d.includes(ASOF));
  assert.ok(d.includes(enT.dials.recovery.noSleep));
  const card = render(s);
  assert.ok(!card.includes('Last night:'), 'the recovery card does not call it last night either');
  assert.ok(card.includes(enT.recovery.todayNoSleepLbl.split('{')[0]) || card.includes(ASOF));
});

test('recovery card: an older night is labelled by its date, not "Last night"', () => {
  const s = fixtureScores();
  const html = render(s, { now: addDays(ASOF, 1) });
  assert.ok(!html.includes('Last night:'));
  assert.ok(html.includes(enT.recovery.todayDateLbl.split(':')[0].replace('{date}', ASOF)));
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
  assert.ok(d.includes(enT.dials.recovery.noLastNight));
  assert.ok(!d.includes(enT.dials.recovery.lastNight + '<'));
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
  assert.ok(d.includes('7,5'), 'target on screen');
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
    assert.match(html, new RegExp(`dial-cap[^>]*data-dmod="${g.key}"[^>]*>${enT.load.gated[g.reason].slice(0, 20)}`));
  }
  assert.ok(html.includes(enT.dials.load.scale), 'typical-day scale label');
  assert.doesNotMatch(html, /×/, 'no acute/chronic ratio as the headline any more');
});

const figOf = (html, key) => {
  const i = html.indexOf(`data-dmod="${key}"`, html.indexOf('<figure class="dial dial-load'));
  return html.slice(i, html.indexOf('</figure>', i));
};
const capOf = (html, key) => {
  const m = html.match(new RegExp(`<div class="dial-cap" data-dmod="${key}"[^>]*>([\\s\\S]*?)</div>`));
  return m ? m[1] : '';
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
  assert.ok(fig.includes('<b class="dial-num">57</b>'));
  assert.ok(fig.includes(`d="${d.days[2].fill}"`), 'the baked geometry of that day');
  const cap = capOf(html, 'run');
  assert.ok(cap.includes('Today: RE 57'), cap);
  assert.ok(cap.includes('typical day ~' + Math.round(d.typical)), cap);
  assert.ok(cap.includes('7-day vs 42-day load: ' + (d.trendPct > 0 ? '+' : '') + d.trendPct + '%'), 'trend context kept');
});

test('load dial: rows today but no Relative Effort -> "no effort data", never rest', () => {
  const s = withRecent(fixtureScores(), RECENT, { date: addDays(ASOF, -2), re: 44 });
  const html = withDials(s, { now: addDays(ASOF, -1) });
  const fig = figOf(html, 'run');
  assert.ok(fig.includes(enT.dials.load.noEffort));
  assert.doesNotMatch(fig, new RegExp(enT.dials.load.rest));
  assert.doesNotMatch(fig, /dial-num|dial-dot/);
  assert.ok(capOf(html, 'run').startsWith(enT.dials.load.noEffortLine.split('·')[0].trim()));
});

test('load dial: no session today -> "No session yet today" with the last session (date + RE) as context', () => {
  const s = withRecent(fixtureScores(), RECENT, { date: ASOF, re: 57 });
  const html = withDials(s, { now: addDays(ASOF, 1) });
  const fig = figOf(html, 'run');
  assert.ok(fig.includes(enT.dials.load.rest));
  assert.doesNotMatch(fig, /dial-num|dial-dot/);
  const cap = capOf(html, 'run');
  assert.ok(cap.startsWith('No session yet today · last session ' + ASOF + ': RE 57'), cap);
  const none = withRecent(fixtureScores(), [], null);
  assert.ok(capOf(withDials(none), 'run').startsWith('No session yet today · typical day'), 'no last session known');
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
  const ctx = { document: { getElementById: () => null } };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.scMod('bike', btns[2]);
  assert.deepEqual(btns.map((b) => b.pressed), ['false', 'false', 'true']);
  assert.deepEqual(panes.map((p) => p.hidden), [true, true, true, true, false, false]);
});
