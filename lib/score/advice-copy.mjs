/* Advice sentences (es + en) and their renderer. Descriptive only: every sentence states what
 * the inputs are, never what to do (no instruction, no medical claim). The client renders the baked
 * {key, vars, inputs} with these same templates, so this file is the single source of the copy.
 * Any wording change must update the approved snapshot in advice.test.mjs on purpose.
 * Today first: the dials above lead with last night, so every sentence names its window ("over the
 * last 7 days") and reads as the trend context under that headline, never as last night itself. */

// The ONE unit of the recovery composite: units of the owner's own typical day-to-day variation (a
// robust spread, scaled MAD, of the last 42 days). The advice, the dials, the Salud card and the
// detail sheet all build their copy from it (web/src/i18n/score-templates.mjs re-exports it).
import { fmtNumber, fmtPercent } from '../format/numbers.mjs';
export const RECOVERY_UNIT = Object.freeze({ en: 'SD', es: 'desv.' });

export const ADVICE_COPY = {
  en: {
    aboveRamping: `Over the last 7 days recovery has averaged {trend7Abs} ${RECOVERY_UNIT.en} above your 42-day baseline and {modality} load is {trendPct} vs its 6-week average, so the ramp is landing on good recovery.`,
    aboveEasing: `Over the last 7 days recovery has averaged {trend7Abs} ${RECOVERY_UNIT.en} above your 42-day baseline while {modality} load is {trendPct} vs its 6-week average.`,
    above: `Over the last 7 days recovery has averaged {trend7Abs} ${RECOVERY_UNIT.en} above your 42-day baseline ({delta7} vs the week before).`,
    atBaselineRamping: `Over the last 7 days recovery has stayed at baseline ({trend7} ${RECOVERY_UNIT.en}) while {modality} load is {trendPct} vs its 6-week average.`,
    atBaseline: `Over the last 7 days recovery has stayed at baseline ({trend7} ${RECOVERY_UNIT.en}, {delta7} vs the week before).`,
    belowRamping: `Over the last 7 days recovery has averaged {trend7Abs} ${RECOVERY_UNIT.en} below your 42-day baseline while {modality} load is {trendPct} vs its 6-week average.`,
    below: `Over the last 7 days recovery has averaged {trend7Abs} ${RECOVERY_UNIT.en} below your 42-day baseline ({delta7} vs the week before).`,
    trendBuilding: `Over the last 7 days recovery has averaged {trend7} ${RECOVERY_UNIT.en} vs your 42-day baseline; load trends are still building (they need 4+ weeks of Relative Effort and 8+ active days per modality).`,
  },
  es: {
    aboveRamping: `En los últimos 7 días la recuperación ha promediado {trend7Abs} ${RECOVERY_UNIT.es} por encima de tu línea base de 42 días y la carga de {modality} es {trendPct} frente a su media de 6 semanas: la subida de carga llega con buena recuperación.`,
    aboveEasing: `En los últimos 7 días la recuperación ha promediado {trend7Abs} ${RECOVERY_UNIT.es} por encima de tu línea base de 42 días mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.`,
    above: `En los últimos 7 días la recuperación ha promediado {trend7Abs} ${RECOVERY_UNIT.es} por encima de tu línea base de 42 días ({delta7} frente a la semana anterior).`,
    atBaselineRamping: `En los últimos 7 días la recuperación se ha mantenido en su línea base ({trend7} ${RECOVERY_UNIT.es}) mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.`,
    atBaseline: `En los últimos 7 días la recuperación se ha mantenido en su línea base ({trend7} ${RECOVERY_UNIT.es}, {delta7} frente a la semana anterior).`,
    belowRamping: `En los últimos 7 días la recuperación ha promediado {trend7Abs} ${RECOVERY_UNIT.es} por debajo de tu línea base de 42 días mientras la carga de {modality} es {trendPct} frente a su media de 6 semanas.`,
    below: `En los últimos 7 días la recuperación ha promediado {trend7Abs} ${RECOVERY_UNIT.es} por debajo de tu línea base de 42 días ({delta7} frente a la semana anterior).`,
    trendBuilding: `En los últimos 7 días la recuperación ha promediado {trend7} ${RECOVERY_UNIT.es} frente a tu línea base de 42 días; las tendencias de carga aún se están formando (necesitan 4+ semanas de Esfuerzo Relativo y 8+ días activos por modalidad).`,
  },
};

const MODALITY = {
  en: { gym: 'gym', run: 'run', bike: 'bike' },
  es: { gym: 'gimnasio', run: 'carrera', bike: 'bici' },
};

/** {key, vars} -> one sentence in `locale` (unknown locales fall back to en). null in, null out. */
export function renderAdvice(advice, locale = 'en') {
  if (!advice) return null;
  const loc = ADVICE_COPY[locale] ? locale : 'en';
  const v = advice.vars || {};
  const pct = v.trendPct == null ? '' : fmtPercent(v.trendPct, loc, true);
  const fill = {
    trend7: v.trend7 == null ? '' : fmtNumber(v.trend7, 1, loc, true),
    trend7Abs: v.trend7 == null ? '' : fmtNumber(Math.abs(v.trend7), 1, loc, false),
    delta7: v.delta7 == null ? '' : fmtNumber(v.delta7, 1, loc, true),
    trendPct: pct,
    modality: MODALITY[loc][v.modality] || v.modality || '',
  };
  return ADVICE_COPY[loc][advice.key].replace(/\{(\w+)\}/g, (_, k) => (k in fill ? fill[k] : ''));
}
