/**
 * Postgres access for the behaviour journal (sql/010_journal.sql). Every query is parameterized; the
 * date comes back as a YYYY-MM-DD string (to_char, so no timezone ever shifts it), timestamps as ISO.
 * Validation lives in journal.js; this module only stores what it is given.
 */
const DAY_COLS = "to_char(date, 'YYYY-MM-DD') AS date, answers, notes, updated_at"

function iso (v) {
  if (v == null) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function dayFromRow (r) {
  const answers = r && r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers) ? r.answers : {}
  return { date: r.date, answers, notes: r.notes ?? null, updatedAt: iso(r.updated_at) }
}

export function createJournalStore (pool) {
  return {
    /** The stored day, or null when the date was never journaled. */
    async getDay (date) {
      const { rows } = await pool.query(`SELECT ${DAY_COLS} FROM journal_day WHERE date = $1::date`, [date])
      return rows[0] ? dayFromRow(rows[0]) : null
    },

    /** Full replace of one day (idempotent upsert). */
    async putDay ({ date, answers, notes }) {
      const { rows } = await pool.query(
        `INSERT INTO journal_day (date, answers, notes) VALUES ($1::date, $2::jsonb, $3)
         ON CONFLICT (date) DO UPDATE SET answers = EXCLUDED.answers, notes = EXCLUDED.notes, updated_at = now()
         RETURNING ${DAY_COLS}`,
        [date, JSON.stringify(answers), notes]
      )
      return dayFromRow(rows[0])
    },

    /** An emptied day (no answer, no note) is removed: "not journaled" again. */
    async deleteDay (date) {
      await pool.query('DELETE FROM journal_day WHERE date = $1::date', [date])
    },

    async listRange (from, to) {
      const { rows } = await pool.query(
        `SELECT ${DAY_COLS} FROM journal_day WHERE date BETWEEN $1::date AND $2::date ORDER BY date`,
        [from, to]
      )
      return rows.map(dayFromRow)
    },

    /** The switched-off behaviour keys (no row yet = none). */
    async getDisabled () {
      const { rows } = await pool.query('SELECT disabled FROM journal_settings WHERE id = 1')
      return Array.isArray(rows[0]?.disabled) ? rows[0].disabled : []
    },

    async setDisabled (disabled) {
      const { rows } = await pool.query(
        `INSERT INTO journal_settings (id, disabled) VALUES (1, $1::text[])
         ON CONFLICT (id) DO UPDATE SET disabled = EXCLUDED.disabled, updated_at = now()
         RETURNING disabled`,
        [disabled]
      )
      return Array.isArray(rows[0]?.disabled) ? rows[0].disabled : []
    }
  }
}
