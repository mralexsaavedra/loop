import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createTriggerWriter, createSyncTrigger, parseTriggerSeq, readTriggerSeq,
  MIN_TRIGGER_INTERVAL_MS, MIN_STRAVA_INTERVAL_MS
} from '../src/trigger.js'

function clock (start = Date.parse('2030-01-02T10:00:00Z')) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

/** In-memory stand-in for status.js: just the calls the trigger makes. */
function fakeStatus ({ seq = 0, stravaOkAgoMs = null } = {}) {
  const events = []
  const s = {
    events,
    seq,
    currentSeq: () => s.seq,
    nextTriggerSeq: () => { s.seq += 1; return s.seq },
    stravaFresh: (ms) => stravaOkAgoMs != null && stravaOkAgoMs < ms,
    recordTrigger: async (n) => { events.push(`trigger ${n}`) },
    recordTriggerError: async (n) => { events.push(`trigger_error ${n}`) }
  }
  return s
}

async function withDir (fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'trigger-'))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('interval constants: >= 60 s between trigger writes, >= 5 min between Strava pulls', () => {
  assert.equal(MIN_TRIGGER_INTERVAL_MS, 60_000)
  assert.equal(MIN_STRAVA_INTERVAL_MS, 5 * 60_000)
})

test('parseTriggerSeq accepts only a plain sequence number line', () => {
  assert.equal(parseTriggerSeq('7\n'), 7)
  assert.equal(parseTriggerSeq('42'), 42)
  assert.equal(parseTriggerSeq(''), 0)
  assert.equal(parseTriggerSeq('2030-01-02T10:00:00.000Z\n'), 0, 'the old timestamp format is not a sequence')
  assert.equal(parseTriggerSeq('-3\n'), 0)
  assert.equal(parseTriggerSeq('1'.repeat(20)), 0, 'absurdly long values are rejected')
  assert.equal(parseTriggerSeq(undefined), 0)
})

test('trigger writer writes "seq\\n" atomically (no temp file left) and rewrites, never appends', () => withDir(async (dir) => {
  const write = createTriggerWriter({ dir })
  await write(1)
  assert.equal(await readFile(path.join(dir, 'refresh'), 'utf8'), '1\n')
  await write(2)
  assert.equal(await readFile(path.join(dir, 'refresh'), 'utf8'), '2\n')
  assert.deepEqual(await readdir(dir), ['refresh'])
  assert.equal(await readTriggerSeq(dir), 2)
}))

test('readTriggerSeq: a missing or garbled file reads as 0', () => withDir(async (dir) => {
  assert.equal(await readTriggerSeq(dir), 0)
  await writeFile(path.join(dir, 'refresh'), 'garbage\n')
  assert.equal(await readTriggerSeq(dir), 0)
}))

test('trigger writer refuses a symlinked target and leaves the link target untouched', () => withDir(async (dir) => {
  const victim = path.join(dir, 'victim')
  await writeFile(victim, 'keep me\n')
  await symlink(victim, path.join(dir, 'refresh'))
  const write = createTriggerWriter({ dir })
  await assert.rejects(write(5), (err) => err.code === 'ESYMLINK')
  assert.equal(await readFile(victim, 'utf8'), 'keep me\n')
  assert.deepEqual((await readdir(dir)).sort(), ['refresh', 'victim'], 'no temp file left behind')
}))

test('POST /sync: 202 {seq, coalesced:false}; Strava runs first, then the trigger carries the seq', async () => {
  const c = clock()
  const order = []
  let finishStrava
  const status = fakeStatus({ seq: 4 })
  const trigger = createSyncTrigger({
    runStrava: () => { order.push('strava'); return new Promise((resolve) => { finishStrava = resolve }) },
    writeTrigger: async (seq) => { order.push(`write ${seq}`) },
    status,
    now: c.now,
    log: () => {}
  })

  const res = trigger.handle()
  assert.equal(res.status, 202)
  assert.deepEqual(res.body, { ok: true, seq: 5, coalesced: false, strava: 'started' })
  assert.deepEqual(order, ['strava'])
  finishStrava({ count: 3 })
  await res.done
  assert.deepEqual(order, ['strava', 'write 5'])
  assert.deepEqual(status.events, ['trigger 5'])
})

test('a click while the previous trigger is still pending coalesces onto it and does nothing else', async () => {
  const c = clock()
  let stravaRuns = 0
  let finishStrava
  const written = []
  const trigger = createSyncTrigger({
    runStrava: () => { stravaRuns += 1; return new Promise((resolve) => { finishStrava = resolve }) },
    writeTrigger: async (seq) => { written.push(seq) },
    status: fakeStatus(),
    now: c.now,
    waitMs: 10 * 60_000,
    log: () => {}
  })
  const first = trigger.handle()
  c.advance(2 * 60_000) // past the write interval, but the first trigger is not written yet
  const second = trigger.handle()
  assert.deepEqual(second.body, { ok: true, seq: 1, coalesced: true })
  finishStrava()
  await first.done
  await second.done
  assert.equal(stravaRuns, 1)
  assert.deepEqual(written, [1])
})

test('within 60 s of a trigger write, clicks coalesce onto the current seq (never 429)', async () => {
  const c = clock()
  const written = []
  const trigger = createSyncTrigger({
    runStrava: null,
    writeTrigger: async (seq) => { written.push(seq) },
    status: fakeStatus(),
    now: c.now,
    log: () => {}
  })
  await trigger.handle().done
  for (let i = 0; i < 50; i++) {
    c.advance(1_000)
    const res = trigger.handle()
    assert.equal(res.status, 202)
    assert.deepEqual(res.body, { ok: true, seq: 1, coalesced: true })
    await res.done
  }
  assert.deepEqual(written, [1], 'a flood costs at most one rebuild per minute')
  c.advance(10_000) // 60 s after the first write
  const next = trigger.handle()
  assert.deepEqual(next.body, { ok: true, seq: 2, coalesced: false, strava: 'disabled' })
  await next.done
  assert.deepEqual(written, [1, 2])
})

test('Strava is pulled at most once per 5 min: a recent success skips the pull, the trigger is still written', async () => {
  let stravaRuns = 0
  const written = []
  const trigger = createSyncTrigger({
    runStrava: async () => { stravaRuns += 1 },
    writeTrigger: async (seq) => { written.push(seq) },
    status: fakeStatus({ stravaOkAgoMs: 4 * 60_000 }),
    log: () => {}
  })
  const res = trigger.handle()
  assert.equal(res.body.strava, 'recent')
  await res.done
  assert.equal(stravaRuns, 0)
  assert.deepEqual(written, [1])
})

test('a Strava success older than 5 min is pulled again', async () => {
  let stravaRuns = 0
  const trigger = createSyncTrigger({
    runStrava: async () => { stravaRuns += 1 },
    writeTrigger: async () => {},
    status: fakeStatus({ stravaOkAgoMs: 5 * 60_000 }),
    log: () => {}
  })
  await trigger.handle().done
  assert.equal(stravaRuns, 1)
})

test('a failed Strava pull still writes the trigger (rebuild from what is stored)', async () => {
  const written = []
  const trigger = createSyncTrigger({
    runStrava: async () => { throw new Error('strava token refresh failed: 401') },
    writeTrigger: async (seq) => { written.push(seq) },
    status: fakeStatus(),
    log: () => {}
  })
  await trigger.handle().done
  assert.deepEqual(written, [1])
})

test('a hung Strava pull cannot hold the trigger past waitMs', async () => {
  const written = []
  const trigger = createSyncTrigger({
    runStrava: () => new Promise(() => {}),
    writeTrigger: async (seq) => { written.push(seq) },
    status: fakeStatus(),
    waitMs: 20,
    log: () => {}
  })
  await trigger.handle().done
  assert.deepEqual(written, [1])
})

test('a trigger write failure is recorded as trigger_write for that seq and logged, never thrown', async () => {
  const logs = []
  const status = fakeStatus()
  const trigger = createSyncTrigger({
    runStrava: null,
    writeTrigger: async () => { throw Object.assign(new Error('EACCES: permission denied, open /trigger/x'), { code: 'EACCES' }) },
    status,
    log: (line) => logs.push(JSON.parse(line))
  })
  await trigger.handle().done
  assert.deepEqual(status.events, ['trigger_error 1'])
  assert.equal(logs.at(-1).event, 'trigger_write_failed')
  assert.equal(logs.at(-1).code, 'EACCES')
})
