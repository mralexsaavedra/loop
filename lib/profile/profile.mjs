/* The profile sheet's data (web/src/components/Avatar.astro bakes it as PROFILE; the avatar button in
 * the top bar opens it through the detail sheet, #profile). Three optional sources, merged here:
 *   1. manual  — profile/profile.json (gitignored; tracked template profile/profile.example.json):
 *                birthdate, heightCm, devices, and name / city overrides. Manual wins.
 *   2. strava  — data/profile/strava-profile.json + avatar.jpg, written by data/profile/sync-profile.js
 *                from the ingest service's GET /export/athlete (name, location, gear, devices seen on
 *                activities, photo).
 *   3. derived — weight = the newest weigh-in of weight.csv with its date (never Strava's weight).
 * The age is NOT computed here: the page computes it from `birthdate` on the viewer's clock, so builds
 * stay byte-identical. Everything absent -> hasData false (generic avatar icon + an onboarding hint).
 * Example mode reads the tracked synthetic seeds (profile.example.json, data/demo/strava-profile.json)
 * and never a photo, so the example page shows initials.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readSeries } from '../health/read.mjs';

// typical running-shoe life is ~700–800 km: from here on the sheet suggests considering a replacement
export const SHOE_REPLACE_KM = 700;
export const MAX_AVATAR_BYTES = 60 * 1024;
export const DEVICE_TYPES = ['watch', 'bike-computer', 'ems', 'other'];

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
  if (m.devices != null) {
    if (!Array.isArray(m.devices)) errs.push('devices must be a list');
    else m.devices.forEach((d, i) => {
      if (!d || typeof d !== 'object') { errs.push(`devices[${i}] must be an object`); return; }
      if (!str(d.name)) errs.push(`devices[${i}].name is required`);
      if (d.type != null && !DEVICE_TYPES.includes(d.type)) errs.push(`devices[${i}].type must be one of ${DEVICE_TYPES.join(', ')}`);
      if (d.since != null && !(typeof d.since === 'string' && MONTH_RE.test(d.since))) errs.push(`devices[${i}].since must be "YYYY-MM"`);
    });
  }
  return errs;
}

export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, 2).map((w) => [...w][0].toLocaleUpperCase('und')).join('');
}

/** A small real JPEG -> data URI (the page stays one self-contained file); anything else -> null. */
export function avatarDataUri(buf) {
  if (!buf || !buf.length || buf.length > MAX_AVATAR_BYTES) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return null;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** The newest weigh-in, 1 decimal, with its date; null without weight data. */
export function latestWeight(extractDir) {
  const rows = readSeries(extractDir, 'weight.csv');
  if (!rows) return null;
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

// a Strava device_name only says what recorded the activity; guess the kind conservatively
function deviceType(name) {
  if (/watch|forerunner|fenix|coros|polar|suunto/i.test(name)) return 'watch';
  if (/edge|wahoo|elemnt|karoo|bolt|roam/i.test(name)) return 'bike-computer';
  return 'other';
}

function mergeDevices(manual, strava) {
  const out = [];
  const byName = new Map();
  for (const d of Array.isArray(manual) ? manual : []) {
    const name = str(d?.name);
    if (!name || byName.has(name.toLowerCase())) continue;
    const entry = { name, type: DEVICE_TYPES.includes(d.type) ? d.type : 'other', since: str(d.since), source: 'manual', count: null, lastUsed: null };
    byName.set(name.toLowerCase(), entry);
    out.push(entry);
  }
  for (const d of Array.isArray(strava) ? strava : []) {
    const name = str(d?.name);
    if (!name) continue;
    const usage = { count: num(d.count), lastUsed: isRealDate(d.lastUsed) ? d.lastUsed : null };
    const known = byName.get(name.toLowerCase());
    if (known) { Object.assign(known, usage); continue; }
    const entry = { name, type: deviceType(name), since: null, source: 'strava', ...usage };
    byName.set(name.toLowerCase(), entry);
    out.push(entry);
  }
  return out;
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
    weight: weight && num(weight.kg) != null && isRealDate(weight.date) ? { kg: weight.kg, date: weight.date } : null,
    focus: s.athleteType === 'cyclist' || s.athleteType === 'runner' ? s.athleteType : null,
    bikes: gearList(s.bikes, 'bike'),
    shoes: gearList(s.shoes, 'shoe'),
    gearScopeMissing: Boolean(s.gearScopeMissing),
    devices: mergeDevices(m.devices, s.devices),
    strava: Boolean(strava),
    stravaAsOf: typeof s.fetchedAt === 'string' && isRealDate(s.fetchedAt.slice(0, 10)) ? s.fetchedAt.slice(0, 10) : null,
    photo: avatarDataUri(avatar),
  };
  profile.hasData = Boolean(profile.name || profile.location || profile.birthdate || profile.heightCm != null ||
    profile.weight || profile.bikes.length || profile.shoes.length || profile.devices.length || profile.photo);
  return profile;
}

function readManual(file) {
  if (!fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`loadProfile: ${file} — profile.json is not valid JSON (${err.message}).`);
  }
  const errs = validateManual(data);
  if (errs.length) throw new Error(`loadProfile: ${file} — profile.json is invalid:\n  - ${errs.join('\n  - ')}`);
  return data;
}

// machine-written by the sync: a broken file must never fail the build, it is simply ignored
function readSnapshot(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Build-time loader: personal = the gitignored files, example = the tracked synthetic seeds. */
export function loadProfile({ repoRoot, dataMode, extractDir }) {
  const example = dataMode === 'example';
  const manual = readManual(path.join(repoRoot, 'profile', example ? 'profile.example.json' : 'profile.json'));
  const strava = readSnapshot(example ? path.join(repoRoot, 'data', 'demo', 'strava-profile.json') : path.join(repoRoot, 'data', 'profile', 'strava-profile.json'));
  const avatarPath = path.join(repoRoot, 'data', 'profile', 'avatar.jpg');
  const avatar = !example && fs.existsSync(avatarPath) ? fs.readFileSync(avatarPath) : null;
  return buildProfile({ manual, strava, avatar, weight: latestWeight(extractDir) });
}
