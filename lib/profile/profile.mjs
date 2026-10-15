/* The profile sheet's data (web/src/components/Avatar.astro bakes it as PROFILE; the avatar button in
 * the top bar opens it through the detail sheet, #profile). Three optional sources, merged here:
 *   1. manual  — profile/profile.json (gitignored; tracked template profile/profile.example.json):
 *                birthdate, heightCm, sex (male | female: the fitness-age reference curve), devices (+ an optional `manual` PDF file name, see MANUAL_FILE_RE),
 *                hiddenDevices (names left out of the device list, e.g. a device Strava saw once),
 *                supplements ({name, dose?, meal}: shown under that meal
 *                in Nutrición's Plan de hoy and listed in the sheet), events ({name, date, type?, location?}:
 *                upcoming races, days to go computed by the page) and name / city overrides. Manual wins.
 *   2. strava  — data/profile/strava-profile.json + avatar.jpg, written by data/profile/sync-profile.mjs
 *                from the ingest service's GET /export/athlete (name, location, gear, devices seen on
 *                activities, photo).
 *   3. derived — weight = the newest weigh-in of weight.csv with its date (never Strava's weight).
 * The age is NOT computed here: the page computes it from `birthdate` on the viewer's clock, so builds
 * stay byte-identical. Everything absent -> hasData false (generic avatar icon + an onboarding hint).
 * Example mode reads the tracked synthetic seeds (profile.example.json, data/demo/strava-profile.json)
 * and never a photo, so the example page shows initials.
 * This module is pure (no fs): lib/profile/read.mjs reads the sources (loadProfile, checkManualProfile,
 * readManualProfile) and calls buildProfile; the weigh-in comes from web/src/bakes.mjs (newestWeight).
 */
import { MEAL_SLOTS } from '../nutrition/slots.mjs';

// typical running-shoe life is ~700–800 km: from here on the sheet suggests considering a replacement
export const SHOE_REPLACE_KM = 700;
export const MAX_AVATAR_BYTES = 60 * 1024;
export const DEVICE_TYPES = ['watch', 'bike-computer', 'ems', 'other'];
// upcoming races / events (profile.json `events`): the sheet lists them with days to go, and the
// coach subagents read the same file to plan around them
export const EVENT_TYPES = ['hyrox', 'race', 'sportive', 'other'];
// the sex-specific reference curve of the fitness age (lib/score/fitness-age.mjs); optional
export const SEXES = ['male', 'female'];

// a device manual (profile.json devices[].manual): a bare PDF file name in data/gear/ (gitignored),
// published by scripts/publish-manuals.mjs into the LAN page's site/manuales/ — never a path
export const MANUAL_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.pdf$/;
export const isManualFile = (v) => typeof v === 'string' && MANUAL_FILE_RE.test(v) && !v.includes('..');

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

function isRealDate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Problems in a manual profile.json (empty list = valid). Unknown keys (e.g. _comment) are ignored. */
export function validateManual(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['profile.json must be a JSON object'];
  const errs = [];
  for (const k of ['name', 'city']) if (m[k] != null && typeof m[k] !== 'string') errs.push(`${k} must be a string`);
  if (m.birthdate != null && !isRealDate(m.birthdate)) errs.push('birthdate must be a real date "YYYY-MM-DD"');
  if (m.heightCm != null && !(num(m.heightCm) != null && m.heightCm >= 50 && m.heightCm <= 260)) errs.push('heightCm must be a number of centimetres (50–260)');
  // the max HR of the per-workout HR zones (lib/training/hr-zones.mjs; absent = the highest HR
  // Strava saw in the last 12 months)
  if (m.maxHr != null && !(num(m.maxHr) != null && m.maxHr >= 100 && m.maxHr <= 230)) errs.push('maxHr must be a number of bpm (100–230)');
  if (m.sex != null && !SEXES.includes(m.sex)) errs.push('sex must be "male" or "female"');
  if (m.devices != null) {
    if (!Array.isArray(m.devices)) errs.push('devices must be a list');
    else m.devices.forEach((d, i) => {
      if (!d || typeof d !== 'object') { errs.push(`devices[${i}] must be an object`); return; }
      if (!str(d.name)) errs.push(`devices[${i}].name is required`);
      if (d.type != null && !DEVICE_TYPES.includes(d.type)) errs.push(`devices[${i}].type must be one of ${DEVICE_TYPES.join(', ')}`);
      if (d.since != null && !(typeof d.since === 'string' && MONTH_RE.test(d.since))) errs.push(`devices[${i}].since must be "YYYY-MM"`);
      if (d.manual != null && !isManualFile(d.manual)) errs.push(`devices[${i}].manual must be a PDF file name in data/gear (e.g. "edge-manual.pdf", no folders)`);
    });
  }
  if (m.hiddenDevices != null) {
    if (!Array.isArray(m.hiddenDevices)) errs.push('hiddenDevices must be a list of device names');
    else m.hiddenDevices.forEach((n, i) => { if (!str(n)) errs.push(`hiddenDevices[${i}] must be a device name`); });
  }
  if (m.supplements != null) {
    if (!Array.isArray(m.supplements)) errs.push('supplements must be a list');
    else m.supplements.forEach((s, i) => {
      if (!s || typeof s !== 'object') { errs.push(`supplements[${i}] must be an object`); return; }
      if (!str(s.name)) errs.push(`supplements[${i}].name is required`);
      if (s.dose != null && typeof s.dose !== 'string') errs.push(`supplements[${i}].dose must be text (e.g. "3 g")`);
      if (!MEAL_SLOTS.includes(s.meal)) errs.push(`supplements[${i}].meal must be one of ${MEAL_SLOTS.join(', ')}`);
    });
  }
  if (m.events != null) {
    if (!Array.isArray(m.events)) errs.push('events must be a list');
    else m.events.forEach((e, i) => {
      if (!e || typeof e !== 'object') { errs.push(`events[${i}] must be an object`); return; }
      if (!str(e.name)) errs.push(`events[${i}].name is required`);
      if (!isRealDate(e.date)) errs.push(`events[${i}].date must be a real date "YYYY-MM-DD"`);
      if (e.type != null && !EVENT_TYPES.includes(e.type)) errs.push(`events[${i}].type must be one of ${EVENT_TYPES.join(', ')}`);
      if (e.location != null && typeof e.location !== 'string') errs.push(`events[${i}].location must be text`);
    });
  }
  return errs;
}

/** Valid events only, oldest first (the page splits upcoming / past on the viewer's clock). */
function eventList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e === 'object' && str(e.name) && isRealDate(e.date))
    .map((e) => ({ name: str(e.name), date: e.date, type: EVENT_TYPES.includes(e.type) ? e.type : 'other', location: str(e.location) }))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i))
    .map(({ e }) => e);
}

/** Valid supplements only (a build ignores a broken profile.json as a whole, so this is a guard). */
function supplementList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s === 'object' && str(s.name) && MEAL_SLOTS.includes(s.meal))
    .map((s) => ({ name: str(s.name), dose: str(s.dose), meal: s.meal }));
}

export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, 2).map((w) => [...w][0].toLocaleUpperCase('und')).join('');
}

/** A small real JPEG -> data URI (the page stays one self-contained file); anything else -> null. */
export function avatarDataUri(buf) {
  if (!buf || !buf.length || buf.length > MAX_AVATAR_BYTES) return null;
  // Strava serves some photos as PNG under a .jpg name: the magic bytes pick the MIME type
  const kind = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpeg'
    : buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 ? 'png' : null;
  if (!kind) return null;
  return `data:image/${kind};base64,${buf.toString('base64')}`;
}

/** The newest weigh-in of date-sorted weight rows ({date, value}), 1 decimal, with its date; null
 * without rows. web/src/bakes.mjs feeds it lib/extract/read.mjs readExtract's series.weight. */
export function newestWeight(rows) {
  if (!rows || !rows.length) return null;
  const last = rows[rows.length - 1];
  return { kg: round1(last.value), date: last.date };
}

const gearOrder = (a, b) => Number(a.retired) - Number(b.retired) || Number(b.primary) - Number(a.primary);

function shapeGear(g, kind) {
  const km = num(g.distanceM) != null ? round1(g.distanceM / 1000) : null;
  const detail = [str(g.brand), str(g.model)].filter(Boolean).join(' ') || null;
  const base = { name: str(g.name) || detail || '—', detail };
  const tail = { km, retired: Boolean(g.retired), primary: Boolean(g.primary) };
  if (kind === 'shoe') return { ...base, ...tail, replace: !tail.retired && km != null && km >= SHOE_REPLACE_KM };
  return { ...base, frame: str(g.frameType), weightKg: num(g.weightKg), ...tail };
}

const gearList = (list, kind) => (Array.isArray(list) ? list : [])
  .filter((g) => g && typeof g === 'object')
  .map((g) => shapeGear(g, kind))
  .map((g, i) => ({ g, i }))
  .sort((a, b) => gearOrder(a.g, b.g) || a.i - b.i)
  .map(({ g }) => g);

// A Strava device_name only says what recorded the activity; the kind is guessed from explicit
// brand + model-line pairs only (a bare "Watch" or "Bolt" is not enough). Chest straps / optical
// sensors (Polar H9/H10/OH1/Verity) are not watches and stay 'other', like anything unknown.
/** @type {Array<[string, RegExp]>} */
const DEVICE_RULES = [
  ['other', /\bpolar\s+(h\d+|oh1|verity)\b/i],
  ['bike-computer', /\bgarmin\s+edge\b|\bwahoo\s+elemnt\b|\bhammerhead\b|\bkaroo\b|\bcoros\s+dura\b/i],
  ['watch', /\bapple\s+watch\b/i],
  ['watch', /\bgarmin\s+(forerunner|f[eē]nix|venu|instinct|vivoactive|epix|enduro)\b/i],
  ['watch', /\bcoros\s+(pace|apex|vertix)\b|\bsuunto\s+(race|vertical|\d)\b|\bpolar\s+(vantage|grit|pacer|ignite)\b/i],
];

export function deviceType(name) {
  for (const [type, re] of DEVICE_RULES) if (re.test(String(name ?? ''))) return type;
  return 'other';
}

/** Manual devices first, then the Strava-derived ones not already listed (same name, case-insensitive:
 * the usage is merged into the manual entry, which keeps its `manual`); `hidden` names are dropped. */
function mergeDevices(manual, strava, hidden) {
  const out = [];
  const byName = new Map();
  const hide = new Set((Array.isArray(hidden) ? hidden : []).map(str).filter(Boolean).map((n) => n.toLowerCase()));
  for (const d of Array.isArray(manual) ? manual : []) {
    const name = str(d?.name);
    if (!name || byName.has(name.toLowerCase())) continue;
    const entry = { name, type: DEVICE_TYPES.includes(d.type) ? d.type : 'other', since: str(d.since), source: 'manual', count: null, lastUsed: null,
      manual: isManualFile(d.manual) ? d.manual : null };
    byName.set(name.toLowerCase(), entry);
    out.push(entry);
  }
  for (const d of Array.isArray(strava) ? strava : []) {
    const name = str(d?.name);
    if (!name) continue;
    const usage = { count: num(d.count), lastUsed: isRealDate(d.lastUsed) ? d.lastUsed : null };
    const known = byName.get(name.toLowerCase());
    if (known) { Object.assign(known, usage); continue; }
    const entry = { name, type: deviceType(name), since: null, source: 'strava', ...usage, manual: null };
    byName.set(name.toLowerCase(), entry);
    out.push(entry);
  }
  return out.filter((d) => !hide.has(d.name.toLowerCase()));
}

function locationOf(manual, s) {
  const override = str(manual.city);
  if (override) return override;
  const parts = [str(s.city), str(s.country) || str(s.state)].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Pure merge of the three sources (each optional) into the baked shape. */
export function buildProfile({ manual = null, strava = null, avatar = null, weight = null } = {}) {
  const m = manual && typeof manual === 'object' ? manual : {};
  const s = strava && typeof strava === 'object' ? strava : {};
  const name = str(m.name) || [str(s.firstname), str(s.lastname)].filter(Boolean).join(' ') || null;
  const profile = {
    name,
    initials: initialsOf(name),
    location: locationOf(m, s),
    birthdate: isRealDate(m.birthdate) ? m.birthdate : null,
    heightCm: num(m.heightCm),
    sex: SEXES.includes(m.sex) ? m.sex : null,
    weight: weight && num(weight.kg) != null && isRealDate(weight.date) ? { kg: weight.kg, date: weight.date } : null,
    focus: s.athleteType === 'cyclist' || s.athleteType === 'runner' ? s.athleteType : null,
    bikes: gearList(s.bikes, 'bike'),
    shoes: gearList(s.shoes, 'shoe'),
    gearScopeMissing: Boolean(s.gearScopeMissing),
    devices: mergeDevices(m.devices, s.devices, m.hiddenDevices),
    supplements: supplementList(m.supplements),
    events: eventList(m.events),
    strava: Boolean(strava),
    stravaAsOf: typeof s.fetchedAt === 'string' && isRealDate(s.fetchedAt.slice(0, 10)) ? s.fetchedAt.slice(0, 10) : null,
    photo: avatarDataUri(avatar),
  };
  profile.hasData = Boolean(profile.name || profile.location || profile.birthdate || profile.heightCm != null ||
    profile.weight || profile.bikes.length || profile.shoes.length || profile.devices.length || profile.supplements.length ||
    profile.events.length || profile.photo);
  return profile;
}
