/* Unit tests for scripts/release-notes.mjs — the GitHub Release body the release workflow publishes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './release-notes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/release-notes.mjs');

const CHANGELOG = `# Changelog

Intro.


## [1.2.0] - 2030-02-01

Newest.

- A [doc](docs/a.md#x) link.

## [1.1.0] - 2030-01-01

Older.

## 2029-12-01 — not a release

History.
`;

test('the body is that version\'s CHANGELOG section (up to the next heading), trimmed, plus the images line', () => {
  const body = releaseNotes(CHANGELOG, '1.2.0');
  assert.ok(body.startsWith('Newest.\n\n- A [doc]'), body);
  assert.ok(!body.includes('Older.'));
  assert.match(body, /`mralexandersaavedra\/loop-server:1\.2\.0` and `mralexandersaavedra\/loop-web:1\.2\.0`/);
  // an older release stops at the next "## " heading, versioned or not
  const older = releaseNotes(CHANGELOG, '1.1.0');
  assert.ok(older.startsWith('Older.') && !older.includes('History.'), older);
});

test('repo-relative links point at the tagged tree on GitHub (a release page has no relative base)', () => {
  const body = releaseNotes(CHANGELOG, '1.2.0');
  assert.ok(body.includes('[doc](https://github.com/mralexsaavedra/loop/blob/v1.2.0/docs/a.md#x)'), body);
  // absolute links and anchors stay as they are
  const abs = releaseNotes('## [1.0.0] - 2030-01-01\n\n[a](https://x.test/y) [b](#here)\n', '1.0.0');
  assert.ok(abs.includes('[a](https://x.test/y)') && abs.includes('[b](#here)'), abs);
});

test('a version without a dated section is refused (no empty or UNRELEASED release body)', () => {
  assert.throws(() => releaseNotes(CHANGELOG, '9.9.9'), /no "## \[9\.9\.9\] - YYYY-MM-DD" section/);
  assert.throws(() => releaseNotes('## [1.0.0] - UNRELEASED\n\nx\n', '1.0.0'), /no "## \[1\.0\.0\] - YYYY-MM-DD" section/);
  assert.throws(() => releaseNotes('## [1.0.0] - 2030-01-01\n\n## [0.9.0] - 2029-01-01\n', '1.0.0'), /empty/);
});

test('CLI: prints the body for the version argument; a missing section exits 1 with one ERROR line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);
  const ok = spawnSync(process.execPath, [SCRIPT, '1.1.0', '--changelog', path.join(dir, 'CHANGELOG.md')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.startsWith('Older.'));
  const bad = spawnSync(process.execPath, [SCRIPT, '9.9.9', '--changelog', path.join(dir, 'CHANGELOG.md')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^ERROR: /);
  // the repo's own newest release has a body
  const own = spawnSync(process.execPath, [SCRIPT, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version], { encoding: 'utf8', cwd: ROOT });
  assert.equal(own.status, 0, own.stderr);
});

test('the release workflow publishes the GitHub Release from this script after both images, newest one marked latest', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const job = wf.slice(wf.indexOf('\n  github-release:'));
  assert.ok(wf.includes('\n  github-release:'), 'a github-release job');
  assert.match(job, /needs: \[check, image\]/);
  assert.match(job, /contents: write/);
  assert.match(job, /node scripts\/release-notes\.mjs "\$\{VERSION\}"/);
  assert.match(job, /--latest="\$\{LATEST\}"/);
  assert.match(job, /gh release edit/, 'a re-run updates the existing release instead of failing');
});
