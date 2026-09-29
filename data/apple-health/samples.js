/* Shared Apple Health sample helpers — the single definition of how a sample becomes a CSV
 * row. Used by extract.js (export.xml) AND sync-shortcut.js (iOS Shortcut payloads), so rows
 * from either source are indistinguishable. Pure, zero deps.
 *
 * Timestamps use the export format "YYYY-MM-DD HH:MM:SS +ZZZZ" (LOCAL wall clock + offset).
 * Dates and clock hours are read from the local part; durations/ordering use the offset.
 */

const READING_HEADER = 'date,value,source';
const SLEEP_HEADER = 'date,asleep_hours,source,bedtime,waketime';
// workouts.csv, written by BOTH extract.js and sync-strava.js. relative_effort / kilojoules are
// filled only by Strava rows; Apple export rows leave the two trailing columns empty.
const WORKOUTS_HEADER = 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules';

// "2026-06-12 09:10:00 +0200" -> "2026-06-12"
const day = dt => (dt || '').slice(0, 10);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// epoch ms of the WALL CLOCK, read as UTC (offset ignored; host-timezone independent)
const localMs = dt => Date.parse(dt.slice(0, 19).replace(' ', 'T') + 'Z');
// epoch ms of the real INSTANT: honours the "+ZZZZ" offset (correct across DST changes);
// falls back to the wall clock when a stamp has no offset
const absMs = dt => {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(dt.trim().slice(19));
  if (!m) return localMs(dt);
  const off = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
  return localMs(dt) - off * 60000;
};
// minutes between two export stamps — real elapsed time (a DST fall-back night is 1 h longer)
const minutesBetween = (start, end) => (absMs(end) - absMs(start)) / 60000;
// add one calendar day to "YYYY-MM-DD" (UTC math -> no host-tz drift)
const addDay = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
// local clock as a decimal hour -> e.g. 23:30 -> 23.5
const clockHour = dt => +(+dt.slice(11, 13) + (+dt.slice(14, 16)) / 60).toFixed(2);
// a sleep segment belongs to the WAKE-UP date: starts at/after 18:00 roll to the next day,
// so an evening->morning night is never split across two rows
const sleepNight = start => (+start.slice(11, 13) >= 18 ? addDay(day(start)) : day(start));

// ISO-8601 with offset ("2026-09-28T08:53:09+02:00" / "...Z") -> export stamp, keeping the
// local wall clock. Returns null when the string is not a timestamp.
function isoToExportStamp(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const off = m[4] === 'Z' ? '+0000' : m[4].replace(':', '');
  return `${m[1]} ${m[2]}${m[3] || ':00'} ${off}`;
}

const readingRow = r => `${r.date},${r.value},${r.source || ''}`;
// minutes asleep + clock {start, end} (earliest asleep start / latest asleep end) -> CSV row
const sleepRow = (date, minutes, source, ck) =>
  `${date},${(minutes / 60).toFixed(2)},${source || ''},${ck ? clockHour(ck.start) : ''},${ck ? clockHour(ck.end) : ''}`;

// one parsed Apple workout -> workouts.csv row (11 columns; the two effort columns stay empty)
const workoutRow = w => {
  const bpm = v => (v != null ? Math.round(v) : '');
  const km2 = v => (v != null ? Math.round(v * 100) / 100 : '');
  return `${w.date},${w.type},${w.durationMin ?? ''},${w.energyKcal ?? ''},${bpm(w.hrAvg)},${bpm(w.hrMin)},${bpm(w.hrMax)},${w.source || ''},${km2(w.distanceKm)},,`;
};

module.exports = {
  READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER, workoutRow,
  day, num, localMs, absMs, minutesBetween, addDay, clockHour, sleepNight, isoToExportStamp,
  readingRow, sleepRow,
};
