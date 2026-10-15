#!/usr/bin/env node
/* Journal export — snapshots the behaviour journal the LAN page writes to the ingest service
 * (services/loop-ingest, GET /journal/summary) into the extract as journal-daily.csv
 * (lib/journal/journal.mjs journalCsv: one row per journaled day, 1 / 0 per yes / no behaviour, the
 * drinks count, blank = not answered, the note), so the build (lib/journal/bake.mjs: the My journal card
 * and the behaviour insights) and read-only consumers see it. Part of `npm run sync` (scripts/sync-all.mjs).
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else :8088). No token: /journal/* is the unauthenticated,
 *          LAN-only layer; the request carries `X-HC-Journal: 1` and the URL's Host must be one the
 *          service accepts (an IP literal, localhost, or a name in its FOOD_ALLOWED_HOSTS).
 * Window : the last JOURNAL_LIMITS.rangeDaysMax (366) days ending on the LOCAL date. Inside it the server
 *          wins (an emptied day disappears); older rows of the previous CSV are kept.
 * Writes : <extract>/journal-daily.csv + journal-daily.meta.json {from, to, days, fetchedAt}, both atomic
 *          (temp file + rename). The extract is gitignored (personal data).
 * Errors : unreachable service, 404 (an image without the endpoint), 503 (journal migration unavailable),
 *          421, 429 or a malformed body -> one `WARNING:` line, the old files kept, exit 0 (the export
 *          is optional and never fails `npm run sync`). Only a failed write exits 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseUrl, ENV_FILE } from '../data/apple-health/sync-common.mjs';
import { JOURNAL_BEHAVIORS, JOURNAL_LIMITS, journalCsv, parseJournalCsv } from '../lib/journal/journal.mjs';
import { JOURNAL_FILE } from '../lib/journal/bake.mjs';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_OUT = path.join(ROOT, 'data', 'apple-health', 'extract');
export const META_FILE = 'journal-daily.meta.json';
const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const shiftIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);

/** {from, to}: rangeDaysMax days inclusive, ending on the local date of `now`. */
export function windowFor(now = new Date()) {
  const to = localIso(now);
  return { from: shiftIso(to, -(JOURNAL_LIMITS.rangeDaysMax - 1)), to };
}

/** The GET /journal/summary body reduced to known fields; throws when malformed. */
export function normalizeSummary(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.days)) throw new Error('unexpected response shape (expected {from, to, days: [...]})');
  if (!isIso(body.from) || !isIso(body.to) || body.to < body.from) throw new Error('unexpected from / to');
  const seen = new Set();
  const days = body.days.map((d) => {
    if (!d || !isIso(d.date) || d.date < body.from || d.date > body.to) throw new Error(`unexpected date ${JSON.stringify(d && d.date)}`);
    if (seen.has(d.date)) throw new Error(`duplicate date ${d.date}`);
    seen.add(d.date);
    if (!d.answers || typeof d.answers !== 'object' || Array.isArray(d.answers)) throw new Error(`unexpected answers on ${d.date}`);
    const answers = {};
    for (const b of JOURNAL_BEHAVIORS) {
      const v = d.answers[b.key];
      if (v === undefined || v === null) continue;
      const ok = b.kind === 'count' ? Number.isInteger(v) && v >= 0 && v <= JOURNAL_LIMITS.countMax : typeof v === 'boolean';
      if (!ok) throw new Error(`unexpected ${b.key} on ${d.date}`);
      answers[b.key] = v;
    }
    if (d.notes != null && typeof d.notes !== 'string') throw new Error(`unexpected notes on ${d.date}`);
    return { date: d.date, answers, notes: d.notes || null };
  });
  return { from: body.from, to: body.to, days };
}

/** The new CSV text: previous rows older than the window + the server's days. */
export function mergedCsv(prevText, s) {
  const older = parseJournalCsv(prevText || '').filter((d) => d.date < s.from);
  return journalCsv([...older, ...s.days]);
}

export async function fetchSummary(baseUrl, { from, to }, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const qs = new URLSearchParams({ from, to });
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/journal/summary?${qs}`, {
      headers: { 'x-hc-journal': '1', accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!res.ok) throw Object.assign(new Error(`ingest service answered HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError' || ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Writes the CSV + meta into `dir`; returns {days, changed}. */
export function syncJournal(dir, body, { now = new Date(), write = writeAtomic } = {}) {
  const s = normalizeSummary(body);
  fs.mkdirSync(dir, { recursive: true });
  const csvFile = path.join(dir, JOURNAL_FILE);
  let prev = null;
  try { prev = fs.readFileSync(csvFile, 'utf8'); } catch { prev = null; }
  const csv = mergedCsv(prev, s);
  const changed = csv !== prev;
  if (changed) write(csvFile, csv);
  write(path.join(dir, META_FILE), JSON.stringify({ from: s.from, to: s.to, days: s.days.length, fetchedAt: now.toISOString() }, null, 2) + '\n');
  return { days: s.days.length, changed };
}

export async function main({ env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch, now = new Date() } = {}) {
  const dir = env.SYNC_JOURNAL_OUT_DIR || DEFAULT_OUT;
  const base = readBaseUrl(env, env.INGEST_ENV_FILE || ENV_FILE);
  let body;
  try {
    body = await fetchSummary(base, windowFor(now), { fetchImpl });
    normalizeSummary(body);
  } catch (err) {
    warn(`WARNING: journal export skipped (${err.message}); the previous ${JOURNAL_FILE} is kept`);
    return 0;
  }
  try {
    const r = syncJournal(dir, body, { now });
    log(`sync-journal: ${r.days} journaled days in the window${r.changed ? '' : ' (unchanged)'} -> ${path.relative(ROOT, path.join(dir, JOURNAL_FILE))}`);
    return 0;
  } catch (err) {
    warn(`ERROR: journal export could not be written (${err.message})`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code));
}
