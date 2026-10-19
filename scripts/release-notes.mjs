#!/usr/bin/env node
/* `node scripts/release-notes.mjs <X.Y.Z> [--changelog <file>]`: prints the GitHub Release body of one version, the
 * text under its dated `## [X.Y.Z] - YYYY-MM-DD` heading in CHANGELOG.md (up to the next `## ` heading), with
 * repo-relative links pointed at the tagged tree on GitHub (a release page has no relative base) and one line naming
 * the two images. The release workflow (.github/workflows/release.yml, job github-release) publishes it after both
 * images are pushed; docs/development.md -> Releasing. A version without a dated, non-empty section exits 1. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/mralexsaavedra/loop';
const IMAGES = ['mralexandersaavedra/loop-server', 'mralexandersaavedra/loop-web'];

/** The release body of `version` from the CHANGELOG text; throws when the version has no dated, non-empty section. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const head = `## [${version}] - `;
  const start = lines.findIndex((l) => l.startsWith(head) && /^\d{4}-\d{2}-\d{2}$/.test(l.slice(head.length).trim()));
  if (start === -1) throw new Error(`CHANGELOG has no "## [${version}] - YYYY-MM-DD" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`the CHANGELOG section of ${version} is empty`);
  // [text](docs/x.md#y) -> the file in the tagged tree; absolute URLs and #anchors stay
  const linked = body.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, p) => `](${REPO}/blob/v${version}/${p.replace(/^\.\//, '')})`);
  const images = IMAGES.map((i) => `\`${i}:${version}\``).join(' and ');
  return `${linked}\n\n---\nImages: ${images} (linux/amd64, linux/arm64). Install or upgrade: README → Setup and ` +
    `[docs/guides/upgrading.md](${REPO}/blob/v${version}/docs/guides/upgrading.md).\n`;
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { changelog: { type: 'string' } } });
  try {
    if (positionals.length !== 1) throw new Error('usage: node scripts/release-notes.mjs <X.Y.Z> [--changelog <file>]');
    const file = values.changelog || path.join(ROOT, 'CHANGELOG.md');
    process.stdout.write(releaseNotes(fs.readFileSync(file, 'utf8'), positionals[0]));
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) main();
