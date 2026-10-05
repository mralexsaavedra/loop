/* Tests for the device-manual publisher (lib/profile/manuals.mjs): copies ONLY the PDFs that
 * profile.json devices[].manual names from data/gear/ into the LAN page's site/manuales/, in throwaway
 * temp dirs with SYNTHETIC files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishManuals, referencedManuals, MAX_MANUAL_BYTES } from './manuals.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PDF = (tag = 'x') => Buffer.from(`%PDF-1.7\n% synthetic ${tag}\n%%EOF\n`);

function sandbox(profile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-manuals-'));
  const gear = path.join(root, 'gear');
  const out = path.join(root, 'site', 'manuales');
  const profileFile = path.join(root, 'profile.json');
  fs.mkdirSync(gear);
  if (profile !== undefined) fs.writeFileSync(profileFile, typeof profile === 'string' ? profile : JSON.stringify(profile));
  const warnings = [];
  const run = (opts = {}) => publishManuals({ profileFile, gearDir: gear, outDir: out, warn: (m) => warnings.push(m), ...opts });
  return { root, gear, out, profileFile, warnings, run, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null);

test('referencedManuals: the valid manual names of the visible devices, deduped, hidden devices skipped', () => {
  assert.deepEqual(referencedManuals({
    hiddenDevices: ['Hidden Edge'],
    devices: [
      { name: 'Edge', manual: 'edge.pdf' }, { name: 'Scale', manual: 'scale.pdf' }, { name: 'Edge 2', manual: 'edge.pdf' },
      { name: 'hidden edge', manual: 'hidden.pdf' }, { name: 'Watch' }, { name: 'Bad', manual: '../x.pdf' },
    ],
  }), ['edge.pdf', 'scale.pdf']);
  assert.deepEqual(referencedManuals(null), []);
});

test('copies only the referenced PDFs, removes stale ones, leaves unreferenced gear files alone', () => {
  const s = sandbox({ devices: [{ name: 'Edge', manual: 'edge.pdf' }, { name: 'Scale', manual: 'scale.pdf' }] });
  try {
    fs.writeFileSync(path.join(s.gear, 'edge.pdf'), PDF('edge'));
    fs.writeFileSync(path.join(s.gear, 'scale.pdf'), PDF('scale'));
    fs.writeFileSync(path.join(s.gear, 'private-invoice.pdf'), PDF('secret'));
    fs.mkdirSync(s.out, { recursive: true });
    fs.writeFileSync(path.join(s.out, 'old.pdf'), PDF('old'));
    const r = s.run();
    assert.deepEqual(r.published, ['edge.pdf', 'scale.pdf']);
    assert.deepEqual(r.removed, ['old.pdf']);
    assert.deepEqual(ls(s.out), ['edge.pdf', 'scale.pdf']);
    assert.deepEqual(fs.readFileSync(path.join(s.out, 'edge.pdf')), PDF('edge'));
    // re-run: nothing changes, nothing is rewritten
    const before = fs.statSync(path.join(s.out, 'edge.pdf')).ino;
    const again = s.run();
    assert.deepEqual(again.published, ['edge.pdf', 'scale.pdf']);
    assert.equal(fs.statSync(path.join(s.out, 'edge.pdf')).ino, before, 'unchanged file kept in place');
    // an edited source is re-copied
    fs.writeFileSync(path.join(s.gear, 'edge.pdf'), PDF('edge v2 longer'));
    s.run();
    assert.deepEqual(fs.readFileSync(path.join(s.out, 'edge.pdf')), PDF('edge v2 longer'));
  } finally { s.done(); }
});

test('a missing file is a warning, never a failure; it is not published', () => {
  const s = sandbox({ devices: [{ name: 'Edge', manual: 'edge.pdf' }, { name: 'Scale', manual: 'scale.pdf' }] });
  try {
    fs.writeFileSync(path.join(s.gear, 'scale.pdf'), PDF());
    const r = s.run();
    assert.deepEqual(r.published, ['scale.pdf']);
    assert.deepEqual(r.missing, ['edge.pdf']);
    assert.match(s.warnings.join('\n'), /edge\.pdf/);
    assert.deepEqual(ls(s.out), ['scale.pdf']);
  } finally { s.done(); }
});

test('refuses a symlink (even one pointing inside data/gear), a non-PDF and a file over the size cap', () => {
  const s = sandbox({ devices: [{ name: 'A', manual: 'link.pdf' }, { name: 'B', manual: 'fake.pdf' }, { name: 'C', manual: 'big.pdf' }, { name: 'D', manual: 'dir.pdf' }] });
  try {
    const outside = path.join(s.root, 'outside.pdf');
    fs.writeFileSync(outside, PDF('outside'));
    fs.symlinkSync(outside, path.join(s.gear, 'link.pdf'));
    fs.writeFileSync(path.join(s.gear, 'fake.pdf'), '<html>not a pdf</html>');
    fs.writeFileSync(path.join(s.gear, 'big.pdf'), Buffer.concat([PDF(), Buffer.alloc(64)]));
    fs.mkdirSync(path.join(s.gear, 'dir.pdf'));
    const r = s.run({ maxBytes: 40 });
    assert.deepEqual(r.published, []);
    assert.deepEqual(r.refused.sort(), ['big.pdf', 'dir.pdf', 'fake.pdf', 'link.pdf']);
    assert.deepEqual(ls(s.out), []);
  } finally { s.done(); }
  assert.equal(MAX_MANUAL_BYTES, 50 * 1024 * 1024);
});

test('a symlinked output folder is refused (nothing written through it)', () => {
  const s = sandbox({ devices: [{ name: 'Edge', manual: 'edge.pdf' }] });
  try {
    fs.writeFileSync(path.join(s.gear, 'edge.pdf'), PDF());
    const elsewhere = path.join(s.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(s.out), { recursive: true });
    fs.symlinkSync(elsewhere, s.out);
    assert.throws(() => s.run(), /symlink/);
    assert.deepEqual(ls(elsewhere), []);
  } finally { s.done(); }
});

test('no profile.json: nothing is referenced, every published manual is removed', () => {
  const s = sandbox(undefined);
  try {
    fs.mkdirSync(s.out, { recursive: true });
    fs.writeFileSync(path.join(s.out, 'old.pdf'), PDF());
    const r = s.run();
    assert.deepEqual(r.removed, ['old.pdf']);
    assert.deepEqual(ls(s.out), []);
  } finally { s.done(); }
});

test('a broken or invalid profile.json leaves the published folder untouched (warning)', () => {
  for (const bad of ['{not json', JSON.stringify({ devices: [{ name: 'X', manual: '../x.pdf' }] })]) {
    const s = sandbox(bad);
    try {
      fs.mkdirSync(s.out, { recursive: true });
      fs.writeFileSync(path.join(s.out, 'kept.pdf'), PDF());
      const r = s.run();
      assert.equal(r.skipped, true);
      assert.deepEqual(ls(s.out), ['kept.pdf']);
      assert.match(s.warnings.join('\n'), /profile\.json/);
    } finally { s.done(); }
  }
});

test('CLI: publishes into --out with warnings on stderr and exit 0', () => {
  const s = sandbox({ devices: [{ name: 'Edge', manual: 'edge.pdf' }, { name: 'Gone', manual: 'gone.pdf' }] });
  try {
    fs.writeFileSync(path.join(s.gear, 'edge.pdf'), PDF());
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'publish-manuals.mjs'), '--profile', s.profileFile, '--gear', s.gear, '--out', s.out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(ls(s.out), ['edge.pdf']);
    assert.match(r.stderr, /gone\.pdf/);
    assert.match(r.stdout, /1 published/);
  } finally { s.done(); }
});
