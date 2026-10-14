import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './sync-onboarding.mjs';

const cells = (kcal, p, f) => ({ rest: { kcal, p, f }, gym: { kcal: kcal + 350, p, f }, bike: { kcal: kcal + 850, p, f }, bikeLong: { kcal: kcal + 1450, p, f } });
const DOC = {
  sex: 'female', birthdate: '1997-05-20', heightCm: 165, weightKg: 60, activity: 'light', goals: ['maintain'],
  targets: { maintain: cells(1800, 108, 48), cut: cells(1550, 120, 48), bulk: cells(1950, 108, 48) },
  updatedAt: '2030-01-10T10:00:00.000Z',
};

function run(body, { status = 200, dir } = {}) {
  const out = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hc-onboarding-'));
  const logs = []; const warns = []; const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push([url, init.headers['x-hc-food']]);
    return { ok: status === 200, status, json: async () => body };
  };
  const env = { SYNC_PROFILE_OUT_DIR: out, INGEST_URL: 'http://localhost:8089' };
  return main({ env, log: (l) => logs.push(l), warn: (w) => warns.push(w), fetchImpl }).then((code) => ({ code, out, logs, warns, urls }));
}

test('a completed wizard is written to onboarding.json (this clone\'s service, the food header)', async () => {
  const r = await run({ profile: DOC });
  assert.equal(r.code, 0);
  assert.deepEqual(r.urls, [['http://localhost:8089/food/profile', '1']]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.out, 'onboarding.json'), 'utf8')), DOC);
  assert.match(r.logs[0], /Onboarding: written/);
  const again = await run({ profile: DOC }, { dir: r.out });
  assert.match(again.logs[0], /Onboarding: unchanged/);
});

test('never completed (profile null): no file, exit 0', async () => {
  const r = await run({ profile: null });
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(path.join(r.out, 'onboarding.json')), false);
  assert.match(r.logs[0], /Onboarding: not completed/);
});

test('an old service (404) or a malformed body only warns and keeps the previous file', async () => {
  const first = await run({ profile: DOC });
  const old = await run(null, { status: 404, dir: first.out });
  assert.equal(old.code, 0);
  assert.match(old.warns[0], /WARNING: .*onboarding\.json is kept/);
  const broken = await run({ profile: { ...DOC, sex: 'x' } }, { dir: first.out });
  assert.equal(broken.code, 0);
  assert.match(broken.warns[0], /WARNING: .*onboarding\.json is kept/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.out, 'onboarding.json'), 'utf8')), DOC);
});
