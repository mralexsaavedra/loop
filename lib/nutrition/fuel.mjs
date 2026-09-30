/* On-bike fuelling ("Avituallamiento") for the bike day types — ORIENTATIVE ranges from common
 * sports-nutrition guidance, not a prescription and not medical advice:
 *   Antes / Before   2–3 h before: ~1–2 g carbs per kg; in the last hour 30–60 g of easy carbs.
 *   Durante / During bike 60 g/h, bikeLong 60–90 g/h; fluids 500–750 ml/h; sodium ~300–600 mg/h
 *                    (more in heat or for heavy sweaters — there is no weather data here, so ranges).
 *   Después / After  within 1 h: ~1–1.2 g carbs per kg + 30–40 g protein.
 * The on-bike carbs COUNT INSIDE the day total: the plan's meals are scaled to (target - ride fuel),
 * with the fuel point = the midpoint of the during-ride range (lib/nutrition/scale.mjs).
 *
 * The page recomputes this client-side for the viewer's ride duration (web/src/client/nutri-day.js
 * ports fuelPlan over the baked FUEL constants; a test pins that both agree). Pure: no I/O. */

export const RIDE_DEFAULT_MIN = Object.freeze({ bike: 120, bikeLong: 210 });
// the ride-duration picker's choices (minutes): 1 h to 6 h in half hours
export const RIDE_DURATIONS = Object.freeze([60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);

export const FUEL = Object.freeze({
  before: Object.freeze({ hoursBefore: [2, 3], gPerKg: [1, 2], lastHourG: [30, 60] }),
  during: Object.freeze({
    gPerH: Object.freeze({ bike: [60, 60], bikeLong: [60, 90] }),
    fluidMlPerH: [500, 750],
    sodiumMgPerH: [300, 600],
  }),
  after: Object.freeze({ withinH: 1, gPerKg: [1, 1.2], proteinG: [30, 40] }),
  // generic practical units (not brands): a gel, a banana, a bar, a 500 ml bottle of 6–8% drink
  units: Object.freeze({ gelG: 25, bananaG: 25, barG: 40, bottleMl: 500, bottlePct: [6, 8], bottleG: [30, 40] }),
  roundG: 5,
  roundMl: 50,
  roundMg: 50,
  kcalPerG: 4,
});

export const isBikeDay = (dayType) => dayType === 'bike' || dayType === 'bikeLong';

const step = (v, s) => Math.round(v / s) * s;
const range = ([lo, hi], mul, s) => [step(lo * mul, s), step(hi * mul, s)];

/** { dayType, minutes, weightKg } -> the three windows for that ride, or null on a non-bike day. */
export function fuelPlan({ dayType, minutes, weightKg }) {
  if (!isBikeDay(dayType)) return null;
  const min = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : RIDE_DEFAULT_MIN[dayType];
  const h = min / 60;
  const kg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null;
  const U = FUEL.units;
  const gPerH = FUEL.during.gPerH[dayType];
  const carbsG = range(gPerH, h, FUEL.roundG);
  const planG = step(((gPerH[0] + gPerH[1]) / 2) * h, FUEL.roundG);
  const bottleMid = (U.bottleG[0] + U.bottleG[1]) / 2;
  const bottles = Math.max(0, Math.min(Math.ceil(h), Math.floor(planG / bottleMid)));
  return {
    minutes: min,
    before: {
      hoursBefore: FUEL.before.hoursBefore,
      gPerKg: FUEL.before.gPerKg,
      carbsG: kg ? range(FUEL.before.gPerKg, kg, FUEL.roundG) : null,
      lastHourG: FUEL.before.lastHourG,
    },
    during: {
      gPerH,
      carbsG,
      planG,
      fluidsMl: range(FUEL.during.fluidMlPerH, h, FUEL.roundMl),
      sodiumMg: range(FUEL.during.sodiumMgPerH, h, FUEL.roundMg),
      equiv: {
        gels: Math.ceil(planG / U.gelG),
        bananas: Math.ceil(planG / U.bananaG),
        bars: Math.ceil(planG / U.barG),
        bottles: [Math.ceil(planG / U.bottleG[1]), Math.ceil(planG / U.bottleG[0])],
      },
      mix: { bottles, gels: Math.ceil(Math.max(0, planG - bottles * bottleMid) / U.gelG) },
    },
    after: {
      withinH: FUEL.after.withinH,
      gPerKg: FUEL.after.gPerKg,
      carbsG: kg ? range(FUEL.after.gPerKg, kg, FUEL.roundG) : null,
      proteinG: FUEL.after.proteinG,
    },
    kcal: planG * FUEL.kcalPerG,
  };
}
