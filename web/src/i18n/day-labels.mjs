/* Per-person day-type names (onboarding v2): a person who entered their sports in the in-page onboarding
 * (lib/profile/onboarding.mjs `sports`) sees each day type named after the sports that fill it and their usual
 * length ("Correr ~1,5 h") instead of the plan's gym / bike / long bike, and sport-neutral wording where the
 * dictionary talks about rides. The four day-type keys stay the same (lib/nutrition/targets.mjs DAY_TYPES).
 * Without sports the dictionary is returned as is. Build-time only (web/src/tabs/Dia.astro). Pure: no I/O. */
import { DAY_TYPES } from '../../../lib/nutrition/targets.mjs';
import { dayTypeOfMinutes, usedDayTypes } from '../../../lib/nutrition/energy.mjs';

const SHORT_NAMES = 2; // the segment control keeps two names, then "+N"

/** Average session length -> "~45 min" / "~1,5 h" (half hours from 1 h on). */
function lengthLabel(min, lang) {
  if (min < 60) return `~${Math.round(min / 5) * 5} min`;
  const h = Math.round(min / 30) / 2;
  return `~${lang === 'es' ? String(h).replace('.', ',') : String(h)} h`;
}

/** The day types the day-type control shows: the ones this person's week has (all of them without sports). */
export function shownDayTypes(dayTypes, sports) {
  if (!Array.isArray(sports) || !sports.length) return dayTypes;
  const used = usedDayTypes(sports);
  return dayTypes.filter((d) => used.includes(d));
}

/** T (web/src/i18n/nutri-templates.mjs, one language) with this person's day-type names; a new object. */
export function personalNutriText(T, sports, lang) {
  if (!Array.isArray(sports) || !sports.length) return T;
  const S = T.sportText;
  const dayTypes = { ...T.dayTypes };
  const dayShort = { ...T.dayShort };
  for (const d of DAY_TYPES) {
    const mine = sports.filter((s) => dayTypeOfMinutes(s.minutes) === d).sort((a, b) => b.perWeek - a.perWeek);
    if (d === 'rest' || !mine.length) continue;
    const names = mine.map((s) => S.names[s.sport]);
    const n = mine.reduce((a, s) => a + s.perWeek, 0);
    const avg = mine.reduce((a, s) => a + s.minutes * s.perWeek, 0) / n;
    dayTypes[d] = `${names.join(' · ')} ${lengthLabel(avg, lang)}`;
    dayShort[d] = names.slice(0, SHORT_NAMES).join(' · ') + (names.length > SHORT_NAMES ? ` +${names.length - SHORT_NAMES}` : '');
  }
  const autoRaised = {};
  for (const d of Object.keys(T.autoRaised)) autoRaised[d] = S.autoRaised;
  return {
    ...T, dayTypes, dayShort, autoRaised,
    why: { ...T.why, ride: S.rideWhy },
    fuel: { ...T.fuel, durationLabel: S.durationLabel, inDay: S.inDay },
  };
}
