/* Today's nutrition DAY TYPE (lib/nutrition/targets.mjs DAY_TYPES), decided on the VIEWER's today by
 * web/src/client/nutri-day.js, which runs THESE functions: lib/nutrition/client.mjs emits them as HC_DAYTYPE
 * (no copy, no client literals). Only REAL training raises the day above rest:
 *   1. today's workouts (SCORES.timeline, same-day rows already merged per modality):
 *      - gym / run: a session of >= gymMin (20) min -> gym; shorter ones are stubs;
 *      - other (walks, tennis, yoga...): only >= otherMin (45) min counts, as gym;
 *      - bike: < rideMin (30) min is a commute, ignored; up to bikeMin (75) -> gym; >= bikeMin -> bike;
 *        >= bikeLongMin (150) -> bikeLong;
 *      - a zero / negative / non-numeric duration is dropped;
 *   2. the programmed session in training-data.json (kind "bike" by durationMin with the same ride
 *      thresholds, absent = bike; any other kind -> gym);
 *   3. else rest.
 * Two-a-days, or a gym session done with a long ride still programmed: the MOST DEMANDING wins
 * (ties go to what was actually done, whose ride minutes are real). Pure: no I/O. */

export const DETECT = Object.freeze({ bikeLongMin: 150, bikeMin: 75, rideMin: 30, gymMin: 20, otherMin: 45 });
// how demanding a day type is (the page's manual override compares with it too, HC_DAYTYPE.RANK)
const RANK = Object.freeze({ rest: 0, gym: 1, bike: 2, bikeLong: 3 });

function rideType(min) {
  if (min >= DETECT.bikeLongMin) return 'bikeLong';
  if (min >= DETECT.bikeMin) return 'bike';
  if (min >= DETECT.rideMin) return 'gym';
  return null;
}

/** One timeline item -> its day type, or null when it is not real training. */
function itemType(it) {
  if (!it || typeof it.dur !== 'number' || !(it.dur > 0)) return null;
  if (it.modality === 'bike') return rideType(it.dur);
  if (it.modality === 'other') return it.dur >= DETECT.otherMin ? 'gym' : null;
  return it.dur >= DETECT.gymMin ? 'gym' : null;
}

/** timeline items [{modality, dur}] -> { type, rideMin } of the most demanding one, or null. */
export function dayTypeOfWorkouts(items) {
  let best = null;
  for (const it of Array.isArray(items) ? items : []) {
    const type = itemType(it);
    if (!type) continue;
    const rideMin = type === 'bike' || type === 'bikeLong' ? Math.round(it.dur) : null;
    if (!best || RANK[type] > RANK[best.type]) best = { type, rideMin };
  }
  return best;
}

/** A programmed session ({kind, durationMin?}) -> its day type, or null without one. */
export function dayTypeOfProgram(session) {
  if (!session || typeof session !== 'object') return null;
  if (session.kind !== 'bike') return 'gym';
  const min = session.durationMin;
  return typeof min === 'number' && min > 0 ? rideType(min) : 'bike';
}

/** { items, programmed } -> { type, why: ride | workout | programmed | none, rideMin }. */
export function detectDayType({ items, programmed }) {
  const done = dayTypeOfWorkouts(items);
  const plan = dayTypeOfProgram(programmed);
  if (done && !(plan && RANK[plan] > RANK[done.type])) {
    return { type: done.type, why: done.rideMin != null ? 'ride' : 'workout', rideMin: done.rideMin };
  }
  if (plan) return { type: plan, why: 'programmed', rideMin: null };
  return { type: 'rest', why: 'none', rideMin: null };
}

const REST = { type: 'rest', why: 'none', rideMin: null };
const GYM = { type: 'gym', why: 'workout', rideMin: null };
// shared fixture: the HC_DAYTYPE tests (web/src/client/nutri-day.test.mjs, the built page) run the emitted source over these
export const DAYTYPE_CASES = Object.freeze([
  { input: { items: [], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'gym', dur: 55 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'gym', dur: 19 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'run', dur: 20 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'other', dur: 20 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 44 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 70 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'bike', dur: 25 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'bike', dur: 30 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'bike', dur: 74 }], programmed: null }, expect: GYM },
  { input: { items: [{ modality: 'bike', dur: 75 }], programmed: null }, expect: { type: 'bike', why: 'ride', rideMin: 75 } },
  { input: { items: [{ modality: 'bike', dur: 150 }], programmed: null }, expect: { type: 'bikeLong', why: 'ride', rideMin: 150 } },
  { input: { items: [{ modality: 'gym', dur: 0 }, null, { modality: 'run', dur: 'x' }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'other', dur: 20 }, { modality: 'bike', dur: 25 }], programmed: null }, expect: REST },
  { input: { items: [{ modality: 'gym', dur: 60 }, { modality: 'bike', dur: 120 }], programmed: null }, expect: { type: 'bike', why: 'ride', rideMin: 120 } },
  { input: { items: [], programmed: { kind: 'run' } }, expect: { type: 'gym', why: 'programmed', rideMin: null } },
  { input: { items: [], programmed: { kind: 'bike', durationMin: 20 } }, expect: REST },
  { input: { items: [], programmed: { kind: 'bike', durationMin: 240 } }, expect: { type: 'bikeLong', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'gym', dur: 60 }], programmed: { kind: 'bike' } }, expect: { type: 'bike', why: 'programmed', rideMin: null } },
  { input: { items: [{ modality: 'bike', dur: 160 }], programmed: { kind: 'gym' } }, expect: { type: 'bikeLong', why: 'ride', rideMin: 160 } },
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
 * assumption, so the food log's adherence counts it apart instead of comparing it. */
export function dayInputFor(date, { timeline = [], sessions = [], sleep = null, training = {} } = {}) {
  const programmed = (training && training[date]) || null;
  const row = (Array.isArray(timeline) ? timeline : []).find((d) => d && d.date === date);
  if (row) {
    const rowItems = Array.isArray(row.items) ? row.items : [];
    return { items: rowItems, programmed, known: true, inferred: rowItems.length === 0 && !programmed };
  }
  const items = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && s.d === date)
    .map((s) => ({ modality: s.m, dur: s.min }));
  const known = items.length > 0 || hasValue(sleep, date) || !!programmed;
  return { items, programmed, known, inferred: known && items.length === 0 && !programmed };
}

const SLEEP = { start: '2030-01-01', v: [7.2, null, 6.9, 8.1] };
const SESSIONS = [{ d: '2030-01-01', m: 'bike', min: 160 }, { d: '2030-01-03', m: 'gym', min: 50 }, { d: '2030-01-03', m: 'other', min: 30 }];
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
]);

/** What lib/nutrition/client.mjs emits as the page's `var HC_DAYTYPE` (lib/format/numbers.mjs classicGlobal):
 * THESE functions' own source, so the page detects a day exactly like the lib. A plain descriptor, no
 * import of the emitter: data/nutrition/generate.mjs loads this module set on its own. */
export const CLIENT = {
  consts: { DETECT, RANK },
  hidden: { MS_PER_DAY, ISO_RE },
  fns: { rideType, itemType, dayTypeOfWorkouts, dayTypeOfProgram, detectDayType, hasValue, dayInputFor },
};
