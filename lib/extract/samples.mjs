/* Shared Apple Health sample helpers — the single definition of how a sample becomes a CSV
 * row. Used by data/apple-health/extract.mjs (export.xml) AND data/apple-health/sync-shortcut.mjs (iOS
 * Shortcut payloads), so rows from either source are indistinguishable. Pure.
 *
 * Timestamps use the export format "YYYY-MM-DD HH:MM:SS +ZZZZ" (LOCAL wall clock + offset).
 * Dates and clock hours are read from the local part; durations/ordering use the offset.
 */
import { addDays } from '../date.mjs';
import { SOURCE_PRECEDENCE } from '../training/sessions.mjs';

const READING_HEADER = 'date,value,source';
// sleep-daily.csv: the first five columns are the original schema (asleep_hours = the union of the
// main sleep's asleep intervals, unchanged); the six stage columns were appended later, so readers
// are POSITIONAL and must tolerate older five-column rows (blank = unknown). See sleepNights.
const SLEEP_HEADER = 'date,asleep_hours,source,bedtime,waketime,rem_h,deep_h,core_h,unspec_h,awake_h,inbed_h';
// Apple export sleep values -> stage keys. Asleep (pre-iOS 16) and AsleepUnspecified = 'unspec'
// (asleep, stage unknown: older Watch data and third-party trackers).
const SLEEP_STAGE_OF = {
  AsleepCore: 'core', AsleepDeep: 'deep', AsleepREM: 'rem', AsleepUnspecified: 'unspec', Asleep: 'unspec',
  Awake: 'awake', InBed: 'inbed',
};
const ASLEEP_STAGES = new Set(['core', 'deep', 'rem', 'unspec']);
const sleepStage = value => SLEEP_STAGE_OF[String(value || '').replace(/^HKCategoryValueSleepAnalysis/, '')] || null;
// a segment without a stage is an asleep one (callers that only pass asleep segments)
const isAsleepSeg = sg => !sg.stage || ASLEEP_STAGES.has(sg.stage);
// workouts.csv, written by BOTH extract.mjs and sync-strava.mjs. relative_effort / kilojoules /
// elevation_m are filled only by Strava rows; Apple export rows leave the three trailing columns
// empty. Readers are POSITIONAL and must tolerate shorter (older, 9- or 11-column) rows.
const WORKOUTS_HEADER = 'date,type,duration_min,energy_kcal,hr_avg,hr_min,hr_max,source,distance_km,relative_effort,kilojoules,elevation_m';

// The Apple Watch source family: lib/training/sessions.mjs SOURCE_PRECEDENCE's own regex ("Apple Watch de
// <name>"; `\s` also matches the no-break space Health writes).
const APPLE_WATCH_RE = SOURCE_PRECEDENCE.find((p) => p.name === 'Apple Watch').re;

// Daily ENERGY (ActiveEnergyBurned / BasalEnergyBurned): per day and type ONE source wins and only
// its sum is used — never a sum across sources (each device / app writes its OWN estimate of the
// same burn). Precedence: 0 = Apple Watch; 1 = a dedicated wrist-wearable app (explicit list below,
// apps that sync a band / watch's own energy); 2 = the iPhone. Everything else is EXCLUDED: scales
// (RENPHO, OKOK, Withings / Health Mate — they write an estimated BMR as basal on weigh-in days;
// Withings is left out because one app serves both its scales and its watches) and training /
// nutrition apps (Hevy, Nike *, Strava, YAZIO, Merge, Training, ROXFIT… — they mirror workout or
// diet estimates). A day with excluded sources only has no row.
const ENERGY_WEARABLES = [
  ['Zepp', /^Zepp\b/i],               // Zepp / Zepp Life (Amazfit, Xiaomi bands)
  ['Mi Fit', /^Mi\s+Fit(ness)?\b/i],  // Mi Fit / Mi Fitness (Xiaomi bands)
  ['Amazfit', /^Amazfit\b/i],
  ['Garmin Connect', /^Garmin\s+Connect\b/i],
  ['Polar Flow', /^Polar\s+Flow\b/i],
  ['Fitbit', /^Fitbit\b/i],
  ['Huawei Health', /^Huawei\s+Health\b/i],
];
const IPHONE_RE = /^iPhone\b/i;
// source name -> { rank, family } | null (excluded)
const energySource = src => {
  const s = (src || '').trim();
  if (APPLE_WATCH_RE.test(s)) return { rank: 0, family: 'Apple Watch' };
  const w = ENERGY_WEARABLES.find(([, re]) => re.test(s));
  if (w) return { rank: 1, family: w[0] };
  if (IPHONE_RE.test(s)) return { rank: 2, family: 'iPhone' };
  return null;
};
// one day's Map<source, kcal sum> -> { family, source, kcal } of the winning source, or null when
// only excluded sources logged. Within one rank (two Watches, Zepp + Mi Fit) the larger total wins,
// then the source name ascending — deterministic, never file order.
const pickEnergySource = bySrc => {
  let best = null;
  for (const [source, kcal] of bySrc) {
    const e = energySource(source);
    if (!e) continue;
    const better = !best || e.rank < best.rank
      || (e.rank === best.rank && (kcal > best.kcal || (kcal === best.kcal && source < best.source)));
    if (better) best = { rank: e.rank, family: e.family, source, kcal };
  }
  return best && { family: best.family, source: best.source, kcal: best.kcal };
};

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
const addDay = d => addDays(d, 1);
// local clock as a decimal hour -> e.g. 23:30 -> 23.5
const clockHour = dt => +(+dt.slice(11, 13) + (+dt.slice(14, 16)) / 60).toFixed(2);
// a sleep segment belongs to the WAKE-UP date: starts at/after 18:00 roll to the next day,
// so an evening->morning night is never split across two rows
const sleepNight = start => (+start.slice(11, 13) >= 18 ? addDay(day(start)) : day(start));
// Night of an interval by its MIDPOINT (wall clock), with the 18:00 roll-over: the rule every sleep
// block is dated by (sleepBlocks), so an evening-to-morning night is never split across two rows.
function midpointNight(start, end) {
  const midIso = new Date((localMs(start) + localMs(end)) / 2).toISOString(); // wall clock read as UTC
  const date = midIso.slice(0, 10);
  return +midIso.slice(11, 13) >= 18 ? addDay(date) : date;
}
// Sleeping wrist temperature is one sample per night spanning the sleep: dated by the SAME rule as a
// sleep block (midpoint + 18:00 roll-over), so a 17:30-23:30 sample and the sleep-daily.csv row of
// that block describe the same night. A sample with no end (Shortcut point payloads carry only the
// start) falls back to the start-based sleepNight, which agrees for the usual 23:xx / 00:xx starts.
const wristTempDate = (start, end) => (end ? midpointNight(start, end) : sleepNight(start));

// total minutes covered by the union of intervals [{start, end}] (overlaps counted once)
function unionMinutes(intervals) {
  return unionMsMinutes(intervals.map(i => [absMs(i.start), absMs(i.end)]));
}
// [[aMs, bMs]] -> minutes of their union
function unionMsMinutes(pairs) {
  const iv = pairs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
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
 * blocks join the night when the awake gap to it is short enough: up to SPLIT_GAP_MIN for a block
 * BEFORE the anchor or one that starts before MID_NIGHT_BEFORE_HOUR on the wake-up date (a split
 * night with a long 3 am wake-up stays one night), but only up to AFTER_END_GAP_MIN for a block that
 * starts AFTER the night's end at or after that hour AND ends at or after FALL_BACK_END_HOUR (10:00)
 * on the wake-up date (so a 09:00-10:30 nap after waking at 06:30, or an afternoon nap, is not
 * absorbed into the night, while dozing off again within the hour still is). A block after the end
 * that ENDS before 10:00 is falling back asleep after an early wake-up (23:59-03:19 + 05:08-07:32,
 * 01:19-06:21 + 07:57-09:48) and joins within SPLIT_GAP_MIN like a mid-night block. Everything else
 * is a NAP and adds neither minutes nor bed/wake times; a day with only naps has no night row.
 * Across sources the one with the most main-sleep minutes wins (the max-across-sources rule that
 * avoids a cross-device double count).
 * Known limitation: night-shift sleep (a main sleep by day, e.g. 09:00-16:00) falls outside the
 * main-sleep window and is treated as a nap; supporting it would need a per-user sleep window. */
const BLOCK_GAP_MIN = 60; // longer awake gaps start a new block
const SPLIT_GAP_MIN = 180; // an awake stretch this long mid-night still belongs to the night
const AFTER_END_GAP_MIN = 60; // a block starting after the night ended joins only within this gap
const MID_NIGHT_BEFORE_HOUR = 5; // a block starting before 05:00 on the wake-up date is mid-night
// falling back asleep after an early wake-up: a block that starts after the night's end (from 05:00 on)
// but ENDS before 10:00 on the wake-up date joins within SPLIT_GAP_MIN, not AFTER_END_GAP_MIN
const FALL_BACK_END_HOUR = 10;
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
    bl.night = midpointNight(bl.start, bl.end);
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
  const midNightEnd = Date.parse(anchor.night + `T${String(MID_NIGHT_BEFORE_HOUR).padStart(2, '0')}:00:00Z`);
  const fallBackEnd = Date.parse(anchor.night + `T${String(FALL_BACK_END_HOUR).padStart(2, '0')}:00:00Z`);
  // awake gap a block may have to the current night span [a, b] and still join it (see above)
  const maxGap = (bl, b) => (bl.a > b && localMs(bl.start) >= midNightEnd && localMs(bl.end) >= fallBackEnd ? AFTER_END_GAP_MIN : SPLIT_GAP_MIN);
  const kept = [anchor];
  let a = anchor.a, b = anchor.b, grew = true;
  while (grew) {
    grew = false;
    for (const bl of cand) {
      if (kept.includes(bl)) continue;
      if (Math.max(bl.a - b, a - bl.b) <= maxGap(bl, b) * MIN_MS) {
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
  return { minutes: unionMinutes(segs), segs, ck };
}

// The night's stage minutes (see sleepNights). `segs` = the winning source's main-sleep asleep
// segments, `own` = all that source's segments, `all` = every source's segments.
function nightStages(segs, own, all, ck) {
  const a = absMs(ck.start), b = absMs(ck.end);
  const of = st => unionMinutes(segs.filter(sg => (sg.stage || 'unspec') === st));
  const staged = segs.some(sg => sg.stage === 'rem' || sg.stage === 'deep' || sg.stage === 'core');
  const awakeSegs = own.filter(sg => sg.stage === 'awake' && absMs(sg.start) < b && absMs(sg.end) > a);
  const awake = unionMsMinutes(awakeSegs.map(sg => [Math.max(a, absMs(sg.start)), Math.min(b, absMs(sg.end))]));
  const inbed = unionMsMinutes([[a, b], ...all.filter(sg => sg.stage === 'inbed' && absMs(sg.start) < b && absMs(sg.end) > a)
    .map(sg => [absMs(sg.start), absMs(sg.end)])]);
  return {
    rem: staged ? of('rem') : null, deep: staged ? of('deep') : null, core: staged ? of('core') : null,
    unspec: of('unspec'), awake: staged || awakeSegs.length ? awake : null, inbed,
  };
}

/** Sleep segments [{start, end, source, stage?}] (export stamps; stage = sleepStage() key, absent =
 * asleep) -> one main-sleep night per wake-up date, [{date, minutes, source, ck: {start, end},
 * stages}] sorted by date. Only ASLEEP segments (rem / deep / core / unspec / no stage) build the
 * night and pick the winning source; awake and in-bed records never create a night. Shared by
 * extract.mjs and sync-shortcut.mjs, so both write identical sleep-daily.csv rows for the same segments.
 * stages (minutes; null = unknown): rem / deep / core / unspec = the union of the winning source's
 * main-sleep segments of that stage (rem / deep / core null when the night has no staged segment —
 * Asleep-unspecified only); awake = that source's Awake records clipped to the sleep window
 * ck.start..ck.end (null when the night is unstaged and has none); inbed = the union of the sleep window with every
 * source's InBed records that overlap it (the iPhone writes InBed, the Watch does not), so without
 * an InBed record it is the window itself (asleep + the awake time inside it). */
function sleepNights(segments) {
  const bySrc = new Map(), all = [];
  for (const sg of segments || []) {
    if (!sg || !sg.start || !sg.end || !(minutesBetween(sg.start, sg.end) > 0)) continue;
    all.push(sg);
    const k = sg.source || '';
    if (!bySrc.has(k)) bySrc.set(k, []);
    bySrc.get(k).push(sg);
  }
  const best = new Map(); // night -> {minutes, source, ck, segs, own}
  for (const [source, own] of bySrc) {
    const segs = own.filter(isAsleepSeg);
    if (!segs.length) continue;
    const byNight = new Map();
    for (const bl of sleepBlocks(segs)) {
      if (!byNight.has(bl.night)) byNight.set(bl.night, []);
      byNight.get(bl.night).push(bl);
    }
    for (const [night, blocks] of byNight) {
      const m = mainSleep(blocks);
      if (!m) continue;
      const cur = best.get(night);
      if (!cur || m.minutes > cur.minutes) best.set(night, { minutes: m.minutes, source, ck: m.ck, segs: m.segs, own });
    }
  }
  return [...best.keys()].sort().map(date => {
    const n = best.get(date);
    return { date, minutes: n.minutes, source: n.source, ck: n.ck, stages: nightStages(n.segs, n.own, all, n.ck) };
  });
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
// + the six stage columns (hours, 2 dp; blank = unknown) from sleepNights' `stages`
const stageH = m => (m == null ? '' : (m / 60).toFixed(2));
const sleepRow = (date, minutes, source, ck, st) =>
  `${date},${(minutes / 60).toFixed(2)},${source || ''},${ck ? clockHour(ck.start) : ''},${ck ? clockHour(ck.end) : ''},` +
  ['rem', 'deep', 'core', 'unspec', 'awake', 'inbed'].map(k => stageH(st ? st[k] : null)).join(',');

// one parsed Apple workout -> workouts.csv row (12 columns; the three Strava-only columns stay empty)
const workoutRow = w => {
  const bpm = v => (v != null ? Math.round(v) : '');
  const km2 = v => (v != null ? Math.round(v * 100) / 100 : '');
  return `${w.date},${w.type},${w.durationMin ?? ''},${w.energyKcal ?? ''},${bpm(w.hrAvg)},${bpm(w.hrMin)},${bpm(w.hrMax)},${w.source || ''},${km2(w.distanceKm)},,,`;
};

export {
  APPLE_WATCH_RE, energySource, pickEnergySource,
  READING_HEADER, SLEEP_HEADER, WORKOUTS_HEADER, workoutRow,
  day, num, localMs, absMs, minutesBetween, addDay, clockHour, sleepNight, wristTempDate, isoToExportStamp,
  readingRow, sleepRow, unionMinutes, sleepNights, sleepStage, SLEEP_STAGE_OF,
};
