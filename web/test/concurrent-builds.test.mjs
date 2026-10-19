// Two page builds started at the same time (the parallel test suite, or two refreshes) must both succeed: Astro writes its
// prerender chunks into one shared <repo>/.astro/.prerender, so build-web serializes the Astro step with a lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function build(outdir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build-web.mjs'), '--mode', 'example', '--locale', 'en', '--outdir', outdir], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err }));
  });
}

test('six example builds started together all succeed and write identical pages', { timeout: 300_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-builds-'));
  try {
    const outs = [1, 2, 3, 4, 5, 6].map((i) => path.join(dir, `b${i}`));
    const results = await Promise.all(outs.map(build));
    for (const [i, r] of results.entries()) assert.equal(r.code, 0, `build ${i + 1} failed:\n${r.err.slice(-1500)}`);
    const pages = outs.map((o) => fs.readFileSync(path.join(o, 'index.html'), 'utf8'));
    for (const p of pages.slice(1)) assert.equal(p, pages[0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
