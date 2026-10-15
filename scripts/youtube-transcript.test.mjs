import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVtt, cleanCues, toParagraphs, fmtTs, transcriptFileName, pickSubtitle,
  mergeManifest, pendingIds, renderTranscript, wordCount, parseArgs, isoDate, timestampUrl,
} from './youtube-transcript.mjs';

// Synthetic auto-caption VTT: YouTube's rolling captions repeat the previous
// line at the top of every cue and carry inline word timing tags.
const AUTO_VTT = `WEBVTT
Kind: captions
Language: es

00:00:00.199 --> 00:00:01.630 align:start position:0%

Hola<00:00:00.399><c> a</c><00:00:00.640><c> todos.</c>

00:00:01.630 --> 00:00:01.640 align:start position:0%
Hola a todos.


00:00:01.640 --> 00:00:02.990 align:start position:0%
Hola a todos.
Hoy<00:00:01.880><c> hablamos</c><00:00:02.120><c> de</c><00:00:02.200><c> vatios.</c>

00:00:35.000 --> 00:00:36.000 align:start position:0%
Hoy hablamos de vatios.
El FTP &amp; el umbral.

00:01:10.000 --> 00:01:11.000
El FTP &amp; el umbral.
Fin.
`;

// Synthetic manual VTT: cue ids, multi-line cues, no repetition, a styling tag.
const MANUAL_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<i>Primera</i> frase
que sigue aquí.

2
01:02:03.500 --> 01:02:05.000
Segunda frase.
`;

test('parseVtt reads cue start seconds and raw lines, skipping the header and cue ids', () => {
  const cues = parseVtt(MANUAL_VTT);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.deepEqual(cues[0].lines, ['<i>Primera</i> frase', 'que sigue aquí.']);
  assert.equal(cues[1].start, 3723.5);
});

test('parseVtt keeps a cue whose first text row is empty', () => {
  const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\nHola\n\n00:00:03.000 --> 00:00:04.000\nAdiós\n');
  assert.deepEqual(cues, [{ start: 1, lines: ['Hola'] }, { start: 3, lines: ['Adiós'] }]);
});

test('parseVtt tolerates CRLF and mm:ss.mmm timestamps', () => {
  const cues = parseVtt('WEBVTT\r\n\r\n01:05.000 --> 01:06.000\r\nHola\r\n');
  assert.deepEqual(cues, [{ start: 65, lines: ['Hola'] }]);
});

test('cleanCues strips tags, decodes entities and drops rolling-caption duplicates', () => {
  const lines = cleanCues(parseVtt(AUTO_VTT));
  assert.deepEqual(lines.map((l) => l.text), [
    'Hola a todos.', 'Hoy hablamos de vatios.', 'El FTP & el umbral.', 'Fin.',
  ]);
  assert.deepEqual(lines.map((l) => l.start), [0.199, 1.64, 35, 70]);
});

test('cleanCues keeps a manual multi-line cue as one line and drops sound tags', () => {
  const cues = parseVtt(MANUAL_VTT);
  cues.push({ start: 4000, lines: ['[Música]'] });
  assert.deepEqual(cleanCues(cues).map((l) => l.text), ['Primera frase que sigue aquí.', 'Segunda frase.']);
});

test('toParagraphs breaks at a sentence end after 30 s and forces a break at 60 s', () => {
  const lines = [
    { start: 0, text: 'Uno.' },
    { start: 10, text: 'Dos.' },
    { start: 31, text: 'Tres sin punto' },
    { start: 40, text: 'cuatro.' },
    { start: 50, text: 'cinco' },
    { start: 100, text: 'seis' },
    { start: 170, text: 'siete' },
  ];
  assert.deepEqual(toParagraphs(lines), [
    { start: 0, text: 'Uno. Dos. Tres sin punto cuatro.' },
    { start: 50, text: 'cinco seis' },
    { start: 170, text: 'siete' },
  ]);
});

test('toParagraphs of nothing is empty', () => {
  assert.deepEqual(toParagraphs([]), []);
});

test('fmtTs prints mm:ss under an hour and h:mm:ss above', () => {
  assert.equal(fmtTs(0), '00:00');
  assert.equal(fmtTs(65.9), '01:05');
  assert.equal(fmtTs(3723.5), '1:02:03');
});

test('isoDate turns YYYYMMDD into YYYY-MM-DD and rejects anything else', () => {
  assert.equal(isoDate('20260917'), '2026-09-17');
  assert.equal(isoDate('NA'), null);
  assert.equal(isoDate(undefined), null);
});

test('transcriptFileName = <date>-<id>.md, undated without a date, id sanitized', () => {
  assert.equal(transcriptFileName('2026-09-17', 'mqc_-wjq7wA'), '2026-09-17-mqc_-wjq7wA.md');
  assert.equal(transcriptFileName(null, 'abc'), 'undated-abc.md');
  assert.equal(transcriptFileName('2026-09-17', '../x/y'), '2026-09-17-xy.md');
});

test('pickSubtitle prefers a manual track, then the original auto track, never a translation', () => {
  const vtt = (url = 'https://x/t?lang=es') => [{ ext: 'json3', url }, { ext: 'vtt', url }];
  assert.deepEqual(pickSubtitle({ subtitles: { 'es-ES': vtt() }, automatic_captions: { 'es-orig': vtt() } }, 'es'),
    { kind: 'manual', key: 'es-ES' });
  assert.deepEqual(pickSubtitle({ subtitles: { live_chat: vtt() }, automatic_captions: { 'es-orig': vtt(), es: vtt() } }, 'es'),
    { kind: 'auto', key: 'es-orig' });
  assert.deepEqual(pickSubtitle({ automatic_captions: { es: vtt() } }, 'es'), { kind: 'auto', key: 'es' });
  assert.equal(pickSubtitle({ automatic_captions: { es: vtt('https://x/t?lang=en&tlang=es') } }, 'es'), null);
  assert.equal(pickSubtitle({ subtitles: { en: vtt() } }, 'es'), null);
  assert.equal(pickSubtitle({ subtitles: { 'es-ES': [{ ext: 'json3', url: 'u' }] } }, 'es'), null);
  assert.equal(pickSubtitle({}, 'es'), null);
});

test('mergeManifest adds a video without mutating the input and keeps the header', () => {
  const head = { source: 'youtube', channel: 'https://c' };
  const base = { ...head, videos: { a: { title: 'A' } } };
  const next = mergeManifest(base, 'b', { title: 'B' }, head);
  assert.deepEqual(Object.keys(next.videos), ['a', 'b']);
  assert.equal(base.videos.b, undefined);
  assert.deepEqual(mergeManifest(null, 'x', { title: 'X' }, head), { ...head, videos: { x: { title: 'X' } } });
});

test('pendingIds skips videos already in the manifest, dedupes and honours the limit', () => {
  const listing = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'b' }];
  assert.deepEqual(pendingIds(listing, { videos: { a: {} } }).map((v) => v.id), ['b', 'c']);
  assert.deepEqual(pendingIds(listing, null, 1).map((v) => v.id), ['a']);
});

test('timestampUrl appends whole seconds', () => {
  assert.equal(timestampUrl('abc', 65.9), 'https://www.youtube.com/watch?v=abc&t=65s');
});

test('renderTranscript writes the header then timestamped paragraphs', () => {
  const md = renderTranscript(
    { id: 'abc', title: 'Título', date: '2026-09-17', duration: 1146, subs: 'auto' },
    [{ start: 0, text: 'Hola.' }, { start: 65, text: 'Adiós.' }],
  );
  assert.equal(md, [
    '# Título', '',
    '- URL: https://www.youtube.com/watch?v=abc',
    '- Date: 2026-09-17',
    '- Duration: 19:06',
    '- Subtitles: auto (automatic captions: verify numbers in the video)',
    '',
    '[00:00] Hola.', '',
    '[01:05] Adiós.', '',
  ].join('\n'));
});

test('renderTranscript marks unknown date and duration', () => {
  const md = renderTranscript({ id: 'a', title: 'T', date: null, duration: null, subs: 'manual' }, []);
  assert.match(md, /- Date: unknown\n- Duration: unknown\n- Subtitles: manual\n/);
});

test('wordCount counts whitespace-separated words', () => {
  assert.equal(wordCount([{ text: 'uno dos' }, { text: ' tres ' }]), 3);
});

test('parseArgs reads the flags with defaults and rejects bad input', () => {
  assert.deepEqual(parseArgs(['--channel', 'https://c', '--out', 'o']),
    { channel: 'https://c', out: 'o', tabs: ['videos', 'streams'], limit: Infinity, lang: 'es' });
  assert.deepEqual(parseArgs(['--channel', 'https://c/', '--out', 'o', '--tabs', 'videos', '--limit', '3', '--lang', 'en']),
    { channel: 'https://c', out: 'o', tabs: ['videos'], limit: 3, lang: 'en' });
  assert.throws(() => parseArgs(['--out', 'o']), /--channel/);
  assert.throws(() => parseArgs(['--channel', 'c']), /--out/);
  assert.throws(() => parseArgs(['--channel', 'c', '--out', 'o', '--limit', '0']), /--limit/);
  assert.throws(() => parseArgs(['--channel', 'c', '--out', 'o', '--tabs', 'shorts']), /--tabs/);
  assert.throws(() => parseArgs(['--channel', 'c', '--out', 'o', '--lang', 'e s']), /--lang/);
  assert.throws(() => parseArgs(['--channel', 'c', '--out', 'o', '--bogus']), /unknown/);
});

test('importing ingest-youtube.mjs runs nothing (isMain guard): no argument parsing, no yt-dlp', async () => {
  const { spawnSync } = await import('node:child_process');
  const url = new URL('./ingest-youtube.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('imported');`],
    { encoding: 'utf8', env: { ...process.env, YT_DLP: '/nonexistent/yt-dlp' }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'imported');
  assert.equal(r.stderr, '');
});
