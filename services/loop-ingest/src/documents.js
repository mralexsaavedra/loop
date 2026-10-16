/**
 * The owner's documents under /documents/:kind (sql/012_documents.sql): `plan` (the nutrition plan, was
 * data/nutrition/plan-data.json), `training` (the training program, was data/training/training-data.json) and
 * `profile` (was profile/profile.json).
 *
 *   GET /documents/:kind  -> 200 {kind, document, revision, updatedAt}; before the first save document null,
 *                            revision 0, updatedAt null
 *   PUT /documents/:kind  {revision, document} -> 200 {kind, revision, updatedAt}; 409 {error:
 *                            'revision_conflict', revision} when `revision` is not the stored one (0 = none yet)
 *
 * Security: bearer token only (INGEST_TOKEN, the same checker as /export/* and /ingest), checked before
 * anything else, so an unknown kind or an unavailable group never answers a client without the token. The
 * clients are the coach (`npm run sync` and its push command) and the server's own page build, never the
 * browser, so loop-web's nginx does not proxy /documents/*. Content-Type must be application/json.
 *
 * Validation is STRUCTURAL here (validateDocument: the top-level shape each kind needs, no U+0000): the full
 * rules live in lib/ (validateNutrition needs ingredients.json, validateProgram, validateManual), which this
 * image cannot import. The coach runs them before a PUT and the page build runs them again, so a document
 * that passes here but breaks a rule is caught before it reaches the page.
 *
 * The body limit is DOCUMENT_BODY_LIMIT (256 KB): a personal plan is ~36 KB, above the 16 KB of the page
 * routes. Logs carry the shape of a save (kind, revision, bytes), never its content.
 */
import { send, readJson, isJson, httpError, containsNul } from './http.js'

export const DOCUMENT_KINDS = Object.freeze(['plan', 'training', 'profile'])
export const DOCUMENT_BODY_LIMIT = 256 * 1024

const PATH_RE = /^\/documents\/([^/]+)$/
const METHODS = ['GET', 'PUT']
// the top-level objects each kind cannot do without (lib/load/inputs.mjs, lib/nutrition/macros.mjs,
// lib/training/program.mjs); a profile may be empty
const REQUIRED_OBJECTS = { plan: ['data', 'targets', 'dayPlan'], training: ['days'], profile: [] }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The field that breaks the kind's top-level shape ('document' when it is not an object), or null. */
export function validateDocument (kind, doc) {
  if (!isObject(doc)) return 'document'
  for (const key of REQUIRED_OBJECTS[kind]) if (!isObject(doc[key])) return key
  return null
}

function invalid (field, reason) {
  return Object.assign(httpError(400, 'invalid', field), reason ? { reason } : {})
}

/** {revision, document} from a PUT body, or a 400 naming the first bad field. */
function parsePut (kind, body) {
  if (!isObject(body)) throw invalid('document')
  for (const key of Object.keys(body)) if (key !== 'revision' && key !== 'document') throw invalid(key)
  const { revision, document } = body
  if (!Number.isInteger(revision) || revision < 0) throw invalid('revision')
  const field = validateDocument(kind, document)
  if (field) throw invalid(field)
  if (containsNul(document)) throw invalid('document', 'nul_character')
  return { revision, document }
}

function sendError (err, req, res, log) {
  if (res.headersSent) return
  if (err?.status && err.code) {
    const body = { error: err.code }
    if (err.field) body.field = err.field
    if (err.reason) body.reason = err.reason
    if (err.revision != null) body.revision = err.revision
    if (err.status === 413) {
      // stop reading an oversized upload: answer, then drop the connection
      res.on('finish', () => req.destroy())
      send(res, 413, body, { connection: 'close' })
      return
    }
    req.resume()
    send(res, err.status, body)
    return
  }
  log(JSON.stringify({ event: 'documents_error', message: err?.message ?? String(err) }))
  req.resume()
  send(res, 500, { error: 'internal' })
}

export function createDocumentRoutes ({ store, available = () => true, checkBearer, log = console.log }) {
  async function dispatch (req, res, kind) {
    if (req.method === 'GET') {
      req.resume()
      const row = await store.get(kind)
      return send(res, 200, { kind, document: row?.data ?? null, revision: row?.revision ?? 0, updatedAt: row?.updatedAt ?? null })
    }
    if (!isJson(req)) throw httpError(415, 'unsupported_media_type')
    const { revision, document } = parsePut(kind, await readJson(req, DOCUMENT_BODY_LIMIT))
    const saved = await store.put(kind, document, revision)
    if (!saved) {
      const current = await store.get(kind)
      throw Object.assign(httpError(409, 'revision_conflict'), { revision: current?.revision ?? 0 })
    }
    log(JSON.stringify({ event: 'document_saved', kind, revision: saved.revision, bytes: Buffer.byteLength(JSON.stringify(document)) }))
    return send(res, 200, { kind, revision: saved.revision, updatedAt: saved.updatedAt })
  }

  return {
    /** Handles /documents and /documents/*; false for any other path (the caller keeps routing). */
    async handle (req, res, url) {
      const path = url.pathname
      if (path !== '/documents' && !path.startsWith('/documents/')) return false
      try {
        if (!checkBearer(req)) throw httpError(401, 'unauthorized')
        const kind = PATH_RE.exec(path)?.[1]
        if (!DOCUMENT_KINDS.includes(kind)) throw httpError(404, 'not_found')
        if (!available()) throw httpError(503, 'documents_unavailable')
        if (!METHODS.includes(req.method)) {
          req.resume()
          send(res, 405, { error: 'method_not_allowed' }, { allow: METHODS.join(', ') })
          return true
        }
        await dispatch(req, res, kind)
      } catch (err) {
        sendError(err, req, res, log)
      }
      return true
    }
  }
}
