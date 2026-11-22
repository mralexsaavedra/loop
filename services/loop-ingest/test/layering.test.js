// Guard: the persistence modules (src/*-db.js) hold the SQL and never call the network; the Strava modules
// that call Strava (and the annotate route) hold no SQL of their own, they call their *-db.js module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const source = (file) => readFileSync(new URL(file, SRC), 'utf8')
// a SQL call: pool.query(, client.query(, pool.connect(
const SQL_CALL = /\b(?:pool|client)\.(?:query|connect)\s*\(/

test('no persistence module (src/*-db.js) calls fetch', () => {
  const dbFiles = readdirSync(SRC).filter((f) => f.endsWith('-db.js'))
  assert.ok(dbFiles.length >= 7, dbFiles.join(', '))
  assert.deepEqual(dbFiles.filter((f) => /\bfetch(?:Impl)?\s*\(/.test(source(f))), [])
})

test('the Strava modules run no SQL of their own', () => {
  const stravaModules = ['athlete.js', 'hr-zones.js', 'strava.js', 'strava-annotate.js']
  assert.deepEqual(stravaModules.filter((f) => SQL_CALL.test(source(f))), [])
})
