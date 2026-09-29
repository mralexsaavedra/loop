/* Advice sentences (es + en) and their renderer. Descriptive only: every sentence states what
 * the inputs are, never what to do (no instruction, no medical claim). The client renders the baked
 * {key, vars, inputs} with these same templates, so this file is the single source of the copy.
 * Any wording change must update the approved snapshot in advice.test.mjs on purpose. */

export const ADVICE_COPY = {
  en: {
    aboveRamping: 'Recovery is {trend7Abs} MAD above your 42-day baseline and {modality} load is {trendPct} vs its 6-week average, so the ramp is landing on good recovery.',
    aboveEasing: 'Recovery is {trend7Abs} MAD above your 42-day baseline while {modality} load is {trendPct} vs its 6-week average.',
    above: 'Recovery is {trend7Abs} MAD above your 42-day baseline (7-day trend, {delta7} vs a week earlier).',
    atBaselineRamping: 'Recovery is at baseline ({trend7} MAD) while {modality} load is {trendPct} vs its 6-week average.',
    atBaseline: 'Recovery is at baseline ({trend7} MAD over 7 days, {delta7} vs a week earlier).',
    belowRamping: 'Recovery is {trend7Abs} MAD below your 42-day baseline while {modality} load is {trendPct} vs its 6-week average.',
    below: 'Recovery is {trend7Abs} MAD below your 42-day baseline (7-day trend, {delta7} vs a week earlier).',
    trendBuilding: 'Recovery trend is {trend7} MAD vs your 42-day baseline; load trends are still building (they need 4+ weeks of Relative Effort and 8+ active days per modality).',
  },
  es: {
    aboveRamping: 'La recuperación está {trend7Abs} MAD por encima de tu línea base de 42 días y la carga de {modality} es {trendPct} frente a su media de 6 semanas: la subida de carga llega con buena recuperación.',
    aboveEasing: 'La recuperación está {trend7Abs} MAD por encima de tu línea base de 42 días mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.',
    above: 'La recuperación está {trend7Abs} MAD por encima de tu línea base de 42 días (tendencia de 7 días, {delta7} frente a la semana anterior).',
    atBaselineRamping: 'La recuperación está en su línea base ({trend7} MAD) mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.',
    atBaseline: 'La recuperación está en su línea base ({trend7} MAD en 7 días, {delta7} frente a la semana anterior).',
    belowRamping: 'La recuperación está {trend7Abs} MAD por debajo de tu línea base de 42 días mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.',
    below: 'La recuperación está {trend7Abs} MAD por debajo de tu línea base de 42 días (tendencia de 7 días, {delta7} frente a la semana anterior).',
    trendBuilding: 'La tendencia de recuperación es {trend7} MAD frente a tu línea base de 42 días; las tendencias de carga aún se están formando (necesitan 4+ semanas de Esfuerzo Relativo y 8+ días activos por modalidad).',
  },
};

const MODALITY = {
  en: { gym: 'gym', run: 'run', bike: 'bike' },
  es: { gym: 'gimnasio', run: 'carrera', bike: 'bici' },
};

// signed with one decimal; a value that rounds to zero carries no sign
function num(x, dec, locale, signed) {
  let s = Number(x).toFixed(dec);
  if (Number(s) === 0) s = (0).toFixed(dec);
  else if (signed && Number(s) > 0) s = '+' + s;
  return locale === 'es' ? s.replace('.', ',') : s;
}

/** {key, vars} -> one sentence in `locale` (unknown locales fall back to en). null in, null out. */
export function renderAdvice(advice, locale = 'en') {
  if (!advice) return null;
  const loc = ADVICE_COPY[locale] ? locale : 'en';
  const v = advice.vars || {};
  const pct = v.trendPct == null ? '' : num(v.trendPct, 0, loc, true) + (loc === 'es' ? ' %' : '%');
  const fill = {
    trend7: v.trend7 == null ? '' : num(v.trend7, 1, loc, true),
    trend7Abs: v.trend7 == null ? '' : num(Math.abs(v.trend7), 1, loc, false),
    delta7: v.delta7 == null ? '' : num(v.delta7, 1, loc, true),
    trendPct: pct,
    modality: MODALITY[loc][v.modality] || v.modality || '',
  };
  return ADVICE_COPY[loc][advice.key].replace(/\{(\w+)\}/g, (_, k) => (k in fill ? fill[k] : ''));
}
