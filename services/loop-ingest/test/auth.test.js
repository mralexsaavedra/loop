import test from 'node:test'
import assert from 'node:assert/strict'
import { isAuthorized, createBearerCheck } from '../src/auth.js'

const TOKEN = 'a'.repeat(64)

test('accepts a matching bearer token', () => {
  assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true)
})

test('is case-insensitive on the Bearer keyword and tolerates padding', () => {
  assert.equal(isAuthorized(`  bearer   ${TOKEN}  `, TOKEN), true)
})

test('rejects a wrong token of identical length', () => {
  assert.equal(isAuthorized(`Bearer ${'b'.repeat(64)}`, TOKEN), false)
})

test('rejects a token that is a prefix of the expected one', () => {
  assert.equal(isAuthorized(`Bearer ${'a'.repeat(63)}`, TOKEN), false)
})

test('rejects a missing or malformed header', () => {
  assert.equal(isAuthorized(undefined, TOKEN), false)
  assert.equal(isAuthorized('', TOKEN), false)
  assert.equal(isAuthorized(TOKEN, TOKEN), false, 'raw token without the Bearer scheme')
  assert.equal(isAuthorized(`Basic ${TOKEN}`, TOKEN), false)
})

test('refuses to authorize when no token is configured', () => {
  assert.equal(isAuthorized('Bearer anything', undefined), false)
  assert.equal(isAuthorized('Bearer ', ''), false)
})

// C8: a failed bearer check is logged as a counted event, never with the token
test('checkBearer logs every failure as a counted `unauthorized` event without the presented token', () => {
  const lines = []
  const log = (l) => lines.push(JSON.parse(l))
  const guard = createBearerCheck(TOKEN, { log })
  const req = (authorization, url = '/export/raw?since=2030-01-01') => ({ url, headers: authorization === undefined ? {} : { authorization }, socket: { remoteAddress: '192.168.1.20' } })

  assert.equal(guard(req(`Bearer ${TOKEN}`)), true)
  assert.equal(lines.length, 0, 'a good token logs nothing')

  const wrong = 'z'.repeat(64)
  assert.equal(guard(req(`Bearer ${wrong}`)), false)
  assert.equal(guard(req(undefined, '/ingest/health-auto-export')), false)
  assert.equal(guard(req(`Basic ${wrong}`)), false)
  assert.deepEqual(lines, [
    { event: 'unauthorized', path: '/export/raw', reason: 'invalid', remote: '192.168.1.20', count: 1 },
    { event: 'unauthorized', path: '/ingest/health-auto-export', reason: 'missing', remote: '192.168.1.20', count: 2 },
    { event: 'unauthorized', path: '/export/raw', reason: 'malformed', remote: '192.168.1.20', count: 3 }
  ])
  assert.ok(!JSON.stringify(lines).includes(wrong), 'the presented token never reaches the log')
  assert.ok(!JSON.stringify(lines).includes(TOKEN), 'nor the configured one')
})
