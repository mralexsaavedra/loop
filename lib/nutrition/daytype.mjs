/* Today's nutrition DAY TYPE (lib/nutrition/targets.mjs DAY_TYPES), decided on the VIEWER's today by
 * web/src/client/nutri-day.js — this module is the reference its port is tested against (the page
 * bakes DETECT, never client literals). Only REAL training raises the day above rest:
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
const RANK = { rest: 0, gym: 1, bike: 2, bikeLong: 3 };

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
// shared fixture: the client parity test (web/src/client/nutri-day.test.mjs) runs the port over these
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
