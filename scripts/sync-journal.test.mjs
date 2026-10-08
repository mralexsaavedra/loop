/* scripts/sync-journal.mjs — the journal export into the extract (journal-daily.csv). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSummary, mergedCsv, syncJournal, main, windowFor, META_FILE } from './sync-journal.mjs';
import { parseJournalCsv } from '../lib/journal/journal.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sync-journal-'));
const BODY = { from: '2030-01-01', to: '2030-01-31', days: [
  { date: '2030-01-10', answers: { alcohol: 2, nap: false }, notes: 'late dinner' },
  { date: '2030-01-12', answers: { ill: true }, notes: null },
] };

test('windowFor: 366 days ending on the local date', () => {
  const w = windowFor(new Date(2030, 0, 31, 23, 30));
  assert.deepEqual(w, { from: '2029-01-31', to: '2030-01-31' });
});

test('normalizeSummary: known keys only; a malformed body throws', () => {
  assert.equal(normalizeSummary(BODY).days.length, 2);
  assert.throws(() => normalizeSummary({ from: '2030-01-01', to: '2030-01-31' }), /shape/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ date: '2030-02-10', answers: {} }] }), /date/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [{ date: '2030-01-10', answers: { alcohol: true } }] }), /alcohol/);
  assert.throws(() => normalizeSummary({ ...BODY, days: [BODY.days[0], BODY.days[0]] }), /duplicate/);
});

test('mergedCsv: rows older than the window are kept, the server wins inside it', () => {
  const prev = mergedCsv('', { from: '2029-12-01', to: '2030-01-31', days: [
    { date: '2029-12-20', answers: { nap: true }, notes: null },
    { date: '2030-01-05', answers: { nap: true }, notes: null }, // deleted on the server since
  ] });
  const next = parseJournalCsv(mergedCsv(prev, normalizeSummary(BODY)));
  assert.deepEqual(next.map((d) => d.date), ['2029-12-20', '2030-01-10', '2030-01-12']);
  assert.deepEqual(next[1].answers, { alcohol: 2, nap: false });
  assert.equal(next[1].notes, 'late dinner');
});

test('syncJournal writes the CSV + meta; main warns and keeps the old files when the service is missing', async () => {
  const dir = tmp();
  try {
    const r = syncJournal(dir, BODY, { now: new Date('2030-01-31T10:00:00Z') });
    assert.deepEqual(r, { days: 2, changed: true });
    assert.equal(parseJournalCsv(fs.readFileSync(path.join(dir, 'journal-daily.csv'), 'utf8')).length, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8')), { from: '2030-01-01', to: '2030-01-31', days: 2, fetchedAt: '2030-01-31T10:00:00.000Z' });
    assert.equal(syncJournal(dir, BODY).changed, false);
    const warned = [];
    const before = fs.readFileSync(path.join(dir, 'journal-daily.csv'), 'utf8');
    const code = await main({ env: { SYNC_JOURNAL_OUT_DIR: dir }, warn: (l) => warned.push(l), log: () => {}, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    assert.equal(code, 0);
    assert.match(warned[0], /^WARNING: journal export skipped \(ingest service answered HTTP 404\)/);
    assert.equal(fs.readFileSync(path.join(dir, 'journal-daily.csv'), 'utf8'), before);
    // a real answer goes through main, with the journal header
    let seen = null;
    const ok = await main({ env: { SYNC_JOURNAL_OUT_DIR: dir, INGEST_URL: 'http://127.0.0.1:8088/' }, log: () => {}, warn: () => {}, now: new Date(2030, 0, 31),
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => BODY }; } });
    assert.equal(ok, 0);
    assert.match(seen.url, /^http:\/\/127\.0\.0\.1:8088\/journal\/summary\?from=2029-01-31&to=2030-01-31$/);
    assert.equal(seen.init.headers['x-hc-journal'], '1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
