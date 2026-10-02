#!/usr/bin/env node
// Incremental YouTube transcript ingest for the local knowledge base.
//
//   node scripts/ingest-youtube.mjs --channel <url> --out <dir> \
//     [--tabs videos,streams] [--limit N] [--lang es]
//
// Lists the channel tabs (shorts are never listed), and for every video not yet
// in <out>/manifest.json downloads ONLY its subtitles (never media) with an
// external yt-dlp binary, converts them to <out>/raw/<date>-<id>.md and records
// the video in the manifest (atomic write after each video, so an interrupted run
// resumes where it stopped). Manual subtitles win over automatic captions; a
// video with neither is recorded `subs: none`. Polite: 1-2 s between requests,
// 2 retries with backoff on a failure. yt-dlp = $YT_DLP, else `yt-dlp` on PATH,
// else ~/.local/bin/yt-dlp. The output is third-party content for personal use:
// keep it in a gitignored folder (knowledge/ is).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseArgs, pickSubtitle, cleanCues, parseVtt, toParagraphs, renderTranscript, transcriptFileName,
  mergeManifest, pendingIds, isoDate, wordCount, videoUrl,
} from './youtube-transcript.mjs';

const CALL_TIMEOUT_MS = 180_000;
const RETRY_WAIT_MS = [20_000, 60_000];
// Failures a retry cannot fix: the video itself is not readable.
const PERMANENT_RE = /Private video|Video unavailable|members-only|This live event|Sign in to confirm your age|has been removed/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(1000 + Math.floor(Math.random() * 1000));

function ytDlpBin() {
  if (process.env.YT_DLP) return process.env.YT_DLP;
  const probe = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'yt-dlp';
  return join(homedir(), '.local', 'bin', 'yt-dlp');
}

const BIN = ytDlpBin();

function run(args) {
  return new Promise((resolveRun) => {
    const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolveRun({ code: -1, out, err: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, out, err }); });
  });
}

async function runRetry(args, label) {
  let last;
  for (let attempt = 0; attempt <= RETRY_WAIT_MS.length; attempt++) {
    last = await run(args);
    if (last.code === 0) return last;
    if (PERMANENT_RE.test(last.err)) break;
    if (attempt < RETRY_WAIT_MS.length) {
      console.error(`  retry ${attempt + 1} (${label}): ${firstError(last.err)}`);
      await sleep(RETRY_WAIT_MS[attempt]);
    }
  }
  const e = new Error(firstError(last.err) || `yt-dlp exited ${last.code}`);
  e.permanent = PERMANENT_RE.test(last.err);
  throw e;
}

function firstError(stderr) {
  const line = String(stderr).split('\n').find((l) => l.startsWith('ERROR')) || String(stderr).trim().split('\n').pop() || '';
  return line.slice(0, 200);
}

// Shared flags: original-language metadata (titles are otherwise auto-translated)
// and node as the JS runtime yt-dlp needs for YouTube.
const baseArgs = (lang) => ['--js-runtimes', `node:${process.execPath}`, '--extractor-args', `youtube:lang=${lang}`, '--no-progress'];

async function listTab(channel, tab, lang) {
  const { out } = await runRetry([
    ...baseArgs(lang), '--flat-playlist', '--print', '%(id)s\t%(duration)s\t%(live_status)s', `${channel}/${tab}`,
  ], `list ${tab}`);
  return out.split('\n').filter(Boolean).map((row) => {
    const [id, duration, live] = row.split('\t');
    return { id, duration: Number(duration) || null, live, tab };
  }).filter((v) => /^[A-Za-z0-9_-]{6,20}$/.test(v.id) && v.live !== 'is_upcoming' && v.live !== 'is_live');
}

function readManifest(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function ingestVideo(video, { lang, tmpDir, rawDir }) {
  const url = videoUrl(video.id);
  const stem = join(tmpDir, video.id);
  await runRetry([...baseArgs(lang), '--skip-download', '--write-info-json', '--no-write-playlist-metafiles',
    '-o', `${stem}.%(ext)s`, url], `info ${video.id}`);
  const infoPath = `${stem}.info.json`;
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  if (['is_upcoming', 'is_live', 'post_live'].includes(info.live_status)) return null; // not final yet
  const base = {
    title: info.title || video.id,
    date: isoDate(info.upload_date),
    duration: Number.isFinite(info.duration) ? info.duration : video.duration,
    tab: video.tab,
  };
  const pick = pickSubtitle(info, lang);
  if (!pick) return { ...base, subs: 'none', file: null, words: 0 };
  await pause();
  await runRetry(['--js-runtimes', `node:${process.execPath}`, '--no-progress', '--load-info-json', infoPath,
    '--skip-download', pick.kind === 'manual' ? '--write-subs' : '--write-auto-subs',
    '--sub-langs', pick.key, '--sub-format', 'vtt', '-o', `${stem}.%(ext)s`], `subs ${video.id}`);
  const vttName = readdirSync(tmpDir).find((f) => f.startsWith(`${video.id}.`) && f.endsWith('.vtt'));
  if (!vttName) throw new Error('subtitle file missing after download');
  const paragraphs = toParagraphs(cleanCues(parseVtt(readFileSync(join(tmpDir, vttName), 'utf8'))));
  if (!paragraphs.length) return { ...base, subs: 'none', file: null, words: 0 };
  const file = `raw/${transcriptFileName(base.date, video.id)}`;
  writeAtomic(join(rawDir, '..', file), renderTranscript({ id: video.id, ...base, subs: pick.kind }, paragraphs));
  return { ...base, subs: pick.kind, file, words: wordCount(paragraphs) };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`ERROR: ${e.message}\nusage: node scripts/ingest-youtube.mjs --channel <url> --out <dir> [--tabs videos,streams] [--limit N] [--lang es]`);
    process.exit(2);
  }
  const out = resolve(opts.out);
  const rawDir = join(out, 'raw');
  const tmpDir = join(out, '.tmp');
  mkdirSync(rawDir, { recursive: true });
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const manifestPath = join(out, 'manifest.json');
  let manifest = readManifest(manifestPath);
  const head = { source: 'youtube', channel: opts.channel };

  const listing = [];
  for (const tab of opts.tabs) {
    const rows = await listTab(opts.channel, tab, opts.lang);
    console.log(`${tab}: ${rows.length} listed`);
    listing.push(...rows);
    await pause();
  }
  const todo = pendingIds(listing, manifest, opts.limit);
  console.log(`${todo.length} new video(s) to ingest`);

  const tally = { manual: 0, auto: 0, none: 0, failed: 0, skipped: 0 };
  for (const [i, video] of todo.entries()) {
    try {
      const entry = await ingestVideo(video, { lang: opts.lang, tmpDir, rawDir });
      if (!entry) {
        tally.skipped++;
        console.log(`[${i + 1}/${todo.length}] ${video.id} skipped (live or upcoming)`);
      } else {
        manifest = mergeManifest(manifest, video.id, { ...entry, fetchedAt: new Date().toISOString() }, head);
        writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        tally[entry.subs]++;
        console.log(`[${i + 1}/${todo.length}] ${video.id} ${entry.subs} ${entry.words} words  ${entry.title}`);
      }
    } catch (e) {
      tally.failed++;
      console.error(`[${i + 1}/${todo.length}] ${video.id} FAILED: ${e.message}`);
    } finally {
      for (const f of readdirSync(tmpDir)) rmSync(join(tmpDir, f), { force: true });
    }
    if (i < todo.length - 1) await pause();
  }
  rmSync(tmpDir, { recursive: true, force: true });

  const all = Object.values((manifest && manifest.videos) || {});
  const words = all.reduce((n, v) => n + (v.words || 0), 0);
  console.log(`this run: ${JSON.stringify(tally)}`);
  console.log(`manifest: ${all.length} videos, ${all.filter((v) => v.subs === 'manual').length} manual, `
    + `${all.filter((v) => v.subs === 'auto').length} auto, ${all.filter((v) => v.subs === 'none').length} without subs, ${words} words`);
  if (tally.failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
