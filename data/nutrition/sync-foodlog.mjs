#!/usr/bin/env node
/* Food log export — snapshots the per-day sums of the food log the LAN page writes to the ingest
 * service (services/loop-ingest, GET /food/log/summary, the shared daySummaries formula of
 * lib/nutrition/foodlog.mjs) into data/nutrition/foodlog-daily.csv, so read-only consumers (the
 * nutrition-coach subagent, which only reads files) see what the user actually logged.
 *
 *   node data/nutrition/sync-foodlog.mjs     (part of `npm run sync`, after the settings sync)
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else :8088). No token: /food/* is the unauthenticated,
 *          LAN-only food layer; the request carries `X-HC-Food: 1` and the URL's Host must be one the
 *          service accepts (an IP literal, localhost, or a name in its FOOD_ALLOWED_HOSTS).
 * Window : the last DAYS_MAX (= FOOD_LIMITS.summaryDaysMax, the server's cap) days ending on the
 *          LOCAL date. Inside the window the server wins (a deleted day disappears); rows of the
 *          previous CSV older than the window are kept, so history survives the server's cap.
 * Writes : foodlog-daily.csv = one row per LOGGED day (see HEADER; a day with no entry has no row; an
 *          unknown macro is blank, never 0; `missing_macros` lists the macros some entry lacked, so
 *          those sums are minimums; breakfast..addon = entry counts per Registrar group) and
 *          foodlog-daily.meta.json = {from, to, days, fetchedAt}. Both atomic (temp file + rename),
 *          rewritten only when the CSV changed or the stored fetchedAt is from an earlier UTC day.
 *          Gitignored (personal data). Per-entry detail is NOT exported: GET /food/log?date= is one
 *          request per day (DAYS_MAX requests), not worth it for a daily-sum consumer.
 * Errors : unreachable service, 404 (an image without the endpoint), 503 (food migration
 *          unavailable), 421 (host not allowed), 429 or a malformed body -> one `WARNING:` line, the
 *          old files kept, exit 0: the export is optional and must never fail `npm run sync`. Only a
 *          failed write exits 1.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as common from '../apple-health/sync-common.mjs'
import { addDays, isIsoDate } from '../../lib/date.mjs'
import { isMain } from '../../scripts/lib/is-main.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// SYNC_FOODLOG_OUT_DIR exists ONLY so the child-process tests can point main() at a tmp dir
const OUT = process.env.SYNC_FOODLOG_OUT_DIR || __dirname
const CSV_FILE = 'foodlog-daily.csv'
const META_FILE = 'foodlog-daily.meta.json'
// copy of lib/nutrition/foodlog.mjs FOOD_LIMITS.summaryDaysMax (a test pins it equal)
const DAYS_MAX = 120
const GROUPS = ['breakfast', 'lunch', 'dinner', 'addon']
const MACROS = [['p', 'protein'], ['c', 'carbs'], ['f', 'fat']]
const HEADER = ['date', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'entries', ...GROUPS, 'missing_macros']

const pad = (n) => String(n).padStart(2, '0')
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isCount = (v) => Number.isInteger(v) && v >= 0

/** {from, to}: DAYS_MAX days inclusive, ending on the local date of `now`. */
function windowFor (now = new Date()) {
  const to = localIso(now)
  return { from: addDays(to, -(DAYS_MAX - 1)), to }
}

/** The GET /food/log/summary body reduced to the known per-day fields; throws when malformed. */
function normalizeSummary (body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.days)) throw new Error('unexpected response shape (expected {from, to, days: [...]})')
  if (!isIsoDate(body.from)) throw new Error('unexpected from')
  if (!isIsoDate(body.to) || body.to < body.from) throw new Error('unexpected to')
  const seen = new Set()
  const days = body.days.map((d) => {
    if (!d || typeof d !== 'object') throw new Error('unexpected day')
    if (!isIsoDate(d.date) || d.date < body.from || d.date > body.to) throw new Error(`unexpected date ${JSON.stringify(d.date)}`)
    if (seen.has(d.date)) throw new Error(`duplicate date ${d.date}`)
    seen.add(d.date)
    if (!isNum(d.k)) throw new Error(`unexpected kcal on ${d.date}`)
    const out = { date: d.date, k: d.k }
    for (const [k, name] of MACROS) {
      if (d[k] !== null && !isNum(d[k])) throw new Error(`unexpected ${name} on ${d.date}`)
      out[k] = d[k]
    }
    if (!Number.isInteger(d.n) || d.n < 1) throw new Error(`unexpected entries on ${d.date}`)
    out.n = d.n
    const m = d.missing
    if (!m || typeof m !== 'object' || MACROS.some(([k]) => typeof m[k] !== 'boolean')) throw new Error(`unexpected missing on ${d.date}`)
    out.missing = { p: m.p, c: m.c, f: m.f }
    const g = d.groups
    if (!g || typeof g !== 'object' || GROUPS.some((k) => !isCount(g[k]))) throw new Error(`unexpected groups on ${d.date}`)
    out.groups = Object.fromEntries(GROUPS.map((k) => [k, g[k]]))
    return out
  })
  return { from: body.from, to: body.to, days }
}

function dayRow (d) {
  const missing = MACROS.filter(([k]) => d.missing[k]).map(([, name]) => name).join(';')
  return [d.date, d.k, ...MACROS.map(([k]) => (d[k] == null ? '' : d[k])), d.n, ...GROUPS.map((k) => d.groups[k]), missing].join(',')
}

/** CSV text: HEADER + one row per day (rows are pre-formatted strings or day objects). */
function toCsv (days) {
  return [HEADER.join(','), ...days.map((d) => (typeof d === 'string' ? d : dayRow(d)))].join('\n') + '\n'
}

/** Previous CSV rows (raw lines) older than `from`; an unreadable / foreign file yields none. */
function olderRows (file, from) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').filter(Boolean)
  if (lines[0] !== HEADER.join(',')) return []
  return lines.slice(1).filter((l) => {
    const date = l.slice(0, 10)
    return isIsoDate(date) && l[10] === ',' && date < from
  }).sort()
}

function readJsonOrNull (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** GET <base>/food/log/summary?from&to with the food layer's header; the HTTP status (if any) is kept on err.status. */
async function fetchSummary (baseUrl, { from, to }, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const qs = new URLSearchParams({ from, to })
  return common.fetchJson(`${String(baseUrl).replace(/\/+$/, '')}/food/log/summary?${qs}`, null, {
    fetchImpl, timeoutMs, headers: { 'x-hc-food': '1', accept: 'application/json' }, redirect: 'error'
  })
}

/** Writes the CSV + meta when the CSV changed or the stored fetchedAt is from an earlier UTC day. */
function syncFoodlog (dir, body, { now = new Date(), writeAtomic = common.writeAtomic } = {}) {
  const s = normalizeSummary(body)
  fs.mkdirSync(dir, { recursive: true })
  const csvFile = path.join(dir, CSV_FILE)
  const metaFile = path.join(dir, META_FILE)
  const csv = toCsv([...olderRows(csvFile, s.from), ...s.days])
  let prevCsv = null
  try {
    prevCsv = fs.readFileSync(csvFile, 'utf8')
  } catch {}
  const prevMeta = readJsonOrNull(metaFile)
  const fetchedAt = now.toISOString()
  const fresh = prevMeta && typeof prevMeta.fetchedAt === 'string' && prevMeta.fetchedAt.slice(0, 10) === fetchedAt.slice(0, 10)
  if (prevCsv === csv && fresh) return { written: false, days: s.days.length }
  writeAtomic(csvFile, csv)
  writeAtomic(metaFile, JSON.stringify({ from: s.from, to: s.to, days: s.days.length, fetchedAt }, null, 2) + '\n')
  return { written: true, days: s.days.length }
}

function warning (err, baseUrl) {
  const status = err && err.status
  if (status === 404) return `WARNING: the ingest service has no /food/log/summary — rebuild/restart the loop-ingest container. ${CSV_FILE} kept.`
  if (status === 503) return `WARNING: the ingest service answered 503 (food log unavailable: its 006_food migration failed). ${CSV_FILE} kept.`
  if (status === 421) return `WARNING: the ingest service refused the host of ${baseUrl} (421) — use localhost / an IP, or add the name to FOOD_ALLOWED_HOSTS. ${CSV_FILE} kept.`
  if (status === 429) return `WARNING: the ingest service rate-limited the food log summary (429) — retry later. ${CSV_FILE} kept.`
  const cause = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message)
  return `WARNING: could not read the food log from ${baseUrl} (${cause}). ${CSV_FILE} kept.`
}

const USAGE = `Usage: node data/nutrition/sync-foodlog.mjs

Snapshots the food log's per-day sums from the ingest service into data/nutrition/foodlog-daily.csv.
  -h, --help   this help
Env: INGEST_URL, INGEST_ENV_FILE (default services/loop-ingest/.env, for its INGEST_PORT).`

async function main () {
  const baseUrl = common.readBaseUrl(process.env)
  let body
  try {
    body = await fetchSummary(baseUrl, windowFor())
    normalizeSummary(body)
  } catch (err) {
    console.error(warning(err, baseUrl))
    return
  }
  try {
    const r = syncFoodlog(OUT, body)
    console.log(`Food log: ${r.days} logged day${r.days === 1 ? '' : 's'} in ${body.from}..${body.to}; ${r.written ? 'written' : 'unchanged'}`)
  } catch (err) {
    console.error(`ERROR: food log sync failed (${(err && err.message) || err}). The files are only ever replaced atomically.`)
    process.exit(1)
  }
}

if (isMain(import.meta.url)) common.runCli(main, { usage: USAGE })

export { CSV_FILE, META_FILE, DAYS_MAX, HEADER, windowFor, normalizeSummary, toCsv, fetchSummary, syncFoodlog, warning, main }
