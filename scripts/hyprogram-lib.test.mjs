import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, parseEnvFile, isValidIsoDate, isoWeek, weekFileName, selectDates,
  sanitizeDay, pmToMarkdown, renderDayMarkdown, renderWeekFile, mergeManifest,
  savedDates, groupByWeek, STOP_AFTER_FORBIDDEN, PROGRAM_ID,
  rawFileName, isAllowedEnvPath, isSameOrigin, envModeWarning, shouldStop,
} from './hyprogram-lib.mjs';

test('parseArgs defaults and flags', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, limit: Infinity });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, limit: Infinity });
  assert.equal(parseArgs(['--limit', '5']).limit, 5);
  assert.equal(parseArgs(['--limit=3']).limit, 3);
  assert.throws(() => parseArgs(['--limit', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('parseEnvFile reads keys, strips quotes, ignores comments', () => {
  const env = parseEnvFile('# a comment\nHYPROGRAM_EMAIL=foo@example.com\nHYPROGRAM_PASSWORD="p@ss word"\n\nOTHER=1');
  assert.equal(env.HYPROGRAM_EMAIL, 'foo@example.com');
  assert.equal(env.HYPROGRAM_PASSWORD, 'p@ss word');
  assert.equal(env.OTHER, '1');
});

test('isValidIsoDate', () => {
  assert.ok(isValidIsoDate('2026-10-06'));
  assert.ok(!isValidIsoDate('2026-02-31'));
  assert.ok(!isValidIsoDate('2026-13-01'));
  assert.ok(!isValidIsoDate('nope'));
  assert.ok(!isValidIsoDate('2026-1-1'));
});

test('isoWeek matches ISO-8601', () => {
  assert.equal(isoWeek('2026-10-06'), '2026-W41');
  assert.equal(isoWeek('2026-10-05'), '2026-W41'); // Monday
  assert.equal(isoWeek('2026-10-04'), '2026-W40'); // Sunday prior week
  assert.equal(isoWeek('2026-01-01'), '2026-W01');
  assert.equal(weekFileName('2026-10-06'), '2026-W41.md');
  assert.throws(() => isoWeek('bad'), /invalid date/);
});

test('selectDates: newest first, skips saved, respects limit', () => {
  const imp = ['2026-10-02', '2026-10-06', '2026-09-30', '2026-10-06', 'bad-date', '2026-10-08'];
  assert.deepEqual(selectDates(imp, ['2026-10-02']), ['2026-10-08', '2026-10-06', '2026-09-30']);
  assert.deepEqual(selectDates(imp, [], { limit: 2 }), ['2026-10-08', '2026-10-06']);
});

test('sanitizeDay is an allowlist: unknown and PII-like keys never survive', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }] };
  const day = {
    id: 'HYROX_PROGRAM_2026-10-06', workoutDate: '2026-10-06', programId: 'hp-hybrid',
    title: { 'es-ES': 'T', 'en-US': 'T2' },
    users: [{ id: 'abc' }], userId: 'u1', email: 'a@b.c', createdBy: 'coach@x.y', briefingId: 'b',
    videos: [{ url: 'https://cdn/x.mp4' }],
    coachNotes: { 'es-ES': doc, createdBy: 'z' },
    sections: { 'es-ES': [{
      title: 'A', shortTitle: 'S', index: 0, important: true, key: 'k',
      wod: { ...doc, userId: 'nested' }, coachNotes: doc,
      author: { email: 'p@q.r' }, userId: 'nested-u',
    }] },
  };
  const clean = sanitizeDay(day);
  assert.deepEqual(Object.keys(clean).sort(), ['coachNotes', 'id', 'programId', 'sections', 'title', 'workoutDate']);
  const s = JSON.stringify(clean);
  for (const bad of ['users', 'userId', 'email', 'createdBy', 'author', 'briefingId', 'videos', '@']) {
    assert.ok(!s.includes(bad), `leaked ${bad}`);
  }
  assert.deepEqual(Object.keys(clean.sections['es-ES'][0]).sort(), ['coachNotes', 'important', 'index', 'shortTitle', 'title', 'wod']);
  assert.equal(clean.title['en-US'], 'T2');
  // rendering still works on the sanitized copy
  assert.ok(renderDayMarkdown(clean).includes('**x**'));
  // original untouched
  assert.equal(day.users.length, 1);
});

test('sanitizeDay rejects non-object input and drops bad locales', () => {
  assert.deepEqual(sanitizeDay(null), {});
  const clean = sanitizeDay({ title: { 'es-ES': 'ok', '__proto__x': 'no', 'evil key': 'no' }, sections: { 'es-ES': 'notarray' } });
  assert.deepEqual(Object.keys(clean.title), ['es-ES']);
  assert.deepEqual(clean.sections, {});
});

test('rawFileName uses the validated date, never a traversal id', () => {
  assert.equal(rawFileName('2026-10-06', 'HYROX_PROGRAM_2026-10-06'), 'HYROX_PROGRAM_2026-10-06.json');
  assert.equal(rawFileName('2026-10-06', '../../etc/passwd'), '2026-10-06.json');
  assert.equal(rawFileName('2026-10-06', 'a/b'), '2026-10-06.json');
  assert.equal(rawFileName('2026-10-06', undefined), '2026-10-06.json');
  assert.throws(() => rawFileName('../x', 'ok'), /invalid date/);
});

test('isAllowedEnvPath only accepts a .env.hyprogram basename', () => {
  assert.ok(isAllowedEnvPath('/a/b/.env.hyprogram'));
  assert.ok(!isAllowedEnvPath('/etc/passwd'));
  assert.ok(!isAllowedEnvPath('/a/.env'));
  assert.ok(!isAllowedEnvPath('/a/.env.hyprogram.bak'));
});

test('isSameOrigin pins requests to the base origin', () => {
  const B = 'https://hyprogram.com';
  assert.ok(isSameOrigin('/api/auth/csrf', B));
  assert.ok(!isSameOrigin('https://evil.example/x', B));
  assert.ok(!isSameOrigin('//evil.example/x', B));
  assert.ok(!isSameOrigin('http://hyprogram.com/x', B));
});

test('envModeWarning flags group/world-readable modes', () => {
  assert.equal(envModeWarning(0o100600), null);
  assert.equal(envModeWarning(0o100400), null);
  assert.match(envModeWarning(0o100640), /chmod 600/);
  assert.match(envModeWarning(0o100604), /chmod 600/);
});

test('pmToMarkdown: paragraphs, marks, empty lines', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'WARM UP' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: '5 × 100m Sprint / RPE 6→8' }] },
    ],
  };
  assert.equal(pmToMarkdown(doc), '**WARM UP**\n\n5 × 100m Sprint / RPE 6→8');
});

test('pmToMarkdown: bullet and ordered lists', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SkiErg 500m' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sled push 25m' }] }] },
      ] },
      { type: 'orderedList', attrs: { start: 1 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Run 1km' }] }] },
      ] },
    ],
  };
  assert.equal(pmToMarkdown(doc), '- SkiErg 500m\n- Sled push 25m\n\n1. Run 1km');
});

test('pmToMarkdown: link and nested list', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'see ', }, { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://x.y' } }], text: 'video' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Block A' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] }] },
          ] },
        ] },
      ] },
    ],
  };
  const md = pmToMarkdown(doc);
  assert.ok(md.includes('[video](https://x.y)'));
  assert.ok(md.includes('- Block A'));
  assert.ok(md.includes('  - sub'));
});

test('pmToMarkdown: table and empty doc', () => {
  assert.equal(pmToMarkdown(null), '');
  assert.equal(pmToMarkdown({ type: 'doc', content: [] }), '');
  const table = { type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Est' }] }] },
      { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dist' }] }] },
    ] },
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ski' }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1000m' }] }] },
    ] },
  ] }] };
  assert.equal(pmToMarkdown(table), '| Est | Dist |\n| --- | --- |\n| Ski | 1000m |');
});

const DAY = {
  id: 'HYROX_PROGRAM_2026-10-06',
  workoutDate: '2026-10-06',
  title: { 'es-ES': 'PREPARATORIO ESPECÍFICO: Semana 1 - Día 2' },
  sections: {
    'es-ES': [{
      title: 'THRESHOLD (VT2)', shortTitle: 'A', index: 0, important: true,
      wod: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'WARM UP' }] }] },
      coachNotes: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Subimos carga.' }] }] },
    }],
  },
  coachNotes: {},
};

test('renderDayMarkdown: title, section, wod and notes', () => {
  const md = renderDayMarkdown(DAY);
  assert.ok(md.startsWith('## 2026-10-06 — PREPARATORIO ESPECÍFICO: Semana 1 - Día 2'));
  assert.ok(md.includes('### A · THRESHOLD (VT2)'));
  assert.ok(md.includes('**WARM UP**'));
  assert.ok(md.includes('**Notas del coach:**'));
  assert.ok(md.includes('Subimos carga.'));
});

test('renderDayMarkdown: locale fallback to es-ES', () => {
  const md = renderDayMarkdown(DAY, { locale: 'de-DE' });
  assert.ok(md.includes('THRESHOLD (VT2)'));
});

test('renderWeekFile groups and sorts days', () => {
  const d2 = { ...DAY, id: 'HYROX_PROGRAM_2026-10-07', workoutDate: '2026-10-07', title: { 'es-ES': 'Semana 1 - Día 3' } };
  const md = renderWeekFile('2026-W41', [d2, DAY], { fetchedAt: '2026-10-05T00:00:00Z' });
  assert.ok(md.startsWith('# Hyprogram HP Hybrid — semana ISO 2026-W41'));
  assert.ok(md.indexOf('## 2026-10-06') < md.indexOf('## 2026-10-07'));
  assert.ok(md.includes('Sincronizado: 2026-10-05'));
  // blank line between the intro and the first day heading
  assert.ok(/\n\n## 2026-10-06/.test(md));
});

test('groupByWeek', () => {
  const g = groupByWeek([
    { workoutDate: '2026-10-05' }, { workoutDate: '2026-10-06' }, { workoutDate: '2026-10-02' },
  ]);
  assert.deepEqual([...g.keys()].sort(), ['2026-W40', '2026-W41']);
  assert.equal(g.get('2026-W41').length, 2);
});

test('mergeManifest keeps old entries and sorts', () => {
  const m1 = mergeManifest(null, [{ date: '2026-10-06', status: 'ok', fetchedAt: 't1' }]);
  assert.equal(m1.program, PROGRAM_ID);
  const m2 = mergeManifest(m1, [
    { date: '2026-10-02', status: 'ok', fetchedAt: 't2' },
    { date: '2026-10-06', status: 'ok', fetchedAt: 't3' },
  ]);
  assert.deepEqual(Object.keys(m2.days), ['2026-10-02', '2026-10-06']);
  assert.equal(m2.days['2026-10-06'].fetchedAt, 't3');
  assert.deepEqual(savedDates(m2), ['2026-10-02', '2026-10-06']);
});

test('savedDates ignores non-ok', () => {
  const m = mergeManifest(null, [
    { date: '2026-10-06', status: 'ok' }, { date: '2026-09-01', status: 'forbidden' },
  ]);
  assert.deepEqual(savedDates(m), ['2026-10-06']);
});

test('STOP_AFTER_FORBIDDEN is a small positive integer', () => {
  assert.ok(Number.isInteger(STOP_AFTER_FORBIDDEN) && STOP_AFTER_FORBIDDEN > 0);
});

test('shouldStop: early stop once the window is known, on this run or a previous one', () => {
  const N = STOP_AFTER_FORBIDDEN;
  assert.equal(shouldStop({ forbiddenRun: N, ok: 1, alreadySaved: 0 }), true);
  assert.equal(shouldStop({ forbiddenRun: N, ok: 0, alreadySaved: 15 }), true); // incremental run, nothing new
  assert.equal(shouldStop({ forbiddenRun: N - 1, ok: 0, alreadySaved: 15 }), false);
  assert.equal(shouldStop({ forbiddenRun: N, ok: 0, alreadySaved: 0 }), false); // first run: keep looking for the window
});
