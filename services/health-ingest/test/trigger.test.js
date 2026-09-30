import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRateLimiter, createTriggerWriter, createSyncTrigger } from '../src/trigger.js'

function clock (start = Date.parse('2030-01-02T10:00:00Z')) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

function fakeStatus () {
  const calls = []
  return { calls, recordTrigger: async (iso) => { calls.push(iso) } }
}

test('rate limiter allows one take per interval and reports the seconds left', () => {
  const c = clock()
  const limiter = createRateLimiter({ intervalMs: 60_000, now: c.now })

  assert.deepEqual(limiter.take(), { ok: true })
  c.advance(15_500)
  assert.deepEqual(limiter.take(), { ok: false, retryAfterSec: 45 })
  c.advance(44_500)
  assert.deepEqual(limiter.take(), { ok: true }, 'exactly one interval later a new take is allowed')
})

test('a refused take does not extend the window', () => {
  const c = clock()
  const limiter = createRateLimiter({ intervalMs: 60_000, now: c.now })
  limiter.take()
  c.advance(59_000)
  assert.equal(limiter.take().ok, false)
  c.advance(1_000)
  assert.equal(limiter.take().ok, true)
})

test('trigger writer writes the request time into <dir>/refresh', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'trigger-'))
  try {
    const write = createTriggerWriter({ dir })
    await write('2030-01-02T10:00:00.000Z')
    assert.equal(await readFile(path.join(dir, 'refresh'), 'utf8'), '2030-01-02T10:00:00.000Z\n')
    await write('2030-01-02T10:05:00.000Z')
    assert.equal(await readFile(path.join(dir, 'refresh'), 'utf8'), '2030-01-02T10:05:00.000Z\n', 'rewritten, not appended')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POST /sync: 202, starts Strava, writes the trigger once Strava settles', async () => {
  const c = clock()
  const order = []
  let finishStrava
  const status = fakeStatus()
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: c.now }),
    runStrava: () => { order.push('strava'); return new Promise((resolve) => { finishStrava = resolve }) },
    writeTrigger: async (iso) => { order.push(`trigger ${iso}`) },
    status,
    now: c.now,
    log: () => {}
  })

  const res = trigger.handle()
  assert.equal(res.status, 202)
  assert.deepEqual(res.body, { ok: true, strava: 'started', requestedAt: '2030-01-02T10:00:00.000Z' })
  assert.deepEqual(order, ['strava'], 'the trigger waits for the Strava pull, so the rebuild sees it')

  finishStrava({ count: 3 })
  await res.done
  assert.deepEqual(order, ['strava', 'trigger 2030-01-02T10:00:00.000Z'])
  assert.deepEqual(status.calls, ['2030-01-02T10:00:00.000Z'])
})

test('POST /sync: a failed Strava pull still writes the trigger (rebuild from what is stored)', async () => {
  const written = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: Date.now }),
    runStrava: async () => { throw new Error('strava token refresh failed: 401') },
    writeTrigger: async (iso) => { written.push(iso) },
    status: fakeStatus(),
    log: () => {}
  })
  await trigger.handle().done
  assert.equal(written.length, 1)
})

test('POST /sync: a hung Strava pull cannot hold the trigger past waitMs', async () => {
  const written = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: Date.now }),
    runStrava: () => new Promise(() => {}),
    writeTrigger: async (iso) => { written.push(iso) },
    status: fakeStatus(),
    waitMs: 20,
    log: () => {}
  })
  await trigger.handle().done
  assert.equal(written.length, 1)
})

test('POST /sync without Strava configured writes the trigger straight away', async () => {
  const written = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: Date.now }),
    runStrava: null,
    writeTrigger: async (iso) => { written.push(iso) },
    status: fakeStatus(),
    log: () => {}
  })
  const res = trigger.handle()
  assert.equal(res.body.strava, 'disabled')
  await res.done
  assert.equal(written.length, 1)
})

test('POST /sync twice inside 60 s: second answers 429 with Retry-After and does no work', async () => {
  const c = clock()
  let stravaRuns = 0
  const written = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: c.now }),
    runStrava: async () => { stravaRuns += 1 },
    writeTrigger: async (iso) => { written.push(iso) },
    status: fakeStatus(),
    now: c.now,
    log: () => {}
  })
  await trigger.handle().done
  c.advance(10_000)
  const second = trigger.handle()
  assert.equal(second.status, 429)
  assert.equal(second.retryAfterSec, 50)
  assert.deepEqual(second.body, { error: 'rate limited', retryAfterSec: 50 })
  await second.done
  assert.equal(stravaRuns, 1)
  assert.equal(written.length, 1)
})

test('a trigger write failure is logged, never thrown', async () => {
  const logs = []
  const trigger = createSyncTrigger({
    limiter: createRateLimiter({ intervalMs: 60_000, now: Date.now }),
    runStrava: null,
    writeTrigger: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
    status: fakeStatus(),
    log: (line) => logs.push(JSON.parse(line))
  })
  await trigger.handle().done
  assert.equal(logs.at(-1).event, 'trigger_write_failed')
  assert.equal(logs.at(-1).code, 'EACCES')
})
