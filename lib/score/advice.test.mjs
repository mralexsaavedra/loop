import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, advise } from './advice.mjs';
import { ADVICE_COPY, renderAdvice } from './advice-copy.mjs';
import { trendBand, RAMPING_PCT, EASING_PCT } from './load.mjs';
import { recoveryBand } from './recovery.mjs';

const rec = (trend7, extra = {}) => ({ gated: false, asOf: '2026-09-29', band: recoveryBand(trend7), trend7, delta7: 0.3, driver: 'rhr', ...extra });
const mod = (key, trendPct, ok = true) => ({ key, trend: { ok, trendPct: ok ? trendPct : null } });
const load = (...modalities) => ({ asOf: '2026-09-29', modalities });

const CASES = [
  ['aboveRamping', rec(0.7), load(mod('run', 35))],
  ['aboveEasing', rec(0.7), load(mod('run', -12), mod('gym', -15))],
  ['above', rec(0.7), load(mod('run', 15))],
  ['atBaselineRamping', rec(0.2), load(mod('run', 35))],
  ['atBaseline', rec(0.2), load(mod('run', 5))],
  ['belowRamping', rec(-0.8), load(mod('run', 35))],
  ['below', rec(-0.8), load(mod('run', 0))],
  ['trendBuilding', rec(0.7), load(mod('run', 0, false), mod('gym', 0, false))],
];

test('every rule and trendBuilding is reachable, and RULES lists exactly those keys', () => {
  for (const [key, r, l] of CASES) assert.equal(advise({ recovery: r, load: l }).key, key, key);
  assert.deepEqual([...RULES.map((x) => x.key)].sort(), CASES.map((c) => c[0]).sort());
});

test('advise reads the baked recovery.band (the band of the number shown), never recomputes it', () => {
  // the bake rounds trend7 to 0.5 and bands that value: 'above' (an unrounded 0.4996 would be 'at')
  assert.equal(advise({ recovery: rec(0.5, { band: 'above' }), load: load(mod('run', 5)) }).key, 'above');
  assert.equal(advise({ recovery: rec(0.5, { band: 'at' }), load: load(mod('run', 5)) }).key, 'atBaseline');
});

test('there is no noRecovery rule (no data means no advice, not an advice sentence)', () => {
  assert.equal(RULES.some((x) => x.key === 'noRecovery'), false);
  assert.equal('noRecovery' in ADVICE_COPY.en, false);
  assert.equal('noRecovery' in ADVICE_COPY.es, false);
});

test('first match wins: +0.7 with run +35 and gym -15 is aboveRamping, never aboveEasing', () => {
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', 35), mod('gym', -15)) }).key, 'aboveRamping');
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', 35), mod('gym', -12)) }).key, 'aboveRamping');
});

test('trend7 +0.7 and run +35 -> aboveRamping citing both inputs', () => {
  const a = advise({ recovery: rec(0.7), load: load(mod('run', 35)) });
  assert.equal(a.key, 'aboveRamping');
  assert.equal(a.vars.trend7, 0.7);
  assert.equal(a.vars.trendPct, 35);
  assert.equal(a.vars.modality, 'run');
  const en = renderAdvice(a, 'en');
  assert.match(en, /0\.7 SD/);
  assert.match(en, /\+35%/);
  assert.match(en, /run/);
});

test('trendPct_any is the max over OK modalities only; a gated modality is ignored', () => {
  const a = advise({ recovery: rec(0.7), load: load(mod('gym', 99, false), mod('run', -12)) });
  assert.equal(a.key, 'aboveEasing');
  assert.equal(a.vars.modality, 'run');
});

test('thresholds: +0.5 is above, -0.5 is below; trendPct +30 ramps, +29 does not, -10 eases', () => {
  assert.equal(advise({ recovery: rec(0.5), load: load(mod('run', 0)) }).key, 'above');
  assert.equal(advise({ recovery: rec(-0.5), load: load(mod('run', 0)) }).key, 'below');
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', 30)) }).key, 'aboveRamping');
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', 29)) }).key, 'above');
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', -10)) }).key, 'aboveEasing');
  assert.equal(advise({ recovery: rec(0.7), load: load(mod('run', -9)) }).key, 'above');
});

test('no advice when recovery is gated or missing, or when there is no load block', () => {
  assert.equal(advise({ recovery: { gated: true, reason: 'insufficient', trend7: null }, load: load(mod('run', 35)) }), null);
  assert.equal(advise({ recovery: null, load: load(mod('run', 35)) }), null);
  assert.equal(advise({ recovery: rec(0.7), load: null }), null);
  assert.equal(advise({}), null);
  assert.equal(advise(), null);
});

test('every advice cites its inputs and is JSON-safe', () => {
  for (const [, r, l] of CASES) {
    const a = advise({ recovery: r, load: l });
    assert.ok(Array.isArray(a.inputs) && a.inputs.length >= 1);
    assert.ok(a.inputs.some((i) => i.id === 'recovery.trend7' && i.value === r.trend7));
    assert.deepEqual(Object.keys(a.vars).sort(), ['asOf', 'delta7', 'driver', 'modality', 'trendPct', 'trend7'].sort());
    JSON.parse(JSON.stringify(a));
  }
  const ramping = advise({ recovery: rec(0.7), load: load(mod('run', 35)) });
  assert.ok(ramping.inputs.some((i) => i.id === 'load.run.trendPct' && i.value === 35));
});

test('advice keys are covered by both locales and the copy has no extras', () => {
  const keys = RULES.map((x) => x.key).sort();
  assert.deepEqual(Object.keys(ADVICE_COPY.es).sort(), keys);
  assert.deepEqual(Object.keys(ADVICE_COPY.en).sort(), keys);
});

/* ---------- advice wording (task 4.2, corrected) ----------
 * The spec's literal guard  /rest|skip|stop|replace|descansa|salta|para/i  is NOT used: it is an
 * unanchored substring match. "para" is an ordinary Spanish preposition ("para hoy"), and the
 * pattern also fires on "resting", "comparado" and "parametro", so it would reject harmless copy
 * and force contorted wording. Two stronger checks replace it:
 *   (a) an exact snapshot of every rendered sentence, so any copy change is a deliberate diff;
 *   (b) a word-boundary check on unambiguous imperatives only.
 */
const SPEC_REGEX = /rest|skip|stop|replace|descansa|salta|para/i;
const IMPERATIVE_EN = /\b(rest|skip|stop|replace|reduce|increase)\b/i;
const IMPERATIVE_ES = /\b(descansa|descanse|sáltate|saltate|salta|omite|reduce|aumenta|entrena|evita)\b/i;

const SAMPLE = {
  aboveRamping: { trend7: 0.7, trendPct: 35 },
  aboveEasing: { trend7: 0.7, trendPct: -12 },
  above: { trend7: 0.7, trendPct: 15 },
  atBaselineRamping: { trend7: 0.2, trendPct: 35 },
  atBaseline: { trend7: 0.2, trendPct: 5 },
  belowRamping: { trend7: -0.8, trendPct: 35 },
  below: { trend7: -0.8, trendPct: 0 },
  trendBuilding: { trend7: 0.2, trendPct: null },
};
const render = (key, locale) => renderAdvice({ key, vars: { delta7: 0.3, driver: 'rhr', modality: 'run', asOf: '2026-09-29', ...SAMPLE[key] }, inputs: [] }, locale);

const APPROVED = {
  en: {
    aboveRamping: 'Over the last 7 days recovery has averaged 0.7 SD above your 42-day baseline and run load is +35% vs its 6-week average, so the ramp is landing on good recovery.',
    aboveEasing: 'Over the last 7 days recovery has averaged 0.7 SD above your 42-day baseline while run load is -12% vs its 6-week average.',
    above: 'Over the last 7 days recovery has averaged 0.7 SD above your 42-day baseline (+0.3 vs the week before).',
    atBaselineRamping: 'Over the last 7 days recovery has stayed at baseline (+0.2 SD) while run load is +35% vs its 6-week average.',
    atBaseline: 'Over the last 7 days recovery has stayed at baseline (+0.2 SD, +0.3 vs the week before).',
    belowRamping: 'Over the last 7 days recovery has averaged 0.8 SD below your 42-day baseline while run load is +35% vs its 6-week average.',
    below: 'Over the last 7 days recovery has averaged 0.8 SD below your 42-day baseline (+0.3 vs the week before).',
    trendBuilding: 'Over the last 7 days recovery has averaged +0.2 SD vs your 42-day baseline; load trends are still building (they need 4+ weeks of Relative Effort and 8+ active days per modality).',
  },
  es: {
    aboveRamping: 'En los últimos 7 días la recuperación ha promediado 0,7 desv. por encima de tu línea base de 42 días y la carga de carrera es +35% frente a su media de 6 semanas: la subida de carga llega con buena recuperación.',
    aboveEasing: 'En los últimos 7 días la recuperación ha promediado 0,7 desv. por encima de tu línea base de 42 días mientras la carga de carrera es -12% frente a su media de 6 semanas.',
    above: 'En los últimos 7 días la recuperación ha promediado 0,7 desv. por encima de tu línea base de 42 días (+0,3 frente a la semana anterior).',
    atBaselineRamping: 'En los últimos 7 días la recuperación se ha mantenido en su línea base (+0,2 desv.) mientras la carga de carrera es +35% frente a su media de 6 semanas.',
    atBaseline: 'En los últimos 7 días la recuperación se ha mantenido en su línea base (+0,2 desv., +0,3 frente a la semana anterior).',
    belowRamping: 'En los últimos 7 días la recuperación ha promediado 0,8 desv. por debajo de tu línea base de 42 días mientras la carga de carrera es +35% frente a su media de 6 semanas.',
    below: 'En los últimos 7 días la recuperación ha promediado 0,8 desv. por debajo de tu línea base de 42 días (+0,3 frente a la semana anterior).',
    trendBuilding: 'En los últimos 7 días la recuperación ha promediado +0,2 desv. frente a tu línea base de 42 días; las tendencias de carga aún se están formando (necesitan 4+ semanas de Esfuerzo Relativo y 8+ días activos por modalidad).',
  },
};

for (const locale of ['en', 'es']) {
  for (const key of Object.keys(APPROVED[locale])) {
    test(`approved copy snapshot [${locale}] ${key}`, () => {
      assert.equal(render(key, locale), APPROVED[locale][key]);
    });
  }
}

test('no rendered advice contains an unambiguous imperative (word-boundary check, en and es)', () => {
  for (const key of Object.keys(SAMPLE)) {
    assert.doesNotMatch(render(key, 'en'), IMPERATIVE_EN, `en ${key}`);
    assert.doesNotMatch(render(key, 'es'), IMPERATIVE_ES, `es ${key}`);
  }
});

test('the imperative check catches real imperatives and ignores look-alikes', () => {
  assert.match('Rest today', IMPERATIVE_EN);
  assert.match('Skip the session', IMPERATIVE_EN);
  assert.match('Descansa hoy', IMPERATIVE_ES);
  assert.match('Evita el intervalo', IMPERATIVE_ES);
  assert.doesNotMatch('resting heart rate', IMPERATIVE_EN);
  assert.doesNotMatch('Datos para hoy, comparado con el parámetro', IMPERATIVE_ES);
});

test('why a plain substring regex was dropped: it flags harmless Spanish and English copy', () => {
  for (const harmless of ['Datos para hoy', 'comparado con ayer', 'los parametros', 'resting heart rate']) {
    assert.match(harmless, SPEC_REGEX, harmless);
  }
});

test('renderAdvice returns null for a null advice and tolerates an unknown locale by using en', () => {
  assert.equal(renderAdvice(null, 'en'), null);
  assert.equal(render('below', 'fr'), APPROVED.en.below);
});

test('advice thresholds are the load band edges: ramping/easing flip exactly where trendBand does', () => {
  for (let pct = -60; pct <= 60; pct++) {
    const ramping = advise({ recovery: rec(0.7), load: load(mod('run', pct)) }).key === 'aboveRamping';
    const easing = advise({ recovery: rec(0.7), load: load(mod('run', pct)) }).key === 'aboveEasing';
    assert.equal(ramping, trendBand(pct) === 'ramping', `ramping ${pct}`);
    assert.equal(ramping, pct >= RAMPING_PCT);
    assert.equal(easing, pct <= EASING_PCT && !ramping, `easing ${pct}`);
    assert.equal(easing, ['below', 'wellBelow'].includes(trendBand(pct)), `easing band ${pct}`);
  }
});
