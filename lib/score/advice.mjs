/* Rule-based, deterministic, descriptive advice. First match wins. Evaluated only
 * when the recovery card passed its gates and a load block exists; otherwise null (no advice for
 * insufficient data, and the client suppresses it when stale). There is no `noRecovery` rule.
 *
 * `trendBuilding` is listed FIRST, not last: when no modality trend
 * is ok, the load-dependent rules (aboveRamping, aboveEasing, atBaselineRamping, belowRamping)
 * cannot fire, and were it last the recovery-only fallbacks (above, atBaseline, below) would always shadow it, making it unreachable. */
import { RAMPING_PCT, EASING_PCT } from './training-load.mjs';

/** What a rule reads: the baked recovery band and the highest ok modality trendPct.
 * @typedef {{band: string | null, any: number | null}} AdviceCtx */
/** @typedef {{key: string, when: (c: AdviceCtx) => boolean}} AdviceRule */
/** The recovery block fields the advice reads (recovery.mjs recoveryFromInputs).
 * @typedef {{gated?: boolean, band: string | null, trend7: number | null, delta7?: number | null,
 *   driver?: string | null, asOf?: string | null}} AdviceRecovery */
/** One load modality as the advice reads it (training-load.mjs loadFromSeries).
 * @typedef {{key: string, trend: {ok: boolean, trendPct: number | null}}} AdviceModality */

/** @param {AdviceCtx} c */
const has = (c) => c.any != null;

// `any` is a number in the load rules: trendBuilding (first) catches a null one
/** @type {AdviceRule[]} */
export const RULES = [
  { key: 'trendBuilding', when: (c) => !has(c) },
  { key: 'aboveRamping', when: (c) => c.band === 'above' && /** @type {number} */ (c.any) >= RAMPING_PCT },
  { key: 'aboveEasing', when: (c) => c.band === 'above' && /** @type {number} */ (c.any) <= EASING_PCT },
  { key: 'above', when: (c) => c.band === 'above' },
  { key: 'atBaselineRamping', when: (c) => c.band === 'at' && /** @type {number} */ (c.any) >= RAMPING_PCT },
  { key: 'atBaseline', when: (c) => c.band === 'at' },
  { key: 'belowRamping', when: (c) => c.band === 'below' && /** @type {number} */ (c.any) >= RAMPING_PCT },
  { key: 'below', when: (c) => c.band === 'below' },
];

const USES_LOAD = new Set(['aboveRamping', 'aboveEasing', 'atBaselineRamping', 'belowRamping']);

/** ctx: {recovery, load} (the baked blocks) -> {key, vars, inputs} | null
 * @param {{recovery?: AdviceRecovery | null, load?: {modalities: (AdviceModality | null)[]} | null} | null} [ctx] */
export function advise(ctx = {}) {
  const { recovery, load } = ctx || {};
  if (!recovery || recovery.gated || recovery.trend7 == null || !load || !Array.isArray(load.modalities)) return null;

  // trendPct_any = the highest trendPct among modalities whose trend is ok (ties: first listed)
  /** @type {AdviceModality | null} */
  let top = null;
  for (const m of load.modalities) {
    if (m && m.trend && m.trend.ok && (top == null || /** @type {number} */ (m.trend.trendPct) > /** @type {number} */ (top.trend.trendPct))) top = m;
  }
  // the baked band (lib/score/recovery.mjs shownBand: the band of the trend7 shown), never recomputed here
  /** @type {AdviceCtx} */
  const c = { band: recovery.band, any: top ? top.trend.trendPct : null };
  const rule = RULES.find((r) => r.when(c));
  if (!rule) return null;

  /** @type {{id: string, value: number | null}[]} */
  const inputs = [{ id: 'recovery.trend7', value: recovery.trend7 }];
  // a load rule only fires when a modality trend is ok, so `top` is set there
  if (USES_LOAD.has(rule.key)) inputs.push({ id: `load.${/** @type {AdviceModality} */ (top).key}.trendPct`, value: /** @type {AdviceModality} */ (top).trend.trendPct });
  else if (rule.key !== 'trendBuilding') inputs.push({ id: 'recovery.delta7', value: recovery.delta7 ?? null });

  return {
    key: rule.key,
    vars: {
      trend7: recovery.trend7,
      delta7: recovery.delta7 ?? null,
      driver: recovery.driver ?? null,
      modality: top ? top.key : null,
      trendPct: top ? top.trend.trendPct : null,
      asOf: recovery.asOf ?? null,
    },
    inputs,
  };
}
