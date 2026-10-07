import test from 'node:test'
import assert from 'node:assert/strict'
import { createWindowLimiter, createTokenBucket } from '../src/limits.js'

function clock (t = 0) {
  const c = () => c.t
  c.t = t
  return c
}

test('window limiter: limit per key per window, keys independent, a new window resets', () => {
  const now = clock(1000)
  const l = createWindowLimiter({ limit: 2, windowMs: 60_000, now })
  assert.equal(l.take('a'), true)
  assert.equal(l.take('a'), true)
  assert.equal(l.take('a'), false, 'third in the window')
  assert.equal(l.take('b'), true, 'another key has its own window')
  now.t += 59_999
  assert.equal(l.take('a'), false, 'still the same window')
  now.t += 1
  assert.equal(l.take('a'), true, 'window elapsed')
})

test('window limiter: the key map stays bounded (expired first, then the oldest key)', () => {
  const now = clock(0)
  const l = createWindowLimiter({ limit: 1, windowMs: 1000, now, maxKeys: 2 })
  assert.equal(l.take('a'), true)
  assert.equal(l.take('b'), true)
  assert.equal(l.take('c'), true, 'map full: oldest key evicted, c admitted')
  assert.equal(l.take('b'), false, 'b survived the eviction and is still limited')
  assert.equal(l.take('a'), true, 'a was evicted, so it starts a fresh window')
  now.t = 5000
  assert.equal(l.take('d'), true, 'expired windows are pruned first')
  assert.equal(l.take('d'), false)
})

test('token bucket: starts full, refills continuously up to capacity', () => {
  const now = clock(0)
  const b = createTokenBucket({ capacity: 3, perMs: 60_000, now })
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false])
  now.t += 19_999
  assert.equal(b.take(), false, 'just under one token refilled')
  now.t += 1
  assert.equal(b.take(), true, 'one token after perMs / capacity')
  now.t += 10 * 60_000
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false], 'never above capacity')
})
