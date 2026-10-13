/* Sleep scores for the Inicio sleep dial and the sleep deep-dive — every number from sleep-daily.csv,
 * no invented adaptive need:
 *   - performance % = asleep hours / need × 100, rounded, capped at 100. Our need = the stated sleep
 *     target (SLEEP_TARGET, 7.5 h, the same target as the dial's ring and Tonight's bedtime); it does
 *     not grow with strain or sleep debt.
 *   - efficiency % = asleep / in bed × 100, capped at 100; only when the night has inbed_h (rows
 *     written before the stage columns existed have none → null, the row is hidden).
 *   - consistency = recovery.mjs sleepConsistency, in MINUTES (mean deviation of bedtime and wake from
 *     their 42-night medians). No documented minutes → % mapping exists, so it stays in minutes.
 *   - stage shares = REM / deep / core as % of asleep; restorative = REM + deep hours; both only on a
 *     staged night (rem/deep/core known).
 * Only the data's own dates are baked (no build-time "now"), so builds stay byte-identical. */
import { sleepConsistency } from './recovery.mjs';

/** The stated sleep target in hours (Salud's sleep card, the sleep dial, Tonight's bedtime, the sleep
 * scores). Defined here, not in lib/health/aggregate.mjs (which re-exports it): aggregate imports this
 * module, so importing it back would be an ESM cycle. */
export const SLEEP_TARGET = 7.5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const pct = (num, den) => Math.min(100, Math.round((100 * num) / den));

export function sleepPerformance(hours, need) {
  return isNum(hours) && hours >= 0 && isNum(need) && need > 0 ? pct(hours, need) : null;
}

export function sleepEfficiency(hours, inbed) {
  return isNum(hours) && hours >= 0 && isNum(inbed) && inbed > 0 ? pct(hours, inbed) : null;
}

const staged = (r) => !!r && isNum(r.rem) && isNum(r.deep) && isNum(r.core);

/** readSleep() row -> {rem, deep, core} % of the asleep hours, or null (unstaged / no sleep). */
export function stageShares(r) {
  if (!staged(r) || !isNum(r.value) || !(r.value > 0)) return null;
  const of = (h) => Math.round((100 * h) / r.value);
  return { rem: of(r.rem), deep: of(r.deep), core: of(r.core) };
}

function stagesOf(r) {
  if (!staged(r)) return null;
  const o = {};
  for (const k of ['rem', 'deep', 'core', 'unspec', 'awake', 'inbed']) o[k] = isNum(r[k]) ? r[k] : null;
  return o;
}

/** rows: readSleep() rows, need: hours -> null | {need, last: {date, hours, perf, eff, cons, stages,
 * shares, restorative}}. `last` = the newest night with asleep hours. */
export function sleepFromInputs(rows, need = SLEEP_TARGET) {
  const ok = (rows || []).filter((r) => r && r.date && isNum(r.value)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!ok.length || !(isNum(need) && need > 0)) return null;
  const r = ok[ok.length - 1];
  const cons = sleepConsistency(ok).find((c) => c.date === r.date);
  return {
    need,
    last: {
      date: r.date,
      hours: r2(r.value),
      perf: sleepPerformance(r.value, need),
      eff: sleepEfficiency(r.value, r.inbed),
      cons: cons ? Math.round(cons.value) : null,
      stages: stagesOf(r),
      shares: stageShares(r),
      restorative: staged(r) ? r2(r.rem + r.deep) : null,
    },
  };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom). */
export function sleepScoreFrom({ sleep } = {}, need = SLEEP_TARGET) {
  return sleepFromInputs(sleep, need);
}
