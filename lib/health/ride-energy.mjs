/* Power-meter correction of the Watch's active energy on ride days.
 *
 * A ride recorded by a bike computer (Garmin Edge + power meter) and NOT by the Apple Watch is
 * under-counted by the Watch's Active Energy (it only sees wrist motion + heart rate). When the
 * ride carries real power data, its mechanical work is a far better energy estimate:
 *
 *   corrected active(day) = watch active(day) − watch active during the ride + ride energy,
 *   ride energy (kcal)    = Strava kilojoules × KJ_TO_KCAL.
 *
 * Rules (all must hold, else the day keeps the Watch value):
 *   - the ride has kilojoules > 0 AND device_watts === true (a real power meter; Strava's
 *     estimated watts, or an export without the flag, never correct anything);
 *   - the ride has a start stamp WITH a UTC offset and an elapsed time > 0;
 *   - the Watch's hourly buckets cover the whole ride window (no missing hour);
 *   - the day has a Watch daily total, and the corrected value is HIGHER than it (never lowers a
 *     day: a ride the Watch did record already reads at or above the power figure).
 * The ride window is [start, start + elapsed time] (elapsed, not moving time: the Watch energy of
 * a café stop inside the window is replaced too, a small and conservative error). Each hourly
 * bucket spans its local clock hour and is prorated by its overlap with the window; everything is
 * compared as INSTANTS (offsets honoured), so a DST night and the host timezone never matter. A
 * ride crossing midnight splits its energy across the two local days by time. Overlapping power
 * rides (a duplicate upload) count once: the larger kJ wins.
 *
 * Inputs come from three extract CSVs: active-energy-daily.csv (Watch day totals),
 * active-energy-hourly.csv (sync-shortcut, `active_energy_hourly` key) and rides.csv
 * (sync-strava). Every active-energy reader goes through readActiveEnergy, so the Salud card and
 * the detail sheet agree. */
import fs from 'node:fs';
import path from 'node:path';
import { readSeries } from './read.mjs';

// 1 kJ of mechanical work ≈ 1 kcal metabolic: 1 kcal = 4.184 kJ, and cycling's gross efficiency
// is ~24 % (4.184 × 0.24 ≈ 1.0), so the two errors cancel. The usual rule of thumb (Strava,
// TrainingPeaks); a named constant so it is stated, not buried.
export const KJ_TO_KCAL = 1.0;
export const HOURLY_CSV = 'active-energy-hourly.csv';
export const HOURLY_HEADER = 'date,hour_start,kcal,source';
export const RIDES_CSV = 'rides.csv';
export const RIDES_HEADER = 'date,start,elapsed_s,kilojoules,device_watts,source';

const HOUR_MS = 3600000;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/;

/** ISO stamp WITH offset -> { date (local), ms (instant), off (minutes east of UTC) }; null without
 * an offset (a wall clock alone cannot be placed against the hourly buckets). */
export function parseStamp(s) {
  const m = STAMP.exec(String(s || '').trim());
  if (!m) return null;
  const off = m[5] === 'Z' ? 0 : (m[6] === '-' ? -1 : 1) * (+m[7] * 60 + +m[8]);
  const wall = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] || '00'}Z`);
  if (!Number.isFinite(wall)) return null;
  return { date: m[1], ms: wall - off * 60000, off };
}

const offStr = (off) => {
  const a = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const nextDate = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const overlap = (a1, b1, a2, b2) => Math.max(0, Math.min(b1, b2) - Math.max(a1, a2));

// valid power rides as instants, sorted, overlapping duplicates collapsed to the larger kJ
function powerRides(rides) {
  const ok = (rides || []).map((r) => {
    const st = r && parseStamp(r.start);
    if (!st || !(r.kj > 0) || r.deviceWatts !== true || !(r.elapsedS > 0)) return null;
    return { a: st.ms, b: st.ms + r.elapsedS * 1000, off: st.off, date: st.date, kj: r.kj };
  }).filter(Boolean).sort((x, y) => x.a - y.a);
  const kept = [];
  for (const r of ok) {
    const last = kept[kept.length - 1];
    if (last && r.a < last.b) { if (r.kj > last.kj) kept[kept.length - 1] = r; } else kept.push(r);
  }
  return kept;
}

// does the union of the buckets cover [a, b]?
function covered(buckets, a, b) {
  let t = a;
  for (const k of buckets) { // sorted by start
    if (k.a > t) break;
    if (k.b > t) t = k.b;
    if (t >= b) return true;
  }
  return t >= b;
}

/** Watch daily totals [{date, value}] + Watch hourly buckets [{start, kcal}] + rides
 * [{start, elapsedS, kj, deviceWatts}] -> the daily rows, corrected days carrying
 * { value (rounded corrected kcal), watch, rideKcal, watchDuring }; other rows unchanged. */
export function correctActiveEnergy(daily, hourly, rides) {
  if (!daily) return null;
  const buckets = (hourly || []).map((h) => {
    const st = h && parseStamp(h.start);
    return st && Number.isFinite(h.kcal) ? { a: st.ms, b: st.ms + HOUR_MS, date: st.date, kcal: h.kcal } : null;
  }).filter(Boolean).sort((x, y) => x.a - y.a);
  const adj = new Map(); // date -> { ride, during }
  for (const r of powerRides(rides)) {
    if (!covered(buckets, r.a, r.b)) continue;
    // split by local day (the ride's own offset)
    for (let d = r.date; ; d = nextDate(d)) {
      const d0 = Date.parse(`${d}T00:00:00${offStr(r.off)}`), d1 = Date.parse(`${nextDate(d)}T00:00:00${offStr(r.off)}`);
      if (d0 >= r.b) break;
      const o = overlap(r.a, r.b, d0, d1);
      if (o > 0) {
        const during = buckets.filter((k) => k.date === d).reduce((s, k) => s + k.kcal * overlap(k.a, k.b, r.a, r.b) / HOUR_MS, 0);
        const cur = adj.get(d) || { ride: 0, during: 0 };
        adj.set(d, { ride: cur.ride + r.kj * KJ_TO_KCAL * o / (r.b - r.a), during: cur.during + during });
      }
    }
  }
  if (!adj.size) return daily;
  return daily.map((row) => {
    const a = adj.get(row.date);
    if (!a || !Number.isFinite(row.value)) return row;
    const value = Math.round(row.value - a.during + a.ride);
    if (!(value > row.value)) return row;
    return { ...row, value, watch: row.value, rideKcal: Math.round(a.ride), watchDuring: Math.round(a.during) };
  });
}

function readCsv(extractDir, name) {
  const p = path.join(extractDir, name);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
}
const numOrNull = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/** The active energy every reader uses: active-energy-daily.csv corrected by the power rides;
 * null when the daily file is absent. Missing hourly / rides files -> the Watch values. */
export function readActiveEnergy(extractDir) {
  if (!extractDir) return null;
  const daily = readSeries(extractDir, 'active-energy-daily.csv');
  if (!daily) return null;
  const hourly = readCsv(extractDir, HOURLY_CSV).map((c) => ({ start: c[1], kcal: numOrNull(c[2]) }));
  const rides = readCsv(extractDir, RIDES_CSV).map((c) => ({
    start: c[1], elapsedS: numOrNull(c[2]), kj: numOrNull(c[3]),
    deviceWatts: c[4] === 'true' ? true : c[4] === 'false' ? false : null,
  }));
  return correctActiveEnergy(daily, hourly, rides);
}
