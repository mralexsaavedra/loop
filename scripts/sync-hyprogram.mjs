#!/usr/bin/env node
// Sync the owner's Hyprogram "HP Hybrid" training program into the local
// knowledge base, for the hybrid-coach subagent to read.
//
//   node scripts/sync-hyprogram.mjs [--dry-run] [--limit N]
//
// Login is the owner's own account (NextAuth credentials, email + password)
// read programmatically from data/training/.env.hyprogram — that file is never
// printed, and no token, cookie or password is ever logged or written to disk.
// Only read-only GETs are made; nothing on the account is modified.
//
//   --dry-run   log in, list the programmed days, print the fetch plan; write
//               nothing and fetch no workout content.
//   --limit N   fetch at most N days (newest first), for a quick check.
//
// Output (all gitignored under knowledge/*):
//   knowledge/hybrid/hyprogram/raw/<id>.json   the workout JSON as returned,
//                                              with any per-user data stripped
//   knowledge/hybrid/hyprogram/semanas/<YYYY-Www>.md   faithful Spanish render
//   knowledge/hybrid/hyprogram/manifest.json   incremental, per-date fetchedAt
//
// Security: coarse error messages only (auth_failed, http_403, …); request
// bodies that may carry tokens are never echoed. Polite: sequential requests
// ~1.5 s apart, access-window early stop keeps the total small.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROGRAM_ID, DEFAULT_LOCALE, STOP_AFTER_FORBIDDEN,
  parseArgs, parseEnvFile, selectDates, sanitizeDay, renderWeekFile,
  mergeManifest, savedDates, groupByWeek, isoWeek,
} from './hyprogram-lib.mjs';

const BASE = 'https://hyprogram.com';
const UA = 'health-coach/1.0 (personal training-program sync; owner account)';
const PACE_MS = 1500;
const REQ_TIMEOUT_MS = 30_000;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Credentials file; overridable with HYPROGRAM_ENV (e.g. when running from a
// git worktree whose gitignored secrets live in the main checkout).
const ENV_PATH = process.env.HYPROGRAM_ENV
  ? resolve(process.env.HYPROGRAM_ENV)
  : join(ROOT, 'data', 'training', '.env.hyprogram');
const OUT_DIR = join(ROOT, 'knowledge', 'hybrid', 'hyprogram');
const RAW_DIR = join(OUT_DIR, 'raw');
const WEEKS_DIR = join(OUT_DIR, 'semanas');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- cookie jar (in-memory only; never persisted) ---------------------------
const jar = new Map();
function storeCookies(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function request(method, path, { body, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path.startsWith('http') ? path : BASE + path, {
      method,
      headers: { 'User-Agent': UA, Cookie: cookieHeader(), ...headers },
      body,
      redirect: 'manual',
      signal: ac.signal,
    });
  } catch {
    throw new Error('network_error');
  } finally {
    clearTimeout(timer);
  }
  storeCookies(res);
  return res;
}

async function getJson(path) {
  const res = await request('GET', path, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
  let data = null;
  try { data = JSON.parse(await res.text()); } catch { data = null; }
  return { status: res.status, data };
}

// --- auth -------------------------------------------------------------------
async function login(email, password) {
  const csrfRes = await request('GET', '/api/auth/csrf', { headers: { Accept: 'application/json' } });
  if (csrfRes.status !== 200) throw new Error('auth_failed');
  let csrfToken;
  try { csrfToken = JSON.parse(await csrfRes.text()).csrfToken; } catch { throw new Error('auth_failed'); }
  if (!csrfToken) throw new Error('auth_failed');
  await sleep(PACE_MS);

  const form = new URLSearchParams({
    csrfToken, email, password, callbackUrl: BASE + '/workouts', json: 'true',
  });
  const res = await request('POST', '/api/auth/callback/credentials', {
    body: form.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-Auth-Return-Redirect': '1',
    },
  });
  // NextAuth returns 200 with a {url} that points back to /sign-in on failure.
  const hasSession = [...jar.keys()].some((k) => /session-token/.test(k));
  if (!hasSession) throw new Error('auth_failed');
  let text = '';
  try { text = await res.text(); } catch {}
  if (/sign-in|error/i.test(text) && !hasSession) throw new Error('auth_failed');
  await sleep(PACE_MS);

  // Confirm the session is usable; detect MFA/challenge states early.
  const sess = await getJson('/api/auth/session');
  if (sess.status !== 200 || !sess.data || !sess.data.user) {
    throw new Error('auth_failed');
  }
  if (sess.data.error === 'mfa' || sess.data.challenge) {
    throw new Error('mfa_required');
  }
  return true;
}

// --- fs helpers -------------------------------------------------------------
function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try { return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { return null; }
}

function loadSavedDay(date) {
  // Re-read a previously saved raw day so we can rebuild a whole week file.
  const file = join(RAW_DIR, `HYROX_PROGRAM_${date}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// --- main -------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(ENV_PATH)) {
    console.error(`Missing ${ENV_PATH} (keys HYPROGRAM_EMAIL, HYPROGRAM_PASSWORD). Create it, chmod 600.`);
    process.exit(2);
  }
  const env = parseEnvFile(readFileSync(ENV_PATH, 'utf8'));
  if (!env.HYPROGRAM_EMAIL || !env.HYPROGRAM_PASSWORD) {
    console.error('env missing HYPROGRAM_EMAIL / HYPROGRAM_PASSWORD');
    process.exit(2);
  }

  console.log('Logging in…');
  await login(env.HYPROGRAM_EMAIL, env.HYPROGRAM_PASSWORD);
  console.log('Logged in.');
  await sleep(PACE_MS);

  const imp = await getJson(`/api/workouts/important_days?programId=${PROGRAM_ID}`);
  if (imp.status !== 200 || !imp.data || !Array.isArray(imp.data.data)) {
    throw new Error(`http_${imp.status}`);
  }
  const importantDays = imp.data.data;
  console.log(`Programmed days: ${importantDays.length} (${importantDays[0]} … ${importantDays[importantDays.length - 1]})`);

  const manifest = readManifest();
  const already = savedDates(manifest);
  const plan = selectDates(importantDays, already, { limit: args.limit });
  console.log(`Already saved: ${already.length}. To attempt (newest first): ${plan.length}${args.limit !== Infinity ? ` (limited to ${args.limit})` : ''}.`);

  if (args.dryRun) {
    console.log('Dry run — fetch plan:');
    for (const d of plan.slice(0, 40)) console.log(`  ${d}`);
    if (plan.length > 40) console.log(`  … and ${plan.length - 40} more`);
    return;
  }

  const fetchedAt = new Date().toISOString();
  const entries = [];
  const touchedWeeks = new Set();
  let ok = 0;
  let forbiddenRun = 0;
  let stopped = false;

  for (const date of plan) {
    await sleep(PACE_MS);
    const res = await getJson(`/api/workouts/get_by_date?programId=${PROGRAM_ID}&workoutDate=${date}`);
    if (res.status === 200 && res.data && res.data.data) {
      forbiddenRun = 0;
      const clean = sanitizeDay(res.data.data);
      const id = clean.id || `HYROX_PROGRAM_${date}`;
      writeAtomic(join(RAW_DIR, `${id}.json`), JSON.stringify(clean, null, 2));
      entries.push({ date, id, status: 'ok', fetchedAt });
      touchedWeeks.add(isoWeek(date));
      ok++;
      console.log(`  ok   ${date}`);
    } else if (res.status === 403) {
      entries.push({ date, status: 'forbidden', fetchedAt });
      forbiddenRun++;
      console.log(`  skip ${date} (outside access window)`);
      if (ok > 0 && forbiddenRun >= STOP_AFTER_FORBIDDEN) {
        stopped = true;
        console.log(`  reached the end of the access window; stopping.`);
        break;
      }
    } else if (res.status === 404) {
      entries.push({ date, status: 'missing', fetchedAt });
      console.log(`  none ${date} (no workout)`);
    } else {
      entries.push({ date, status: `http_${res.status}`, fetchedAt });
      console.log(`  err  ${date} (http_${res.status})`);
    }
  }

  // Persist manifest.
  const nextManifest = mergeManifest(manifest, entries);
  nextManifest.lastSync = fetchedAt;
  nextManifest.program = PROGRAM_ID;
  writeAtomic(MANIFEST_PATH, JSON.stringify(nextManifest, null, 2) + '\n');

  // Rebuild every week file touched this run from ALL saved raw days of that
  // week (so a week spanning two runs stays complete).
  const allOkDates = savedDates(nextManifest);
  const dayObjs = allOkDates.map(loadSavedDay).filter(Boolean);
  const byWeek = groupByWeek(dayObjs);
  let weekFiles = 0;
  for (const wk of touchedWeeks) {
    const days = byWeek.get(wk) || [];
    if (!days.length) continue;
    writeAtomic(join(WEEKS_DIR, `${wk}.md`), renderWeekFile(wk, days, { locale: DEFAULT_LOCALE, fetchedAt }));
    weekFiles++;
  }

  console.log(`\nDone. Fetched ${ok} day(s); wrote ${weekFiles} week file(s)${stopped ? ' (stopped at window edge)' : ''}.`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((e) => {
  // Coarse message only — never surface response bodies or tokens.
  console.error(`sync-hyprogram failed: ${e.message || 'error'}`);
  process.exit(1);
});
