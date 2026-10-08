/* Tests for the per-workout HR zones (lib/training/hr-zones.cjs). SYNTHETIC values only. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Z = require('../../lib/training/hr-zones.cjs')

test('zoneOf: % of max HR, lower bound inclusive — Z0 < 50, Z1 50-60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 >= 90', () => {
  const max = 200
  assert.deepEqual([99, 100, 119, 120, 139, 140, 159, 160, 179, 180, 200, 210].map((b) => Z.zoneOf(b, max)), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5])
  // exact comparison, no rounding: 95 / 190 = 50 % -> Z1, 94 -> Z0
  assert.equal(Z.zoneOf(95, 190), 1)
  assert.equal(Z.zoneOf(94, 190), 0)
})

test('zonesFromHist sums seconds per zone; bad keys / values are skipped; empty -> null', () => {
  assert.deepEqual(Z.zonesFromHist({ 90: 10, 110: 20, 130: 30, 150: 40, 170: 50, 190: 60 }, 200), [10, 20, 30, 40, 50, 60])
  assert.deepEqual(Z.zonesFromHist({ 150: 5, x: 9, 160: -3, 0: 4 }, 200), [0, 0, 0, 5, 0, 0])
  assert.equal(Z.zonesFromHist({}, 200), null)
  assert.equal(Z.zonesFromHist(null, 200), null)
  assert.equal(Z.zonesFromHist({ 150: 5 }, null), null)
})

const act = (id, day, extra = {}) => ({ id, start_local: `${day}T08:00:00Z`, sport_type: 'Run', ...extra })

test('observedMaxHr: highest Strava max HR over the 365 days ending at the newest activity', () => {
  const list = [act('1', '2025-01-01', { max_heartrate: 199 }), act('2', '2025-10-01', { max_heartrate: 188.6 }), act('3', '2026-09-30', { max_heartrate: 181 }), act('4', '2026-09-29')]
  assert.equal(Z.observedMaxHr(list), 189) // 2025-01-01 is > 365 days before 2026-09-30
  assert.equal(Z.observedMaxHr([act('1', '2026-01-01')]), null)
  assert.equal(Z.observedMaxHr([]), null)
})

test('pickMaxHr: a valid profile maxHr wins, else the observed one, else null', () => {
  const list = [act('1', '2026-09-30', { max_heartrate: 181 })]
  assert.deepEqual(Z.pickMaxHr(list, 192), { maxHr: 192, source: 'profile' })
  assert.deepEqual(Z.pickMaxHr(list, 60), { maxHr: 181, source: 'observed' })
  assert.deepEqual(Z.pickMaxHr(list, null), { maxHr: 181, source: 'observed' })
  assert.equal(Z.pickMaxHr([act('1', '2026-09-30')], null), null)
})

test('readProfileMaxHr: absent file / key -> null; out-of-range or broken JSON -> an error, never a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zones-prof-'))
  try {
    const f = path.join(dir, 'profile.json')
    assert.deepEqual(Z.readProfileMaxHr(f), { maxHr: null, error: null })
    fs.writeFileSync(f, '{"name":"x"}')
    assert.deepEqual(Z.readProfileMaxHr(f), { maxHr: null, error: null })
    fs.writeFileSync(f, '{"maxHr":187}')
    assert.deepEqual(Z.readProfileMaxHr(f), { maxHr: 187, error: null })
    fs.writeFileSync(f, '{"maxHr":300}')
    assert.match(Z.readProfileMaxHr(f).error, /maxHr must be/)
    fs.writeFileSync(f, '{')
    assert.match(Z.readProfileMaxHr(f).error, /not valid JSON/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildZones: one row per activity with a histogram, sorted by start; activities without one are left out', () => {
  const list = [
    act('9', '2026-09-30', { sport_type: 'Ride', max_heartrate: 180, average_heartrate: 140.4, hr_hist: { 150: 60, 170: 30 } }),
    act('8', '2026-09-29', { max_heartrate: 200, average_heartrate: 160, hr_hist: { 185: 10 } }),
    act('7', '2026-09-28', { max_heartrate: 170, hr_hist: null }),
  ]
  const r = Z.buildZones(list, { translateType: (t) => (t === 'Ride' ? 'Cycling' : 'Running'), source: 'Strava API' })
  assert.deepEqual(r.max, { maxHr: 200, source: 'observed' })
  assert.equal(r.rows, 2)
  assert.equal(r.text, [Z.ZONES_HEADER,
    '2026-09-29,8,Running,200,observed,160,200,0,0,0,0,0,10,Strava API,,',
    '2026-09-30,9,Cycling,200,observed,140,180,0,0,0,60,30,0,Strava API,,'].join('\n') + '\n')
  const p = Z.buildZones(list, { translateType: () => 'Running', source: 'S', profileMaxHr: 190 })
  assert.match(p.text, /\n2026-09-29,8,Running,190,profile,160,200,0,0,0,0,0,10,S,,\n/)
})

test('buildZones: start (startOf) + elapsed_s (elapsed, else moving time) close the row — the activity window', () => {
  const list = [act('5', '2026-09-30', { max_heartrate: 180, elapsed_time: 3605.4, moving_time: 3000, hr_hist: { 150: 60 } }),
    act('6', '2026-09-30', { max_heartrate: 180, moving_time: 1200, start_local: '2026-09-30T09:00:00Z', hr_hist: { 150: 60 } })]
  const r = Z.buildZones(list, { translateType: () => 'Running', source: 'S', startOf: (a) => a.start_local.slice(0, 19) + '+02:00' })
  const rows = r.text.trim().split('\n').slice(1)
  assert.deepEqual(rows.map((l) => l.split(',').slice(-2)), [['2026-09-30T08:00:00+02:00', '3605'], ['2026-09-30T09:00:00+02:00', '1200']])
})
