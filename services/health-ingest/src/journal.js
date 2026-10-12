/**
 * Behaviour journal routes (Q7), mounted by server.js under /journal/ and reached from the LAN plan page
 * through plan-web's /api/journal/ proxy:
 *
 *   GET  /journal/day?date=YYYY-MM-DD     that (local) day: {date, answers, notes, updatedAt} (empty when
 *                                         never journaled: answers {}, notes / updatedAt null)
 *   PUT  /journal/day                     full replace of one day {date, answers, notes?} (idempotent
 *                                         upsert; no answer and no note removes the day)
 *   GET  /journal/summary?from=&to=       the journaled days in range (<= JOURNAL_LIMITS.rangeDaysMax days):
 *                                         [{date, answers, notes}] — the page's week strip and the sync
 *   GET  /journal/settings                {behaviors: {key: on}} (every behaviour on by default)
 *   PUT  /journal/settings                partial {behaviors: {key: bool}}
 *
 * Same security model and layers as the food routes (food.js header; the shared helpers are http.js): unauthenticated, LAN only; a
 * Host allowlist (421), an Origin check on writes (403 forbidden_origin), the custom header
 * `X-HC-Journal: 1` on every request (403) and `Content-Type: application/json` on writes (415) — a
 * cross-site request needs a CORS preflight this server never approves. Bodies <= 16 KB (413), writes
 * <= 60 / min and summary reads <= 30 / min per client address (429). Its own OPTIONAL migration group
 * (`journal`, sql/010_journal.sql): when it fails every known /journal/* path answers 503
 * journal_unavailable and the rest of the service keeps running. Errors are coarse {error, field?} codes.
 *
 * Answers: {behaviourKey: value}; a yes/no behaviour takes a boolean, the drinks count an integer
 * 0..countMax; null or a missing key = not answered. Unknown keys are refused (the list is
 * journal-calc.js, a copy of lib/journal/journal.mjs). Answers of a switched-off behaviour are still
 * accepted: the switch only hides the row on the page, history is kept.
 */
import { JOURNAL_BEHAVIORS, JOURNAL_LIMITS as L } from './journal-calc.js'
import { createWindowLimiter } from './limits.js'
import {
  JSON_BODY_LIMIT, validDate, hostAllowed, hostOfHeader, hostOfOrigin, httpError, send, isJson, readJson
} from './http.js'

export const JOURNAL_BODY_LIMIT = JSON_BODY_LIMIT // 16 KB, readJson's cap
export const JOURNAL_WRITE_LIMIT = 60
export const JOURNAL_SUMMARY_LIMIT = 30
const WRITE_METHODS = new Set(['PUT'])
// a Map, never a plain object: a JSON key such as __proto__ or constructor must not resolve to anything
const BY_KEY = new Map(JOURNAL_BEHAVIORS.map((b) => [b.key, b]))

const ROUTES = [
  { path: '/journal/day', methods: ['GET', 'PUT'] },
  { path: '/journal/summary', methods: ['GET'] },
  { path: '/journal/settings', methods: ['GET', 'PUT'] }
]

function bad (field) {
  throw httpError(400, 'invalid', field)
}
function isObj (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function strictKeys (body, allowed) {
  if (!isObj(body)) bad('body')
  for (const k of Object.keys(body)) if (!allowed.includes(k)) bad(k)
}

/** {date, answers, notes}: answers without the unanswered (null) keys, notes trimmed or null. */
export function validateDay (body) {
  strictKeys(body, ['date', 'answers', 'notes'])
  const date = validDate(body.date) ?? bad('date')
  const raw = body.answers === undefined ? {} : body.answers
  if (!isObj(raw)) bad('answers')
  const answers = {}
  for (const [k, v] of Object.entries(raw)) {
    const b = BY_KEY.get(k)
    if (!b) bad(`answers.${k}`)
    if (v === null) continue
    if (b.kind === 'count') {
      if (!Number.isInteger(v) || v < 0 || v > L.countMax) bad(`answers.${k}`)
    } else if (typeof v !== 'boolean') bad(`answers.${k}`)
    answers[k] = v
  }
  let notes = null
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') bad('notes')
    // line breaks are kept (spaces / tabs collapsed, at most one blank line between paragraphs)
    const s = body.notes.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (s.length > L.notesMax) bad('notes')
    notes = s || null
  }
  return { date, answers, notes }
}

export function validateSettings (body) {
  strictKeys(body, ['behaviors'])
  if (!isObj(body.behaviors)) bad('behaviors')
  for (const [k, v] of Object.entries(body.behaviors)) {
    if (!BY_KEY.has(k) || typeof v !== 'boolean') bad(`behaviors.${k}`)
  }
  const out = {}
  for (const b of JOURNAL_BEHAVIORS) if (Object.hasOwn(body.behaviors, b.key)) out[b.key] = body.behaviors[b.key]
  return out
}

function validateRange (params) {
  const from = validDate(params.get('from')) ?? bad('from')
  const to = validDate(params.get('to')) ?? bad('to')
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
  if (days < 1 || days > L.rangeDaysMax) bad('to')
  return { from, to }
}

function behaviorsOf (disabled) {
  const off = new Set(disabled)
  return Object.fromEntries(JOURNAL_BEHAVIORS.map((b) => [b.key, !off.has(b.key)]))
}

export function createJournalRoutes ({ store, now = Date.now, log = console.log, writeLimit = JOURNAL_WRITE_LIMIT, summaryLimit = JOURNAL_SUMMARY_LIMIT, available = () => true, allowedHosts = [] }) {
  const writes = createWindowLimiter({ limit: writeLimit, windowMs: 60_000, now })
  const summaries = createWindowLimiter({ limit: summaryLimit, windowMs: 60_000, now })

  async function dispatch (req, res, url) {
    const m = req.method
    const path = url.pathname
    if (path === '/journal/day') {
      if (m === 'GET') {
        const date = validDate(url.searchParams.get('date')) ?? bad('date')
        const day = await store.getDay(date)
        return send(res, 200, { day: day ?? { date, answers: {}, notes: null, updatedAt: null } })
      }
      const d = validateDay(await readJson(req))
      if (!Object.keys(d.answers).length && d.notes == null) {
        await store.deleteDay(d.date)
        return send(res, 200, { day: { date: d.date, answers: {}, notes: null, updatedAt: null } })
      }
      return send(res, 200, { day: await store.putDay(d) })
    }
    if (path === '/journal/summary') {
      if (!summaries.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
      const { from, to } = validateRange(url.searchParams)
      const days = (await store.listRange(from, to)).map((d) => ({ date: d.date, answers: d.answers, notes: d.notes }))
      return send(res, 200, { from, to, days })
    }
    // /journal/settings
    if (m === 'GET') return send(res, 200, { behaviors: behaviorsOf(await store.getDisabled()) })
    const patch = validateSettings(await readJson(req))
    const current = behaviorsOf(await store.getDisabled())
    const next = { ...current, ...patch }
    const disabled = JOURNAL_BEHAVIORS.filter((b) => !next[b.key]).map((b) => b.key)
    return send(res, 200, { behaviors: behaviorsOf(await store.setDisabled(disabled)) })
  }

  return {
    /** Handles /journal and /journal/*; false for any other path (the caller keeps routing). */
    async handle (req, res, url) {
      const path = url.pathname
      if (path !== '/journal' && !path.startsWith('/journal/')) return false
      try {
        if (!hostAllowed(hostOfHeader(req.headers.host), allowedHosts)) throw httpError(421, 'misdirected')
        if (req.headers['x-hc-journal'] !== '1') throw httpError(403, 'forbidden')
        const route = ROUTES.find((r) => r.path === path)
        if (!route) throw httpError(404, 'not_found')
        if (!available()) throw httpError(503, 'journal_unavailable')
        if (!route.methods.includes(req.method)) {
          req.resume()
          send(res, 405, { error: 'method_not_allowed' }, { allow: route.methods.join(', ') })
          return true
        }
        if (WRITE_METHODS.has(req.method)) {
          const origin = req.headers.origin
          if (origin !== undefined && !hostAllowed(hostOfOrigin(origin), allowedHosts)) throw httpError(403, 'forbidden_origin')
          if (!writes.take(req.socket?.remoteAddress ?? 'unknown')) throw httpError(429, 'rate_limited')
          if (!isJson(req)) throw httpError(415, 'unsupported_media_type')
        }
        if (req.method === 'GET') req.resume()
        await dispatch(req, res, url)
      } catch (err) {
        if (res.headersSent) return true
        if (err && err.status && err.code) {
          const body = { error: err.code }
          if (err.field) body.field = err.field
          if (err.status === 413) {
            res.on('finish', () => req.destroy())
            send(res, 413, body, { connection: 'close' })
          } else {
            req.resume()
            send(res, err.status, body)
          }
        } else {
          log(JSON.stringify({ event: 'journal_error', message: err?.message ?? String(err) }))
          send(res, 500, { error: 'internal' })
        }
      }
      return true
    }
  }
}
