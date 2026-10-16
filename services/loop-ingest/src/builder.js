/**
 * Container mode (HC_BUILD=container, the loop-server image): the page is built INSIDE this container instead of
 * on the host. The sync trigger's writer (trigger.js createSyncTrigger) becomes "run the builder for seq N": a child
 * process `node scripts/refresh.mjs --seq N --wait-lock` (the repo's refresh, which syncs from this service over
 * INGEST_URL, builds the page and publishes it with status.json into HC_SITE_DIR). Default (HC_BUILD unset) is the
 * host mode: the trigger file a systemd path unit watches (createTriggerWriter), unchanged.
 *
 * Runs are serialized: one child at a time. A request while a child runs is queued, and requests meanwhile coalesce
 * onto the HIGHEST seq (one follow-up run publishes all of them), so a click during a build is never lost and
 * never runs twice. The writer resolves as soon as the run is started or queued (the sequence protocol's
 * "trigger written"): the build itself takes minutes, and a click after that point must get a new seq, because the
 * running build may already have synced. A child that exits non-zero (or cannot start) is reported through
 * `onFailure(seq)` (status.recordTriggerError(seq, 'build')); the child's own status.json carries the precise
 * code (build / sanity / lock) for the page.
 *
 * The hourly timer (HC_REFRESH_MINUTES, default 60) replaces the host's cron line: one run shortly after boot (the
 * site volume may be empty, and a seq handed out before a crash gets published), then every interval, each for the
 * current seq (no new sequence number, like cron).
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_MODES = Object.freeze(['trigger', 'container'])
// the repo root the loop-server image ships: services/loop-ingest/src -> ../../..
export const DEFAULT_REFRESH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'refresh.mjs')
export const DEFAULT_SITE_DIR = '/site'
export const BOOT_BUILD_DELAY_MS = 5_000
const KILL_GRACE_MS = 10_000

/** HC_BUILD: unset / blank = 'trigger' (the host's trigger file), 'container' = build in this container; anything
 * else throws (main() turns it into one startup_failed line). */
export function buildMode (env) {
  const raw = String(env.HC_BUILD ?? '').trim()
  if (raw === '') return 'trigger'
  if (BUILD_MODES.includes(raw)) return raw
  throw new Error(`invalid HC_BUILD=${JSON.stringify(raw).slice(0, 40)}: expected container (or unset for the host trigger file)`)
}

/** The processedSeq of the last publish in <siteDir>/status.json, or 0 (seeds the sequence like the trigger file). */
export async function readPublishedSeq (siteDir) {
  try {
    const n = JSON.parse(await readFile(path.join(siteDir, 'status.json'), 'utf8')).processedSeq
    return Number.isSafeInteger(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * The real child: `node <script> --seq N --wait-lock` from the repo root, its output in this service's log.
 * INGEST_URL defaults to this service on loopback (the syncs inside the child call back into it). Returns
 * { child, exited } where `exited` resolves to { code, signal } (code null when it could not start).
 */
export function createRefreshSpawner ({ script = DEFAULT_REFRESH_SCRIPT, env = process.env, port = 8088, nodePath = process.execPath, log = console.log }) {
  const childEnv = { ...env, INGEST_URL: env.INGEST_URL || `http://127.0.0.1:${port}` }
  return function spawnRefresh (seq) {
    const child = spawn(nodePath, [script, '--seq', String(seq), '--wait-lock'], {
      cwd: path.resolve(path.dirname(script), '..'),
      env: childEnv,
      stdio: ['ignore', 'inherit', 'inherit']
    })
    const exited = new Promise((resolve) => {
      child.once('error', (err) => {
        log(JSON.stringify({ event: 'build_spawn_failed', seq, code: err.code ?? null, message: err.message }))
        resolve({ code: null, signal: null })
      })
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    return { child, exited }
  }
}

/**
 * The serialized builder. `spawnRefresh(seq)` -> { child, exited } (injected by the tests); `onFailure(seq)` is
 * awaited for a non-zero exit. Returns { request, writeTrigger, startTimer, idle, stop }.
 */
export function createBuilder ({ spawnRefresh, onFailure = async () => {}, log = console.log, setTimer = setTimeout, clearTimer = clearTimeout, setRepeat = setInterval, clearRepeat = clearInterval }) {
  let running = null // { seq, child, done }
  let queued = null // the highest seq requested while a child runs
  let stopped = false
  let timers = []
  const waiters = []

  function settleIdle () {
    if (running || queued != null) return
    while (waiters.length) waiters.shift()()
  }

  function start (seq) {
    let spawned
    try {
      spawned = spawnRefresh(seq)
    } catch (err) {
      log(JSON.stringify({ event: 'build_spawn_failed', seq, code: err.code ?? null, message: err.message }))
      spawned = { child: null, exited: Promise.resolve({ code: null, signal: null }) }
    }
    log(JSON.stringify({ event: 'build_started', seq }))
    const done = spawned.exited.then(async ({ code, signal }) => {
      if (code === 0) {
        log(JSON.stringify({ event: 'build_finished', seq }))
      } else {
        log(JSON.stringify({ event: 'build_failed', seq, exitCode: code, signal: signal ?? null }))
        try { await onFailure(seq) } catch (err) { log(JSON.stringify({ event: 'build_status_failed', message: err.message })) }
      }
    }).finally(() => {
      running = null
      if (queued != null && !stopped) {
        const next = queued
        queued = null
        start(next)
      } else {
        queued = null
        settleIdle()
      }
    })
    running = { seq, child: spawned.child, done }
  }

  function request (seq) {
    if (stopped) return
    if (running) {
      queued = Math.max(queued ?? 0, seq)
      log(JSON.stringify({ event: 'build_queued', seq: queued, running: running.seq }))
      return
    }
    start(seq)
  }

  return {
    request,

    /** The createSyncTrigger writer: starts or queues the run, resolves at once. */
    async writeTrigger (seq) { request(seq) },

    /** One run `bootDelayMs` after the call, then one every `intervalMs`, each for `currentSeq()`. */
    startTimer ({ intervalMs, currentSeq, bootDelayMs = BOOT_BUILD_DELAY_MS }) {
      const boot = setTimer(() => request(currentSeq()), bootDelayMs)
      const repeat = setRepeat(() => request(currentSeq()), intervalMs)
      boot.unref?.()
      repeat.unref?.()
      timers = [() => clearTimer(boot), () => clearRepeat(repeat)]
    },

    /** Resolves once no child runs and nothing is queued. */
    idle () {
      if (!running && queued == null) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },

    /** Shutdown: no new runs, timers cleared, a running child asked to stop (SIGTERM, then SIGKILL). The refresh
     * publishes atomically, so a killed run leaves the last good page; the next boot run publishes the seq. */
    stop () {
      stopped = true
      queued = null
      for (const clear of timers) clear()
      timers = []
      const child = running?.child
      if (child && child.exitCode == null && child.signalCode == null) {
        child.kill('SIGTERM')
        const killer = setTimer(() => child.kill('SIGKILL'), KILL_GRACE_MS)
        killer.unref?.()
      }
    }
  }
}
