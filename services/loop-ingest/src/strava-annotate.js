/**
 * POST /strava/activities/:id/annotate — give a Strava activity a name and a description written by the
 * owner's tools (e.g. the training session it was), without ever overwriting what the owner wrote:
 *
 *   - the DESCRIPTION is written only when the activity has none (blank counts as none);
 *   - the NAME is replaced only when it is Strava's automatic title ("Morning Run", "Carrera matutina"…,
 *     isDefaultActivityName), never a title the owner typed.
 *
 * The route reads the activity detail from Strava first (GET /activities/:id: the list the sync stores has
 * no description, and /export/strava never exports names), decides, then sends one PUT with only the
 * fields it may change. `dry_run: true` stops after the decision and changes nothing.
 *
 * `overwrite: true` lifts both guards for an edit the owner asked for explicitly ("put these intervals in
 * today's run"): the given name / description replace the current ones. The answer always carries the
 * current name and description, so a caller can read them first (dry_run) and merge instead of replacing.
 *
 * Writing needs the `activity:write` scope (scripts/strava-auth.js asks for it). A token authorized
 * without it answers 401/403 on the PUT: the route answers 409 strava_write_scope_missing and
 * the read-only sync is unaffected. Bearer-protected like /export/*, and NOT proxied by loop-web's nginx:
 * only a coach clone holding INGEST_TOKEN reaches it on the ingest port.
 */
import { httpError, readJson, isJson, writeJson, hasControlChars, containsNul } from './http.js'

const ACTIVITY_URL = 'https://www.strava.com/api/v3/activities/'
const FETCH_TIMEOUT_MS = 15_000
export const ANNOTATE_BODY_LIMIT = 16 * 1024
export const NAME_MAX = 255
export const DESCRIPTION_MAX = 8000
const ROUTE_RE = /^\/strava\/activities\/(\d{1,20})\/annotate$/

// Strava titles an activity "<time of day> <sport>" in the athlete's language: "Morning Run", "Lunch Ride",
// "Evening Weight Training"; in Spanish "<sport> <time of day>": "Carrera matutina", "Bicicleta por la tarde",
// "Entrenamiento nocturno". Only a WHOLE title of that shape is automatic: a word like "Night" or "de la tarde"
// inside a longer title ("Night Owls 10K", "Tirada larga de la tarde con Ana") is the owner's and stays.
const SPORTS_EN = [
  'Run', 'Trail Run', 'Virtual Run', 'Ride', 'Virtual Ride', 'Gravel Ride', 'Mountain Bike Ride', 'E-Bike Ride',
  'E-Mountain Bike Ride', 'Walk', 'Hike', 'Swim', 'Workout', 'Weight Training', 'HIIT',
  'High Intensity Interval Training', 'Crossfit', 'Row', 'Rowing', 'Virtual Row', 'Yoga', 'Pilates', 'Elliptical',
  'Stair-Stepper', 'Tennis', 'Padel', 'Pickleball', 'Activity'
]
const SPORTS_ES = [
  'Carrera', 'Carrera por montaña', 'Carrera de montaña', 'Carrera virtual', 'Bicicleta', 'Bicicleta virtual',
  'Bicicleta de gravel', 'Bicicleta de montaña', 'Bicicleta eléctrica', 'Caminata', 'Excursión', 'Senderismo',
  'Natación', 'Entrenamiento', 'Entrenamiento con pesas', 'Entrenamiento de fuerza', 'Entrenamiento HIIT',
  'Entrenamiento de intervalos de alta intensidad', 'HIIT', 'Crossfit', 'Remo', 'Remo virtual', 'Yoga', 'Pilates',
  'Elíptica', 'Escaladora', 'Tenis', 'Pádel', 'Pickleball', 'Actividad'
]
const alt = (list) => list.map((w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')
const DEFAULT_NAME_RES = [
  new RegExp(`^(Morning|Afternoon|Evening|Night|Lunch) (${alt(SPORTS_EN)})$`, 'i'),
  new RegExp(`^(${alt(SPORTS_ES)}) (matutin[oa]|vespertin[oa]|nocturn[oa]|por la (mañana|tarde|noche)|de (la )?(mañana|tarde|noche|madrugada)|a la hora del almuerzo|al mediodía|de mediodía)$`, 'i')
]

/** Whether `name` is Strava's automatic title (empty counts as automatic: there is nothing to keep). */
export function isDefaultActivityName (name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (s === '') return true
  return DEFAULT_NAME_RES.some((re) => re.test(s))
}

/** Validate the request body: `{ name?, description?, dry_run?, overwrite? }`, at least one of name / description. */
export function parseAnnotateBody (body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'bad_body')
  const allowed = new Set(['name', 'description', 'dry_run', 'overwrite'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw httpError(400, 'unknown_field', key)
  if (containsNul(body)) throw httpError(400, 'nul_character')
  const out = { dryRun: false, overwrite: false }
  for (const [key, prop] of [['dry_run', 'dryRun'], ['overwrite', 'overwrite']]) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') throw httpError(400, 'bad_field', key)
    out[prop] = body[key]
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw httpError(400, 'bad_field', 'name')
    const name = body.name.trim()
    // one line: a title holds no line break or tab
    if (name === '' || name.length > NAME_MAX || hasControlChars(name) || /[\t\n\r]/.test(name)) throw httpError(400, 'bad_field', 'name')
    out.name = name
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') throw httpError(400, 'bad_field', 'description')
    const description = body.description.replace(/\r\n/g, '\n').trim()
    // line breaks and tabs are the description's layout (hasControlChars allows them); any other control is refused
    if (description === '' || description.length > DESCRIPTION_MAX || hasControlChars(description)) {
      throw httpError(400, 'bad_field', 'description')
    }
    out.description = description
  }
  if (out.name === undefined && out.description === undefined) throw httpError(400, 'nothing_to_write')
  return out
}

/**
 * What may be written, given the activity's current name and description. Pure. Without `overwrite` only the
 * automatic title and an empty description are replaced; with it any given field that differs is.
 */
export function decideAnnotation (current, wanted) {
  const currentName = String(current?.name ?? '')
  const currentDescription = String(current?.description ?? '')
  const hasDescription = currentDescription.trim() !== ''
  const nameIsDefault = isDefaultActivityName(currentName)
  const fields = {}
  if (wanted.name !== undefined && wanted.name !== currentName && (nameIsDefault || wanted.overwrite)) fields.name = wanted.name
  if (wanted.description !== undefined && wanted.description !== currentDescription.trim() && (!hasDescription || wanted.overwrite)) {
    fields.description = wanted.description
  }
  return { fields, currentName, currentDescription, nameIsDefault, hasDescription }
}

function stravaFailure (res, phase) {
  if (res.status === 404) return httpError(404, 'activity_not_found')
  if (res.status === 429) return httpError(429, 'strava_rate_limited')
  if (phase === 'write' && (res.status === 401 || res.status === 403)) return httpError(409, 'strava_write_scope_missing')
  if (res.status === 401 || res.status === 403) return httpError(502, 'strava_auth')
  return httpError(502, 'strava_error')
}

/**
 * The annotator: `annotate(id, { name?, description?, dryRun, overwrite })` → the decision and what was written.
 * `pool` (optional) keeps the stored row's name in step after a rename.
 */
export function createActivityAnnotator ({ getAccessToken, pool = null, fetchImpl = fetch, log = console.log }) {
  async function call (method, id, body) {
    let token
    try {
      token = await getAccessToken()
    } catch (err) {
      log(JSON.stringify({ event: 'strava_annotate_failed', message: err.message }))
      throw httpError(502, 'strava_auth')
    }
    try {
      return await send(method, id, body, token)
    } catch (err) {
      log(JSON.stringify({ event: 'strava_annotate_failed', message: err.message }))
      throw httpError(502, 'strava_network')
    }
  }

  function send (method, id, body, token) {
    const headers = { authorization: `Bearer ${token}` }
    if (body) headers['content-type'] = 'application/json'
    return fetchImpl(ACTIVITY_URL + id, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
  }

  return async function annotate (id, wanted) {
    const read = await call('GET', id)
    if (!read.ok) throw stravaFailure(read, 'read')
    const current = await read.json()
    const { fields, currentName, currentDescription, nameIsDefault, hasDescription } = decideAnnotation(current, wanted)
    const result = {
      id: String(id),
      current_name: currentName,
      current_description: currentDescription,
      name_is_default: nameIsDefault,
      had_description: hasDescription,
      name_changed: 'name' in fields,
      description_changed: 'description' in fields,
      dry_run: wanted.dryRun,
      overwrite: wanted.overwrite === true
    }
    if (wanted.dryRun || Object.keys(fields).length === 0) return { ...result, updated: false }

    const write = await call('PUT', id, fields)
    if (!write.ok) throw stravaFailure(write, 'write')
    await write.text().catch(() => '')
    if (fields.name && pool) {
      try {
        await pool.query(
          `UPDATE strava_activity SET name = $2, payload = jsonb_set(payload, '{name}', to_jsonb($2::text)) WHERE id = $1`,
          [String(id), fields.name]
        )
      } catch (err) {
        // Strava already holds the new name; the next pull of this activity stores it anyway
        log(JSON.stringify({ event: 'strava_annotate_store_failed', message: err.message }))
      }
    }
    log(JSON.stringify({ event: 'strava_annotated', id: String(id), name: 'name' in fields, description: 'description' in fields }))
    return { ...result, updated: true }
  }
}

/**
 * The route module (server.js `stravaAnnotateRoutes`): `handle(req, res, url)` → true when it answered.
 * `annotate` is null when Strava is not configured (409 strava not configured, like POST /sync/strava).
 */
export function createStravaAnnotateRoutes ({ checkBearer, annotate }) {
  return {
    async handle (req, res, url) {
      const m = ROUTE_RE.exec(url.pathname)
      if (!m) return false
      if (!checkBearer(req)) {
        req.resume()
        writeJson(res, 401, { error: 'unauthorized' })
        return true
      }
      if (req.method !== 'POST') {
        req.resume()
        writeJson(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' })
        return true
      }
      if (!annotate) {
        req.resume()
        writeJson(res, 409, { error: 'strava not configured' })
        return true
      }
      try {
        if (!isJson(req)) throw httpError(415, 'json_required')
        const wanted = parseAnnotateBody(await readJson(req, ANNOTATE_BODY_LIMIT))
        const result = await annotate(m[1], wanted)
        writeJson(res, 200, { ok: true, ...result })
      } catch (err) {
        if (!err.code || !err.status) throw err
        if (err.status === 415) req.resume()
        writeJson(res, err.status, { error: err.code, ...(err.field ? { field: err.field } : {}) })
      }
      return true
    }
  }
}
