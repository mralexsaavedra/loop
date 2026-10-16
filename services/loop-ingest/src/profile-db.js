/**
 * The page onboarding's storage, with ONE source for the person's identity. The wizard (PUT /food/profile, food.js
 * validateProfile) sends one document; its identity fields (IDENTITY_KEYS: name, sex, birthdate, heightCm) are
 * stored in the profile document (app_document kind 'profile', sql/012, the same one the coach pushes), and only
 * the onboarding's own fields (weight, activity, sports, goals, targets) in app_profile (sql/011). GET composes the
 * two back into the document the page and `npm run sync` have always read.
 *
 * Writes: one transaction holds both rows. The profile document is changed only when an identity value differs,
 * by merging those keys into it (every other key and the key order kept) at revision + 1, so the coach's next
 * push of an older copy is refused (documents.js) instead of silently undoing the wizard. A first document
 * created concurrently by the coach makes the insert lose: the whole save is retried (MAX_ATTEMPTS).
 *
 * moveIdentityToDocument: an onboarding row saved before this layout holds the identity itself; on start the
 * service moves it into the document (a value the document already has wins) and strips it from the row. Once;
 * a later start finds nothing to move.
 */
export const IDENTITY_KEYS = Object.freeze(['name', 'sex', 'birthdate', 'heightCm'])
const MAX_ATTEMPTS = 3

const iso = (v) => {
  const d = new Date(v)
  return v == null || Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** {own, identity}: the onboarding's own fields and the identity fields present (undefined dropped). */
export function splitProfile (data) {
  const own = {}
  const identity = {}
  // identity in IDENTITY_KEYS order (app_profile is JSONB, which reorders keys): the document gets a stable order
  for (const k of IDENTITY_KEYS) if (data[k] !== undefined) identity[k] = data[k]
  for (const [k, v] of Object.entries(data)) if (v !== undefined && !IDENTITY_KEYS.includes(k)) own[k] = v
  return { own, identity }
}

/** The page's onboarding document: the identity from the profile document, then the row's own fields, updatedAt. */
export function composeProfile (own, doc, updatedAt) {
  const identity = {}
  for (const k of IDENTITY_KEYS) if (doc && doc[k] !== undefined) identity[k] = doc[k]
  return { ...identity, ...own, updatedAt: iso(updatedAt) }
}

/** `doc` with `identity` merged in (existing keys keep their place, new ones go last), or null when nothing changes. */
function mergedDocument (doc, identity) {
  const base = doc ?? {}
  const changed = Object.entries(identity).some(([k, v]) => JSON.stringify(base[k]) !== JSON.stringify(v))
  return changed ? { ...base, ...identity } : null
}

/** Writes `data` as the profile document inside the open transaction: revision + 1, or the first row (false = lost a race). */
async function writeDocument (client, current, data) {
  if (current) {
    await client.query(
      "UPDATE app_document SET data = $1, revision = revision + 1, updated_at = now() WHERE kind = 'profile'",
      [JSON.stringify(data)])
    return true
  }
  const { rowCount } = await client.query(
    "INSERT INTO app_document (kind, data, revision) VALUES ('profile', $1, 1) ON CONFLICT (kind) DO NOTHING",
    [JSON.stringify(data)])
  return rowCount === 1
}

async function inTransaction (pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    if (result === undefined) {
      await client.query('ROLLBACK')
      return undefined
    }
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

const lockDocument = async (client) =>
  (await client.query("SELECT data FROM app_document WHERE kind = 'profile' FOR UPDATE")).rows[0] ?? null

export function createProfileStore (pool) {
  return {
    /** The composed onboarding document, or null before the wizard's first save. */
    async getProfile () {
      const { rows } = await pool.query(
        `SELECT p.data, p.updated_at, d.data AS doc
         FROM app_profile p LEFT JOIN app_document d ON d.kind = 'profile'
         WHERE p.id = 1`)
      const r = rows[0]
      return r ? composeProfile(r.data, r.doc, r.updated_at) : null
    },

    /** Saves a validated wizard document (food.js validateProfile) across the two rows; returns it composed. */
    async putProfile (data) {
      const { own, identity } = splitProfile(data)
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const saved = await inTransaction(pool, async (client) => {
          const { rows } = await client.query(
            `INSERT INTO app_profile (id, data) VALUES (1, $1)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
             RETURNING updated_at`,
            [JSON.stringify(own)])
          const current = await lockDocument(client)
          const next = mergedDocument(current?.data, identity)
          if (next && !(await writeDocument(client, current, next))) return undefined // lost the first insert: retry
          return composeProfile(own, next ?? current?.data, rows[0].updated_at)
        })
        if (saved) return saved
      }
      throw new Error('profile document kept changing; the onboarding was not saved')
    }
  }
}

/** Moves the identity of an onboarding row from before this layout into the profile document. {moved: keys}. */
export async function moveIdentityToDocument (pool, log = console.log) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await inTransaction(pool, async (client) => {
      const row = (await client.query('SELECT data FROM app_profile WHERE id = 1 FOR UPDATE')).rows[0]
      if (!row) return { moved: [] }
      const { own, identity } = splitProfile(row.data)
      const moved = Object.keys(identity)
      if (!moved.length) return { moved }
      const current = await lockDocument(client)
      const base = current?.data ?? {}
      // a value the profile document already has wins over the old onboarding copy
      const missing = Object.fromEntries(Object.entries(identity).filter(([k]) => base[k] === undefined))
      const next = mergedDocument(current?.data, missing)
      if (next && !(await writeDocument(client, current, next))) return undefined
      await client.query('UPDATE app_profile SET data = $1 WHERE id = 1', [JSON.stringify(own)])
      return { moved }
    })
    if (result) {
      if (result.moved.length) log(JSON.stringify({ event: 'profile_identity_moved', keys: result.moved }))
      return result
    }
  }
  throw new Error('profile document kept changing; the identity was not moved')
}
