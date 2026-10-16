/**
 * Postgres access for the owner's documents (sql/012_documents.sql): one row per kind with its JSON document,
 * a revision counter and updated_at. Every query is parameterized. Validation lives in documents.js; this
 * module only stores what it is given.
 *
 * put() is a compare-and-set on the revision: `expected` 0 inserts the first row (nothing when one exists),
 * any other value updates only the row still at that revision. A lost race returns null (the route's 409);
 * never an overwrite.
 */

function rowOf (r) {
  if (!r) return null
  const d = new Date(r.updated_at)
  return { data: r.data, revision: Number(r.revision), updatedAt: Number.isNaN(d.getTime()) ? null : d.toISOString() }
}

export function createDocumentStore (pool) {
  return {
    /** The kind's row ({data, revision, updatedAt}) or null before its first save. */
    async get (kind) {
      const { rows } = await pool.query('SELECT data, revision, updated_at FROM app_document WHERE kind = $1', [kind])
      return rowOf(rows[0])
    },

    /** Saves `data` when the stored revision is `expected` (0 = no row yet): the new row, or null on a conflict. */
    async put (kind, data, expected) {
      const json = JSON.stringify(data)
      const { rows } = expected === 0
        ? await pool.query(
          `INSERT INTO app_document (kind, data, revision) VALUES ($1, $2, 1)
           ON CONFLICT (kind) DO NOTHING
           RETURNING data, revision, updated_at`,
          [kind, json])
        : await pool.query(
          `UPDATE app_document SET data = $2, revision = revision + 1, updated_at = now()
           WHERE kind = $1 AND revision = $3
           RETURNING data, revision, updated_at`,
          [kind, json, expected])
      return rowOf(rows[0])
    }
  }
}
