/* Today's nutrition DAY TYPE (lib/nutrition/targets.mjs DAY_TYPES), decided on the VIEWER's today by
 * web/src/client/nutri-day.ts, which runs THESE functions: lib/nutrition/client.mjs emits them as HC_DAYTYPE
 * (no copy, no client literals). Only REAL training raises the day above rest:
 *   1. today's workouts (SCORES.timeline, same-day rows already merged per modality):
 *      - strength (or a legacy `gym` item) / hybrid: the day's strength + hybrid minutes are summed (foldGym):
 *        hybrid when the hybrid part is >= gymMin (20) min, else gym when the sum is >= gymMin; shorter = stubs;
 *      - run: >= gymMin (20) min -> run;
 *      - other (walks, tennis, yoga...): only >= otherMin (45) min counts, as gym;
 *      - an indoor ride (`indoor: true`, every row IndoorCycling): < rideMin (30) min ignored; up to
 *        indoorLongMin (120) -> indoor; longer ones follow the outdoor rule;
 *      - an outdoor ride: < rideMin (30) min is a commute, ignored; up to bikeMin (75) -> indoor (a short ride
 *        is fuelled like a trainer session); >= bikeMin -> bike; >= bikeLongMin (150) -> bikeLong;
 *      - a zero / negative / non-numeric duration is dropped;
 *   2. the programmed session in training-data.json: gym -> gym, hybrid -> hybrid, run -> run, indoor -> indoor,
 *      bike by durationMin with the outdoor ride thresholds (absent = bike); no / another kind -> gym;
 *   3. else rest.
 * Two-a-days, or a gym session done with a long ride still programmed: the MOST DEMANDING wins (RANK; ties go
 * to what was actually done, whose ride minutes are real). Ride minutes (`rideMin`, `why: ride`, the
 * during-ride fuelling) only for bike / bikeLong.
 * Per person (the onboarding's sports, enduranceOf): `endurance` lists the modalities besides bike that are
 * also measured by length — a run / "other" (swimming) session of >= bikeMin is a long day, >= bikeLongMin a
 * very long one, like a ride (its minutes travel as `rideMin`); shorter ones keep their rule above. Without
 * it the detection is exactly the rules above. Pure: no I/O. */

export const DETECT = Object.freeze({ bikeLongMin: 150, bikeMin: 75, rideMin: 30, gymMin: 20, otherMin: 45, indoorLongMin: 120 });
// how demanding a day type is (the page's manual override compares with it too, HC_DAYTYPE.RANK)
const RANK = Object.freeze({ rest: 0, gym: 1, hybrid: 2, indoor: 3, run: 4, bike: 5, bikeLong: 6 });

/** A ride of `min` minutes -> its day type, or null (a commute); `indoor` = a trainer ride. */
function rideType(min, indoor) {
  if (min < DETECT.rideMin) return null;
  if (indoor && min < DETECT.indoorLongMin) return 'indoor';
  if (min >= DETECT.bikeLongMin) return 'bikeLong';
  if (min >= DETECT.bikeMin) return 'bike';
  return 'indoor';
}

// the sports (lib/nutrition/energy.mjs SPORTS) whose sessions are measured by length, and their modality
// (lib/training/modality.mjs); cycling is bike, which always is
const ENDURANCE_SPORTS = Object.freeze({ running: 'run', swimming: 'other' });

/** A person's sports -> the modalities besides bike measured by length, in modality order (none = []). */
export function enduranceOf(sports) {
  const mods = (Array.isArray(sports) ? sports : []).map((s) => s && ENDURANCE_SPORTS[s.sport]).filter(Boolean);
  return ['run', 'other'].filter((m) => mods.includes(m));
}

/** A long / very long session of an endurance modality, or null. */
function lengthType(modality, min, endurance) {
  if (!Array.isArray(endurance) || endurance.indexOf(modality) < 0 || min < DETECT.bikeMin) return null;
  return min >= DETECT.bikeLongMin ? 'bikeLong' : 'bike';
}

/** One timeline item -> its day type, or null when it is not real training. */
function itemType(it, endurance) {
  if (!it || typeof it.dur !== 'number' || !(it.dur > 0)) return null;
  if (it.modality === 'bike') return rideType(it.dur, it.indoor === true);
  const long = lengthType(it.modality, it.dur, endurance);
  if (long) return long;
  if (it.modality === 'other') return it.dur >= DETECT.otherMin ? 'gym' : null;
  if (it.dur < DETECT.gymMin) return null;
  if (it.modality === 'run') return 'run';
  if (it.modality === 'hybrid') return 'hybrid';
  return 'gym';
}

/** Strength and hybrid items of one day (lib/training/modality.mjs; a legacy `gym` item is strength) fold into
 * ONE item of their summed minutes: the threshold is about the day's gym time, however it was split. It is a
 * hybrid item when the hybrid part alone reaches gymMin, else a gym (strength) one. Other items pass through. */
function foldGym(items) {
  const out = [];
  let gym = null;
  let hybridMin = 0;
  for (const it of Array.isArray(items) ? items : []) {
    const isGym = it && (it.modality === 'strength' || it.modality === 'hybrid' || it.modality === 'gym');
    if (!isGym || typeof it.dur !== 'number' || !(it.dur > 0)) { out.push(it); continue; }
    if (!gym) { gym = { modality: 'gym', dur: 0 }; out.push(gym); }
    gym.dur += it.dur;
    if (it.modality === 'hybrid') hybridMin += it.dur;
  }
  if (gym && hybridMin >= DETECT.gymMin) gym.modality = 'hybrid';
  return out;
}

/** timeline items [{modality, dur}] -> { type, rideMin } of the most demanding one, or null. */
export function dayTypeOfWorkouts(items, endurance) {
  let best = null;
  for (const it of foldGym(items)) {
    const type = itemType(it, endurance);
    if (!type) continue;
    const rideMin = type === 'bike' || type === 'bikeLong' ? Math.round(it.dur) : null;
    if (!best || RANK[type] > RANK[best.type]) best = { type, rideMin };
  }
  return best;
}

/** A programmed session ({kind, durationMin?}) -> its day type, or null without one. */
export function dayTypeOfProgram(session, endurance) {
  if (!session || typeof session !== 'object') return null;
  const min = session.durationMin;
  const kind = session.kind;
  if (kind === 'bike') return typeof min === 'number' && min > 0 ? rideType(min, false) : 'bike';
  if (kind === 'indoor') return 'indoor';
  if (kind === 'hybrid') return 'hybrid';
  const long = typeof min === 'number' && lengthType(kind, min, endurance);
  if (long) return long;
  return kind === 'run' ? 'run' : 'gym';
}

/** One workout of a day: its modality and minutes; `indoor` = a ride whose longest row is IndoorCycling.
 * @typedef {{modality: string, dur: number, indoor?: boolean}} DayItem */
/** detectDayType's input (dayInputFor's result; `endurance` = the person's endurance modalities besides bike).
 * @typedef {{items: DayItem[], programmed: any, known?: boolean, inferred?: boolean, endurance?: string[]}} DayInput */

/** { items, programmed, endurance? } -> { type, why: ride | workout | programmed | none, rideMin }.
 * @param {DayInput} input */
export function detectDayType({ items, programmed, endurance }) {
  const done = dayTypeOfWorkouts(items, endurance);
  const plan = dayTypeOfProgram(programmed, endurance);
  if (done && !(plan && RANK[plan] > RANK[done.type])) {
    return { type: done.type, why: done.rideMin != null ? 'ride' : 'workout', rideMin: done.rideMin };
  }
  if (plan) return { type: plan, why: 'programmed', rideMin: null };
  return { type: 'rest', why: 'none', rideMin: null };
}

const REST = { type: 'rest', why: 'none', rideMin: null };
const GYM = { type: 'gym', why: 'workout', rideMin: null };
const HYBRID = { type: 'hybrid', why: 'workout', rideMin: null };
const INDOOR = { type: 'indoor', why: 'workout', rideMin: null };
const RUN = { type: 'run', why: 'workout', rideMin: null };
// shared fixture: the HC_DAYTYPE tests (web/src/client/nutri-day.test.mjs, the built page) run the emitted source over these
export const DAYTYPE_CASES = Object.freeze([
  { input: { items: [], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'gym', dur: 55 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'gym', dur: 19 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'strength', dur: 55 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'hybrid', dur: 19 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'strength', dur: 12 }, { modality: 'hybrid', dur: 10 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'hybrid', dur: 45 }], programmed: null }, expect: HYBRID },
  { input: { items: [{ modality: 'strength', dur: 30 }, { modality: 'hybrid', dur: 25 }], programmed: null }, expect: HYBRID },
  { input: { items: [{ modality: 'run', dur: 20 }], programmed: null }, expect: RUN },
  { input: { items: [{ modality: 'other', dur: 20 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 44 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 70 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'bike', dur: 25 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'bike', dur: 30 }], programmed: null }, expect: INDOOR },
  { input: { items: [{ modality: 'bike', dur: 74 }], programmed: null }, expect: INDOOR },
  { input: { items: [{ modality: 'bike', dur: 25, indoor: true }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'bike', dur: 90, indoor: true }], programmed: null }, expect: INDOOR },
  { input: { items: [{ modality: 'bike', dur: 130, indoor: true }], programmed: null }, expect: { type: 'bike', why: 'ride', rideMin: 130 } },
  { input: { items: [{ modality: 'run', dur: 30 }, { modality: 'bike', dur: 60, indoor: true }], programmed: null }, expect: RUN },
  { input: { items: [{ modality: 'bike', dur: 75 }], programmed: null }, expect: { type: 'bike', why: 'ride', rideMin: 75 } },
  { input: { items: [{ modality: 'bike', dur: 150 }], programmed: null }, expect: { type: 'bikeLong', why: 'ride', rideMin: 150 } },
  { input: { items: [{ modality: 'gym', dur: 0 }, null, { modality: 'run', dur: 'x' }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 20 }, { modality: 'bike', dur: 25 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'gym', dur: 60 }, { modality: 'bike', dur: 120 }], programmed: null }, expect: { type: 'bike', why: 'ride', rideMin: 120 } },
  { input: { items: [], programmed: { kind: 'run' } }, expect: { type: 'run', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'hybrid' } }, expect: { type: 'hybrid', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'indoor', durationMin: 60 } }, expect: { type: 'indoor', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'bike', durationMin: 45 } }, expect: { type: 'indoor', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'strength', dur: 60 }], programmed: { kind: 'indoor' } }, expect: { type: 'indoor', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'bike', durationMin: 20 } }, expect: REST },
  { input: { items: [], programmed: { kind: 'bike', durationMin: 240 } }, expect: { type: 'bikeLong', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'gym', dur: 60 }], programmed: { kind: 'bike' } }, expect: { type: 'bike', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'bike', dur: 160 }], programmed: { kind: 'gym' } }, expect: { type: 'bikeLong', why: 'ride', rideMin: 160 } },
  // a person whose sports make runs / "other" (swimming) endurance: measured by length like rides
  { input: { items: [{ modality: 'run', dur: 90 }], programmed: null }, expect: RUN },
  { input: { items: [{ modality: 'run', dur: 90 }], programmed: null, endurance: ['run'] }, expect: { type: 'bike', why: 'ride', rideMin: 90 } },
  { input: { items: [{ modality: 'run', dur: 160 }], programmed: null, endurance: ['run'] }, expect: { type: 'bikeLong', why: 'ride', rideMin: 160 } },
  { input: { items: [{ modality: 'run', dur: 40 }], programmed: null, endurance: ['run'] }, expect: RUN },
  { input: { items: [{ modality: 'other', dur: 100 }], programmed: null, endurance: ['other'] }, expect: { type: 'bike', why: 'ride', rideMin: 100 } },
  { input: { items: [], programmed: { kind: 'run', durationMin: 100 } }, expect: { type: 'run', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'run', durationMin: 100 }, endurance: ['run'] }, expect: { type: 'bike', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'run', durationMin: 30 }, endurance: ['run'] }, expect: { type: 'run', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'bike', dur: 160 }], programmed: null, endurance: ['run'] }, expect: { type: 'bikeLong', why: 'ride', rideMin: 160 } },
]);

/* ---------- a past day's detection input (HCNutri.targetFor beyond the 3 baked timeline days) ---------- */
const MS_PER_DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function hasValue(m, date) {
  if (!m || typeof m.start !== 'string' || !ISO_RE.test(m.start) || !Array.isArray(m.v)) return false;
  const i = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / MS_PER_DAY);
  const v = i >= 0 && i < m.v.length ? m.v[i] : null;
  return typeof v === 'number' && Number.isFinite(v);
}

/** The detection input of `date`: { items, programmed, known, inferred }. The timeline (SCORES.timeline.days, the
 * last 3 data days) wins for its dates; any other date takes its workouts from DETAIL.sessions (one per
 * date + modality after the shared display rule, `min` minutes — the same thresholds then apply) and the
 * programmed session from TRAINING. `known` = the date has a timeline row, a session, a sleep reading
 * (DETAIL.metrics.sleep: the Watch was worn, so "no session" means rest) or a programmed session; a
 * date with none of them cannot be told from a day without the Watch, and gets no target. `inferred` =
 * known WITHOUT any session or programmed session (only sleep / a timeline row): its rest type is an
 * assumption, so the food log's adherence counts it apart instead of comparing it.
 * @param {string} date
 * @param {{timeline?: any[], sessions?: any[], sleep?: any, training?: Record<string, any>}} [data]
 * @returns {DayInput} */
export function dayInputFor(date, { timeline = [], sessions = [], sleep = null, training = {} } = {}) {
  const programmed = (training && training[date]) || null;
  const row = (Array.isArray(timeline) ? timeline : []).find((d) => d && d.date === date);
  if (row) {
    const rowItems = Array.isArray(row.items) ? row.items : [];
    return { items: rowItems, programmed, known: true, inferred: rowItems.length === 0 && !programmed };
  }
  // a ride whose longest row is a trainer session (DETAIL `t`, lib/detail/detail.mjs) is an indoor item, like the
  // timeline's (lib/score/timeline.mjs)
  const items = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && s.d === date)
    .map((s) => (s.m === 'bike' && s.t === 'IndoorCycling' ? { modality: s.m, dur: s.min, indoor: true } : { modality: s.m, dur: s.min }));
  const known = items.length > 0 || hasValue(sleep, date) || !!programmed;
  return { items, programmed, known, inferred: known && items.length === 0 && !programmed };
}

const SLEEP = { start: '2030-01-01', v: [7.2, null, 6.9, 8.1] };
const SESSIONS = [{ d: '2030-01-01', m: 'bike', min: 160 }, { d: '2030-01-03', m: 'gym', min: 50 }, { d: '2030-01-03', m: 'other', min: 30 },
  { d: '2030-01-06', m: 'bike', t: 'IndoorCycling', min: 60 }, { d: '2030-01-07', m: 'bike', t: 'Cycling', min: 60 }];
// shared fixture: web/src/client/nutri-day.test.mjs and the built-page test run HC_DAYTYPE over these (the input, then its day type)
export const DAYINPUT_CASES = Object.freeze([
  { date: '2030-01-01', data: { sessions: SESSIONS, sleep: SLEEP }, expect: { items: [{ modality: 'bike', dur: 160 }], programmed: null, known: true, inferred: false } },
  { date: '2030-01-02', data: { sessions: SESSIONS, sleep: SLEEP }, expect: { items: [], programmed: null, known: false, inferred: false } },
  { date: '2030-01-03', data: { sessions: SESSIONS, sleep: SLEEP }, expect: { items: [{ modality: 'gym', dur: 50 }, { modality: 'other', dur: 30 }], programmed: null, known: true, inferred: false } },
  { date: '2030-01-04', data: { sessions: SESSIONS, sleep: SLEEP }, expect: { items: [], programmed: null, known: true, inferred: true } },
  { date: '2030-01-02', data: { sessions: SESSIONS, sleep: SLEEP, training: { '2030-01-02': { kind: 'bike', durationMin: 90 } } }, expect: { items: [], programmed: { kind: 'bike', durationMin: 90 }, known: true, inferred: false } },
  { date: '2030-01-03', data: { timeline: [{ date: '2030-01-03', items: [{ modality: 'run', dur: 40 }] }], sessions: SESSIONS }, expect: { items: [{ modality: 'run', dur: 40 }], programmed: null, known: true, inferred: false } },
  { date: '2029-12-31', data: { sessions: SESSIONS, sleep: SLEEP }, expect: { items: [], programmed: null, known: false, inferred: false } },
  { date: '2030-01-05', data: { timeline: [{ date: '2030-01-05', items: [] }] }, expect: { items: [], programmed: null, known: true, inferred: true } },
  // a trainer ride: indoor here, as the timeline's item (S4); an outdoor ride of the same length carries no flag
  { date: '2030-01-06', data: { sessions: SESSIONS }, expect: { items: [{ modality: 'bike', dur: 60, indoor: true }], programmed: null, known: true, inferred: false } },
  { date: '2030-01-07', data: { sessions: SESSIONS }, expect: { items: [{ modality: 'bike', dur: 60 }], programmed: null, known: true, inferred: false } },
  { date: '2030-01-06', data: { timeline: [{ date: '2030-01-06', items: [{ modality: 'bike', dur: 60, re: null, sessions: 1, indoor: true }] }], sessions: SESSIONS }, expect: { items: [{ modality: 'bike', dur: 60, re: null, sessions: 1, indoor: true }], programmed: null, known: true, inferred: false } },
]);

/** What lib/nutrition/client.mjs emits as the page's `var HC_DAYTYPE` (lib/format/numbers.mjs classicGlobal):
 * THESE functions' own source, so the page detects a day exactly like the lib. A plain descriptor, no
 * import of the emitter: data/nutrition/generate.mjs loads this module set on its own. */
export const CLIENT = {
  consts: { DETECT, RANK },
  hidden: { MS_PER_DAY, ISO_RE },
  fns: { rideType, lengthType, itemType, foldGym, dayTypeOfWorkouts, dayTypeOfProgram, detectDayType, hasValue, dayInputFor },
};
