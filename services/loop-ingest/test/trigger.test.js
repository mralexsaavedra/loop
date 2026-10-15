import test, { mock } from 'node:test'
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

const T0 = Date.parse('2030-01-02T10:00:00Z')

/** Fake clock AND fake setTimeout, so the deferred write can be driven by tick(). */
function withFakeTimers (fn) {
  return async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 })
    try { await fn() } finally { mock.timers.reset() }
  }
}

/** Lets the promise chain that a fired timer started run to completion. */
async function drain () {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function deferredSetup ({ runStrava = null, status = fakeStatus({ seq: 1 }), waitMs } = {}) {
  const written = []
  const logs = []
  const trigger = createSyncTrigger({
    runStrava,
    writeTrigger: async (seq) => { written.push({ seq, at: Date.now() - T0 }) },
    status,
    now: () => Date.now(),
    ...(waitMs != null ? { waitMs } : {}),
    log: (line) => logs.push(JSON.parse(line))
  })
  return { trigger, written, status, logs }
}

test('a click 19 s after an accepted one is NOT dropped: it gets a NEW deferred seq written at t0+60 s', withFakeTimers(async () => {
  const { trigger, written, status } = deferredSetup()
  const first = trigger.handle()
  assert.deepEqual(first.body, { ok: true, seq: 2, coalesced: false, strava: 'disabled' })
  await first.done
  assert.deepEqual(written, [{ seq: 2, at: 0 }])

  mock.timers.tick(19_000)
  const late = trigger.handle()
  assert.equal(late.status, 202)
  assert.deepEqual(late.body, { ok: true, seq: 3, coalesced: true, deferred: true })

  mock.timers.tick(40_999)
  await drain()
  assert.equal(written.length, 1, 'nothing is written before the 60 s window closes')
  mock.timers.tick(1)
  await late.done
  assert.deepEqual(written, [{ seq: 2, at: 0 }, { seq: 3, at: 60_000 }])
  assert.deepEqual(status.events, ['trigger 2', 'trigger 3'])
}))

test('several clicks inside the window share ONE deferred seq (no pile-up, one write)', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup()
  await trigger.handle().done
  const answers = []
  for (const gap of [5_000, 10_000, 30_000]) {
    mock.timers.tick(gap)
    answers.push(trigger.handle())
  }
  assert.deepEqual(answers.map((a) => a.body), [
    { ok: true, seq: 3, coalesced: true, deferred: true },
    { ok: true, seq: 3, coalesced: true, deferred: true },
    { ok: true, seq: 3, coalesced: true, deferred: true }
  ])
  mock.timers.tick(15_000)
  await Promise.all(answers.map((a) => a.done))
  assert.deepEqual(written.map((w) => w.seq), [2, 3])
  mock.timers.tick(10 * 60_000)
  await drain()
  assert.equal(written.length, 2, 'no further write without a new click')
}))

test('a flood keeps the cost bound: at most one trigger write per 60 s window', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup()
  await trigger.handle().done
  for (let i = 0; i < 180; i++) {
    mock.timers.tick(1_000)
    const res = trigger.handle()
    assert.equal(res.status, 202, 'never 429')
    await drain() // real requests are spread out: let a fired write finish
  }
  await drain()
  const at = written.map((w) => w.at)
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 60_000, `writes ${at[i - 1]} -> ${at[i]} are >= 60 s apart`)
  assert.deepEqual(written.map((w) => w.seq), [2, 3, 4, 5])
}))

test('after the deferred write, the next click inside ITS window defers again from that write', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup()
  await trigger.handle().done
  mock.timers.tick(19_000)
  trigger.handle() // deferred seq 3, written at t0+60 s
  mock.timers.tick(41_000)
  await drain()
  mock.timers.tick(10_000) // t0+70 s: 10 s after the deferred write
  const res = trigger.handle()
  assert.deepEqual(res.body, { ok: true, seq: 4, coalesced: true, deferred: true })
  mock.timers.tick(50_000)
  await res.done
  assert.deepEqual(written, [{ seq: 2, at: 0 }, { seq: 3, at: 60_000 }, { seq: 4, at: 120_000 }])
}))

test('the deferred write pulls Strava only when its own 5 min cooldown allows', withFakeTimers(async () => {
  let pulls = 0
  let okAgo = null
  const status = fakeStatus({ seq: 1 })
  status.stravaFresh = (ms) => okAgo != null && okAgo < ms
  const { trigger, written } = deferredSetup({ runStrava: async () => { pulls += 1; okAgo = 0 }, status })
  const first = trigger.handle()
  assert.equal(first.body.strava, 'started')
  await first.done
  mock.timers.tick(19_000)
  okAgo = 19_000
  const late = trigger.handle()
  mock.timers.tick(41_000)
  okAgo = 60_000
  await late.done
  assert.equal(pulls, 1, 'a pull 60 s ago is within the cooldown: the deferred write skips it')
  assert.deepEqual(written.map((w) => w.seq), [2, 3])
}))

test('flush() writes a pending deferred seq at once (shutdown) and cancels its timer', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup()
  await trigger.handle().done
  mock.timers.tick(19_000)
  const late = trigger.handle()
  await trigger.flush()
  await late.done
  assert.deepEqual(written, [{ seq: 2, at: 0 }, { seq: 3, at: 19_000 }])
  mock.timers.tick(60_000)
  await drain()
  assert.equal(written.length, 2, 'the cancelled timer does not write again')
  await trigger.flush() // nothing pending: a no-op
  assert.equal(written.length, 2)
}))

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

test('flush() awaits an in-flight (non-deferred) run so its write lands before shutdown', withFakeTimers(async () => {
  let finishStrava
  const { trigger, written } = deferredSetup({
    runStrava: () => new Promise((resolve) => { finishStrava = resolve }),
    waitMs: 90_000
  })
  const res = trigger.handle()
  assert.equal(res.body.seq, 2)
  let flushed = false
  const f = trigger.flush().then(() => { flushed = true })
  mock.timers.tick(1_000)
  await drain()
  assert.equal(flushed, false, 'flush waits for the in-flight run')
  assert.equal(written.length, 0)
  finishStrava()
  await f
  assert.deepEqual(written, [{ seq: 2, at: 1_000 }])
}))

test('flush(): when the in-flight run outlives its budget, the persisted seq is written directly (no Strava)', withFakeTimers(async () => {
  let pulls = 0
  const { trigger, written, logs } = deferredSetup({
    runStrava: () => { pulls += 1; return new Promise(() => {}) }, // hung pull
    waitMs: 90_000
  })
  trigger.handle() // seq 2, stuck behind the hung pull
  const f = trigger.flush({ waitMs: 2_000 })
  mock.timers.tick(1_999)
  await drain()
  assert.equal(written.length, 0)
  mock.timers.tick(1)
  await f
  assert.deepEqual(written, [{ seq: 2, at: 2_000 }], 'file seq now matches the persisted seq')
  assert.equal(pulls, 1, 'no extra Strava pull')
  assert.ok(logs.some((l) => l.event === 'sync_flush_forced' && l.seq === 2))
}))

test('flush() with nothing pending or in flight is a no-op', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup()
  await trigger.flush()
  assert.equal(written.length, 0)
  await trigger.handle().done
  await trigger.flush()
  assert.equal(written.length, 1)
}))

test('boot recovery: a DB seq ahead of the trigger file is written once, after the boot delay', withFakeTimers(async () => {
  const { trigger, written, status } = deferredSetup({ status: fakeStatus({ seq: 7 }) })
  const done = trigger.recover({ fileSeq: 5, delayMs: 5_000 })
  mock.timers.tick(4_999)
  await drain()
  assert.equal(written.length, 0)
  mock.timers.tick(1)
  await done
  assert.deepEqual(written, [{ seq: 7, at: 5_000 }])
  assert.equal(status.seq, 7, 'no new seq is handed out')
  mock.timers.tick(10 * 60_000)
  await drain()
  assert.equal(written.length, 1, 'written once')
}))

test('boot recovery respects the min interval since the last recorded write', withFakeTimers(async () => {
  const { trigger, written } = deferredSetup({ status: fakeStatus({ seq: 7 }) })
  const done = trigger.recover({ fileSeq: 6, delayMs: 5_000, lastWrittenAt: T0 - 20_000 })
  mock.timers.tick(39_999)
  await drain()
  assert.equal(written.length, 0)
  mock.timers.tick(1)
  await done
  assert.deepEqual(written, [{ seq: 7, at: 40_000 }])
}))

test('boot recovery: nothing to do when the file already carries the seq', withFakeTimers(async () => {
  const a = deferredSetup({ status: fakeStatus({ seq: 4 }) })
  await a.trigger.recover({ fileSeq: 4, delayMs: 5_000 })
  mock.timers.tick(60_000)
  await drain()
  assert.equal(a.written.length, 0)
}))

test('boot recovery: a click during the delay shares the recovered seq (one write)', withFakeTimers(async () => {
  const b = deferredSetup({ status: fakeStatus({ seq: 4 }) })
  b.trigger.recover({ fileSeq: 3, delayMs: 5_000 })
  mock.timers.tick(1_000)
  const click = b.trigger.handle()
  assert.deepEqual(click.body, { ok: true, seq: 4, coalesced: true, deferred: true })
  mock.timers.tick(4_000)
  await click.done
  assert.deepEqual(b.written, [{ seq: 4, at: 5_000 }])
}))

test('the min interval is measured from write COMPLETION: a slow Strava pull cannot yield two writes seconds apart', withFakeTimers(async () => {
  let okAgo = null
  const status = fakeStatus({ seq: 1 })
  status.stravaFresh = (ms) => okAgo != null && okAgo < ms
  const { trigger, written } = deferredSetup({
    runStrava: () => new Promise((resolve) => setTimeout(() => { okAgo = 0; resolve() }, 59_000)),
    status,
    waitMs: 90_000
  })
  const first = trigger.handle()
  mock.timers.tick(59_000)
  await first.done
  assert.deepEqual(written, [{ seq: 2, at: 59_000 }])
  mock.timers.tick(1_000) // t0+60 s: 1 s after the write, 60 s after the run started
  okAgo = 1_000
  const next = trigger.handle()
  assert.deepEqual(next.body, { ok: true, seq: 3, coalesced: true, deferred: true })
  mock.timers.tick(58_999)
  await drain()
  assert.equal(written.length, 1)
  mock.timers.tick(1)
  await next.done
  assert.deepEqual(written, [{ seq: 2, at: 59_000 }, { seq: 3, at: 119_000 }])
}))
