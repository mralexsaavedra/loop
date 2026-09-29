/* Rule-based, deterministic, descriptive advice (spec R4.5). First match wins. Evaluated only
 * when the recovery card passed its gates and a load block exists; otherwise null (no advice for
 * insufficient data, and the client suppresses it when stale). There is no `noRecovery` rule.
 *
 * `trendBuilding` is listed FIRST although the design table "appends" it: when no modality trend
 * is ok, the load-dependent rules (1, 2, 4, 6) cannot fire, and were it last the recovery-only
 * fallbacks (3, 5, 7) would always shadow it, making it unreachable. */
import { recoveryBand } from './recovery.mjs';

const has = (c) => c.any != null;

export const RULES = [
  { key: 'trendBuilding', when: (c) => !has(c) },
  { key: 'aboveRamping', when: (c) => c.band === 'above' && c.any >= 30 },
  { key: 'aboveEasing', when: (c) => c.band === 'above' && c.any <= -10 },
  { key: 'above', when: (c) => c.band === 'above' },
  { key: 'atBaselineRamping', when: (c) => c.band === 'at' && c.any >= 30 },
  { key: 'atBaseline', when: (c) => c.band === 'at' },
  { key: 'belowRamping', when: (c) => c.band === 'below' && c.any >= 30 },
  { key: 'below', when: (c) => c.band === 'below' },
];

const USES_LOAD = new Set(['aboveRamping', 'aboveEasing', 'atBaselineRamping', 'belowRamping']);

/** ctx: {recovery, load} (the baked blocks) -> {key, vars, inputs} | null */
export function advise(ctx = {}) {
  const { recovery, load } = ctx || {};
  if (!recovery || recovery.gated || recovery.trend7 == null || !load || !Array.isArray(load.modalities)) return null;

  // trendPct_any = the highest trendPct among modalities whose trend is ok (ties: first listed)
  let top = null;
  for (const m of load.modalities) {
    if (m && m.trend && m.trend.ok && (top == null || m.trend.trendPct > top.trend.trendPct)) top = m;
  }
  const c = { band: recoveryBand(recovery.trend7), any: top ? top.trend.trendPct : null };
  const rule = RULES.find((r) => r.when(c));
  if (!rule) return null;

  const inputs = [{ id: 'recovery.trend7', value: recovery.trend7 }];
  if (USES_LOAD.has(rule.key)) inputs.push({ id: `load.${top.key}.trendPct`, value: top.trend.trendPct });
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
