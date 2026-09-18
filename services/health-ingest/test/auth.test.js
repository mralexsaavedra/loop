import test from 'node:test'
import assert from 'node:assert/strict'
import { isAuthorized } from '../src/auth.js'

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
