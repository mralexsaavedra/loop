/* Inicio day stepping ("‹ TODAY ›"): what the dials and the monitor tiles said on each of the last
 * DAY_HISTORY_DAYS days, so the page can show a PAST day without scoring anything in the browser.
 *
 * Per day t (the newest overnight data date and the days before it): the inputs are cut at t (every
 * row dated after t is dropped) and the SAME scorers run on them as for today — recovery.mjs
 * recoveryFromInputs (the composite, its % rank among the 90 days before t, the bands) and
 * monitor.mjs monitorFromInputs (each card's value vs its own 42-day band). Day t = asOf therefore
 * reproduces today's bake exactly. A past day keeps only what is dated THAT day:
 *   - rec: the night scored as "last night" on t, only when that night IS t (a fallback to an older
 *     complete night is that older day's own entry); 'gated' when the recovery block was gated on t
 *     (too little baseline yet); null otherwise (no complete night on t).
 *   - sleep: t's asleep hours (the recovery sleep-duration input, the number the sleep dial uses);
 *     null when t has none or recovery was gated (the sleep dial reads the same component).
 *   - monitor: the summary tile on t: cards in range / out of range among the cards fresh on t (own
 *     date <= STALE_DAYS before t) out of all cards, and the HRV card when fresh on t.
 * The load dial needs nothing new (load.mjs `recent` already bakes RECENT_DAYS of session days) and
 * neither does "My day" (a past day reads DETAIL.sessions and DETAIL.metrics.sleep, the same display rule).
 * Only data dates are baked (no build-time "now"), so builds stay byte-identical. */
import { addDays, dayDiff } from '../date.mjs';
import { recoveryFromInputs } from './recovery.mjs';
import { monitorFromInputs } from './monitor.mjs';
import { RECENT_DAYS } from './load.mjs';
import { STALE_DAYS } from '../stale.mjs';

// The history the "‹" chevron can reach: the load dial's baked session days (RECENT_DAYS = 14), so
// every dial has data for every reachable day. Two weeks of compact entries cost a few KB.
export const DAY_HISTORY_DAYS = RECENT_DAYS;

const upTo = (rows, t) => (Array.isArray(rows) ? rows.filter((r) => r && r.date && r.date <= t) : null);

function recOf(R, t) {
  if (!R || !R.asOf) return null;
  if (R.gated) return 'gated';
  const n = R.today;
  if (!n || n.date !== t) return null;
  const out = { value: n.value, band: n.band, sleep: n.sleep };
  if (n.pct != null) Object.assign(out, { pct: n.pct, pctBand: n.pctBand });
  return out;
}

function sleepOf(R, t) {
  const c = R && !R.gated && Array.isArray(R.components) ? R.components.find((x) => x.key === 'sleepDur') : null;
  const last = c && c.daily && c.daily.length ? c.daily[c.daily.length - 1] : null;
  return last && last.date === t ? last.value : null;
}

function monitorOf(M, t) {
  const fresh = M.cards.filter((c) => c.state === 'ok' && dayDiff(c.date, t) <= STALE_DAYS);
  const hrv = fresh.find((c) => c.key === 'hrv');
  return {
    inR: fresh.filter((c) => c.status === 'normal').length,
    out: fresh.filter((c) => c.status === 'high' || c.status === 'low').length,
    total: M.cards.length,
    hrv: hrv ? { value: hrv.value, dec: hrv.dec, status: hrv.status, tone: hrv.tone, date: hrv.date } : null,
  };
}

/** {hrv, rhr, sleep, respiratory, wristTemp} row arrays (any may be absent) -> null | {from, to,
 * days: [{date, sleep, rec, monitor}]} for the DAY_HISTORY_DAYS days ending at the newest date. */
export function daysFromInputs(I = {}) {
  const dates = ['hrv', 'rhr', 'sleep'].flatMap((k) => (Array.isArray(I[k]) ? I[k].map((r) => r && r.date) : [])).filter(Boolean).sort();
  if (!dates.length) return null;
  const to = dates[dates.length - 1];
  const from = addDays(to, -(DAY_HISTORY_DAYS - 1));
  const days = [];
  for (let t = from; t <= to; t = addDays(t, 1)) {
    const cut = (k) => upTo(I[k], t);
    const sleep = cut('sleep');
    const R = recoveryFromInputs({ hrv: cut('hrv') || [], rhr: cut('rhr') || [], sleep: sleep || [] });
    const M = monitorFromInputs({
      respiratory: cut('respiratory'), rhr: cut('rhr'), hrv: cut('hrv'), wristTemp: cut('wristTemp'),
      sleep: sleep && sleep.map((s) => ({ date: s.date, value: s.value })),
    });
    days.push({ date: t, sleep: sleepOf(R, t), rec: recOf(R, t), monitor: monitorOf(M, t) });
  }
  return { from, to, days };
}

/** The pure core over lib/extract/read.mjs readExtract inputs (lib/score/index.mjs buildScoresFrom).
 * @param {{series?: Record<string, any>, sleep?: any}} [inputs] */
export function daysFrom({ series = {}, sleep = null } = {}) {
  return daysFromInputs({ hrv: series.hrv, rhr: series.rhr, sleep, respiratory: series.respiratory, wristTemp: series.wristTemp });
}
