/* Shared Apple Health sample helpers — the single definition of how a sample becomes a CSV
 * row. Used by extract.js (export.xml) AND sync-shortcut.js (iOS Shortcut payloads), so rows
 * from either source are indistinguishable. Pure, zero deps.
 *
 * Timestamps use the export format "YYYY-MM-DD HH:MM:SS +ZZZZ" (LOCAL wall clock + offset).
 * Dates and clock hours are read from the local part; durations/ordering use the offset.
 */

const READING_HEADER = 'date,value,source';
const SLEEP_HEADER = 'date,asleep_hours,source,bedtime,waketime';
// workouts.csv, written by BOTH extract.js and sync-strava.js. relative_effort / kilojoules /
// elevation_m are filled only by Strava rows; Apple export rows leave the three trailing columns
// empty. Readers are POSITIONAL and must tolerate shorter (older, 9- or 11-column) rows.
const WORKOUTS_HEADER = 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m';

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
// Sleeping wrist temperature is one sample per night that starts when sleep starts (23:xx or
// 00:xx): dated by the same wake-up night as sleep-daily.csv, so both describe the same night.
const wristTempDate = start => sleepNight(start);

// total minutes covered by the union of intervals [{start, end}] (overlaps counted once)
function unionMinutes(intervals) {
  const iv = intervals.map(i => [absMs(i.start), absMs(i.end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, curA = null, curB = null;
  for (const [a, b] of iv) {
    if (curB == null || a > curB) { if (curB != null) total += curB - curA; curA = a; curB = b; }
    else if (b > curB) curB = b;
  }
  if (curB != null) total += curB - curA;
  return total / 60000;
}

/* ---- sleep nights: main sleep vs naps ----------------------------------------------------
 * Asleep segments of ONE source are chained into BLOCKS (a gap under BLOCK_GAP_MIN = a brief
 * awakening inside the same sleep). Each block is dated by its MIDPOINT with the 18:00 roll-over
 * (so a nap that crosses 18:00 is never split across two nights). A block whose midpoint falls in
 * the plausible main-sleep window of its night (MAIN_FROM_HOUR the evening before .. MAIN_TO_HOUR
 * on the wake-up day) can be main sleep: the longest such block is the ANCHOR, and other in-window
 * blocks within SPLIT_GAP_MIN of it join the night (a split night with a long 3 am wake-up stays
 * one night). Everything else is a NAP and adds neither minutes nor bed/wake times; a day with
 * only naps has no night row. Across sources the one with the most main-sleep minutes wins (the
 * max-across-sources rule that avoids a cross-device double count). */
const BLOCK_GAP_MIN = 60; // longer awake gaps start a new block
const SPLIT_GAP_MIN = 180; // an awake stretch this long mid-night still belongs to the night
const MAIN_FROM_HOUR = 20; // evening before the wake-up date
const MAIN_TO_HOUR = 12; // wake-up date
const MIN_MS = 60000;

function sleepBlocks(segs) {
  const sorted = segs.slice().sort((a, b) => absMs(a.start) - absMs(b.start) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const blocks = [];
  let cur = null;
  for (const sg of sorted) {
    const a = absMs(sg.start), b = absMs(sg.end);
    if (cur && a - cur.b < BLOCK_GAP_MIN * MIN_MS) {
      cur.segs.push(sg);
      if (b > cur.b) { cur.b = b; cur.end = sg.end; }
    } else {
      cur = { segs: [sg], a, b, start: sg.start, end: sg.end };
      blocks.push(cur);
    }
  }
  for (const bl of blocks) {
    const mid = (localMs(bl.start) + localMs(bl.end)) / 2;
    const midIso = new Date(mid).toISOString(); // wall clock read as UTC
    const date = midIso.slice(0, 10), hour = +midIso.slice(11, 13);
    bl.night = hour >= 18 ? addDay(date) : date;
    const prev = new Date(bl.night + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1);
    const from = Date.parse(prev.toISOString().slice(0, 10) + `T${String(MAIN_FROM_HOUR).padStart(2, '0')}:00:00Z`);
    const to = Date.parse(bl.night + `T${String(MAIN_TO_HOUR).padStart(2, '0')}:00:00Z`);
    bl.main = mid >= from && mid <= to;
    bl.minutes = unionMinutes(bl.segs);
  }
  return blocks;
}

// one source's blocks of one night -> {minutes, ck} of the main sleep, or null (naps only)
function mainSleep(blocks) {
  const cand = blocks.filter(b => b.main);
  if (!cand.length) return null;
  const anchor = cand.reduce((x, y) => (y.minutes > x.minutes ? y : x));
  const kept = [anchor];
  let a = anchor.a, b = anchor.b, grew = true;
  while (grew) {
    grew = false;
    for (const bl of cand) {
      if (kept.includes(bl)) continue;
      if (Math.max(bl.a - b, a - bl.b) <= SPLIT_GAP_MIN * MIN_MS) {
        kept.push(bl); a = Math.min(a, bl.a); b = Math.max(b, bl.b); grew = true;
      }
    }
  }
  const segs = kept.flatMap(bl => bl.segs);
  const ck = { start: kept[0].start, end: kept[0].end };
  for (const bl of kept) {
    if (bl.a < absMs(ck.start)) ck.start = bl.start;
    if (bl.b > absMs(ck.end)) ck.end = bl.end;
  }
  return { minutes: unionMinutes(segs), ck };
}

/** Asleep segments [{start, end, source}] (export stamps) -> one main-sleep night per wake-up date,
 * [{date, minutes, source, ck: {start, end}}] sorted by date. Shared by extract.js and
 * sync-shortcut.js, so both write identical sleep-daily.csv rows for the same segments. */
function sleepNights(segments) {
  const bySrc = new Map();
  for (const sg of segments || []) {
    if (!sg || !sg.start || !sg.end || !(minutesBetween(sg.start, sg.end) > 0)) continue;
    const k = sg.source || '';
    if (!bySrc.has(k)) bySrc.set(k, []);
    bySrc.get(k).push(sg);
  }
  const best = new Map(); // night -> {minutes, source, ck}
  for (const [source, segs] of bySrc) {
    const byNight = new Map();
    for (const bl of sleepBlocks(segs)) {
      if (!byNight.has(bl.night)) byNight.set(bl.night, []);
      byNight.get(bl.night).push(bl);
    }
    for (const [night, blocks] of byNight) {
      const m = mainSleep(blocks);
      if (!m) continue;
      const cur = best.get(night);
      if (!cur || m.minutes > cur.minutes) best.set(night, { minutes: m.minutes, source, ck: m.ck });
    }
  }
  return [...best.keys()].sort().map(date => ({ date, ...best.get(date) }));
}

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

// one parsed Apple workout -> workouts.csv row (12 columns; the three Strava-only columns stay empty)
const workoutRow = w => {
  const bpm = v => (v != null ? Math.round(v) : '');
  const km2 = v => (v != null ? Math.round(v * 100) / 100 : '');
  return `${w.date},${w.type},${w.durationMin ?? ''},${w.energyKcal ?? ''},${bpm(w.hrAvg)},${bpm(w.hrMin)},${bpm(w.hrMax)},${w.source || ''},${km2(w.distanceKm)},,,`;
};

module.exports = {
  READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER, workoutRow,
  day, num, localMs, absMs, minutesBetween, addDay, clockHour, sleepNight, wristTempDate, isoToExportStamp,
  readingRow, sleepRow, unionMinutes, sleepNights,
};
