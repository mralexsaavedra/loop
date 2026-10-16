/* scripts/import-health.mjs (npm run import:health) and its zip reader (scripts/lib/zip.mjs), on SYNTHETIC exports
 * and zips built here in temp data roots (never a personal file): the iPhone zip layout (an NFD-accented
 * `exportación.xml` without the UTF-8 flag, data descriptors, export_cda.xml + workout-routes next to it), zip64,
 * the skip-by-sha256 rule, the error paths that keep the previous extract, the state file, the work file, the
 * equivalence with the manual flow (unzip -> extract.mjs) and the Shortcut layering after an import. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listZip, extractEntry } from './lib/zip.mjs';
import { exportEntry, newestCandidate, main } from './import-health.mjs';
import { syncDir } from '../data/apple-health/sync-shortcut.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'import-health.mjs');
const EXTRACT = path.join(HERE, '..', 'data', 'apple-health', 'extract.mjs');
const Q = 'HKQuantityTypeIdentifier';
// the iPhone's name bytes: UTF-8 in NFD (o + U+0301), and the zip does NOT set the UTF-8 flag
const ACCENTED = Buffer.from('apple_health_export/exportacio\u0301n.xml', 'utf8');

const rec = (type, src, start, value) =>
  `<Record type="${Q}${type}" sourceName="${src}" unit="count" startDate="${start}" endDate="${start}" value="${value}"/>`;
function exportXml({ days = ['2030-01-01', '2030-01-02', '2030-01-03'], closed = true } = {}) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData locale="es_ES">', '<ExportDate value="2030-01-03 08:00:00 +0100"/>'];
  for (const d of days) {
    lines.push(rec('StepCount', 'iPhone de Demo', `${d} 10:00:00 +0100`, 1000));
    lines.push(rec('HeartRateVariabilitySDNN', 'Apple Watch de Demo', `${d} 07:00:00 +0100`, 40));
    lines.push(rec('BodyMass', 'Báscula', `${d} 07:30:00 +0100`, 80.5));
  }
  if (closed) lines.push('</HealthData>');
  return lines.join('\n') + '\n';
}

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

/** A zip in a Buffer. entries: { name: string | Buffer, data: string | Buffer, method = 8, descriptor = true,
 * utf8Flag = false, crc? (override) }; zip64 = sizes and offsets only in the zip64 extra + a zip64 end record. */
function zipBuffer(entries, { zip64 = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (b) => { parts.push(b); offset += b.length; };
  for (const e of entries) {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const method = e.method ?? 8;
    const descriptor = e.descriptor ?? true;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? zlib.crc32(data);
    const flags = (descriptor ? 0x08 : 0) | (e.utf8Flag ? 0x800 : 0);
    const localOffset = offset;
    const local64 = zip64 ? Buffer.concat([u16(1), u16(16), u64(data.length), u64(body.length)]) : Buffer.alloc(0);
    push(Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0x5021),
      u32(descriptor ? 0 : crc), u32(descriptor ? 0 : zip64 ? 0xffffffff : body.length), u32(descriptor ? 0 : zip64 ? 0xffffffff : data.length),
      u16(name.length), u16(local64.length), name, local64,
    ]));
    push(body);
    if (descriptor) push(Buffer.concat([u32(0x08074b50), u32(crc), ...(zip64 ? [u64(body.length), u64(data.length)] : [u32(body.length), u32(data.length)])]));
    const extra = zip64 ? Buffer.concat([u16(1), u16(24), u64(data.length), u64(body.length), u64(localOffset)]) : Buffer.alloc(0);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(0x0314), u16(zip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0x5021), u32(crc),
      u32(zip64 ? 0xffffffff : body.length), u32(zip64 ? 0xffffffff : data.length), u16(name.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0), u32(zip64 ? 0xffffffff : localOffset), name, extra,
    ]));
  }
  const cd = Buffer.concat(central);
  const cdOffset = offset;
  push(cd);
  if (zip64) {
    const z64Offset = offset;
    push(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(entries.length), u64(entries.length), u64(cd.length), u64(cdOffset)]));
    push(Buffer.concat([u32(0x07064b50), u32(0), u64(z64Offset), u32(1)]));
    push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(0)]));
  } else {
    push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(cdOffset), u16(0)]));
  }
  return Buffer.concat(parts);
}

/** The iPhone zip layout: the accented export, export_cda.xml, a folder entry and a workout route. */
const iphoneZip = (xml = exportXml(), opts = {}) => zipBuffer([
  { name: 'apple_health_export/', data: '', method: 0, descriptor: false },
  { name: ACCENTED, data: xml },
  { name: 'apple_health_export/export_cda.xml', data: '<ClinicalDocument></ClinicalDocument>\n' },
  { name: 'apple_health_export/workout-routes/route_2030-01-02_7.00am.gpx', data: '<gpx></gpx>\n' },
], opts);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-health-'));
  const data = path.join(root, 'data');
  const importDir = path.join(data, 'files', 'import');
  fs.mkdirSync(importDir, { recursive: true });
  const env = { ...process.env, HC_DATA_DIR: data };
  delete env.EXTRACT_DIR;
  delete env.HC_FILES_DIR;
  const out = path.join(data, 'extract');
  return {
    root, data, importDir, env, out,
    put(name, buf, mtime) {
      const f = path.join(importDir, name);
      fs.writeFileSync(f, buf);
      if (mtime) fs.utimesSync(f, mtime, mtime);
      return f;
    },
    state: () => JSON.parse(fs.readFileSync(path.join(data, 'import-state.json'), 'utf8')),
    snapshot: () => Object.fromEntries(fs.readdirSync(out).sort().map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')])),
    work: () => (fs.existsSync(path.join(data, 'import-work')) ? fs.readdirSync(path.join(data, 'import-work')) : []),
    run: (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** The manual flow: the export as a plain file, then extract.mjs on it (EXTRACT_DIR: <dir>/export.xml -> <dir>/extract). */
function manualExtract(xml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-manual-'));
  fs.writeFileSync(path.join(dir, 'export.xml'), xml);
  const r = spawnSync(process.execPath, [EXTRACT], { encoding: 'utf8', env: { ...process.env, EXTRACT_DIR: dir } });
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'extract');
  return { out, snapshot: () => Object.fromEntries(fs.readdirSync(out).sort().map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')])), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---- the zip reader ----

test('zip: lists the iPhone layout (NFD accented name without the UTF-8 flag decoded as UTF-8) and streams an entry with its CRC checked', async () => {
  const x = setup();
  try {
    const xml = exportXml();
    const zip = x.put('exportar.zip', iphoneZip(xml));
    const entries = await listZip(zip);
    assert.deepEqual(entries.map((e) => e.name), ['apple_health_export/', 'apple_health_export/exportacio\u0301n.xml', 'apple_health_export/export_cda.xml', 'apple_health_export/workout-routes/route_2030-01-02_7.00am.gpx']);
    const dest = path.join(x.root, 'out.xml');
    await extractEntry(zip, entries[1], dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), xml);
  } finally { x.cleanup(); }
});

test('zip: zip64 sizes and offsets (an export over 4 GB uncompressed) and stored entries are read', async () => {
  const x = setup();
  try {
    const xml = exportXml();
    const zip = x.put('big.zip', zipBuffer([{ name: 'apple_health_export/export.xml', data: xml }, { name: 'b.txt', data: 'stored\n', method: 0, descriptor: false }], { zip64: true }));
    const entries = await listZip(zip);
    assert.deepEqual(entries.map((e) => [e.name, e.size]), [['apple_health_export/export.xml', Buffer.byteLength(xml)], ['b.txt', 7]]);
    await extractEntry(zip, entries[0], path.join(x.root, 'a'));
    await extractEntry(zip, entries[1], path.join(x.root, 'b'));
    assert.equal(fs.readFileSync(path.join(x.root, 'a'), 'utf8'), xml);
    assert.equal(fs.readFileSync(path.join(x.root, 'b'), 'utf8'), 'stored\n');
  } finally { x.cleanup(); }
});

test('zip: not a zip, a cut-off zip and a CRC mismatch are refused (code corrupt)', async () => {
  const x = setup();
  try {
    await assert.rejects(listZip(x.put('a.zip', 'hello, not a zip\n')), { code: 'corrupt' });
    const whole = iphoneZip();
    await assert.rejects(listZip(x.put('b.zip', whole.subarray(0, whole.length - 30))), { code: 'corrupt' });
    const bad = x.put('c.zip', zipBuffer([{ name: 'export.xml', data: exportXml(), crc: 1234 }]));
    const [entry] = await listZip(bad);
    await assert.rejects(extractEntry(bad, entry, path.join(x.root, 'c.xml')), { code: 'corrupt' });
  } finally { x.cleanup(); }
});

test('exportEntry: the export accent- and case-insensitively, never export_cda.xml or a route; one other-language xml is taken; none -> null', () => {
  const e = (...names) => names.map((name) => ({ name }));
  assert.equal(exportEntry(e('apple_health_export/', 'apple_health_export/exportacio\u0301n.xml', 'apple_health_export/export_cda.xml')).name, 'apple_health_export/exportacio\u0301n.xml');
  assert.equal(exportEntry(e('apple_health_export/export_cda.xml', 'apple_health_export/Export.xml')).name, 'apple_health_export/Export.xml');
  assert.equal(exportEntry(e('apple_health_export/exportación.xml')).name, 'apple_health_export/exportación.xml');
  assert.equal(exportEntry(e('export.xml')).name, 'export.xml');
  assert.equal(exportEntry(e('apple_health_export/Exportieren.xml', 'apple_health_export/export_cda.xml', 'apple_health_export/workout-routes/a.xml')).name, 'apple_health_export/Exportieren.xml');
  assert.equal(exportEntry(e('apple_health_export/export_cda.xml', 'apple_health_export/workout-routes/route.gpx')), null);
  assert.equal(exportEntry(e('apple_health_export/a.xml', 'apple_health_export/b.xml')), null, 'ambiguous');
});

test('newestCandidate: the newest *.zip or export.xml by mtime; dotfiles, folders and other files ignored', () => {
  const x = setup();
  try {
    assert.equal(newestCandidate(x.importDir), null);
    x.put('old.zip', 'a', new Date('2030-01-01'));
    x.put('notes.txt', 'n', new Date('2031-01-01'));
    x.put('.hidden.zip', 'h', new Date('2031-01-01'));
    fs.mkdirSync(path.join(x.importDir, 'dir.zip'));
    assert.equal(path.basename(newestCandidate(x.importDir).file), 'old.zip');
    x.put('export.xml', 'b', new Date('2030-02-01'));
    assert.deepEqual({ ...newestCandidate(x.importDir), file: path.basename(newestCandidate(x.importDir).file) }, { file: 'export.xml', kind: 'xml', size: 1, mtimeMs: new Date('2030-02-01').getTime() });
    x.put('Exportar.ZIP', 'cc', new Date('2030-03-01'));
    assert.equal(newestCandidate(x.importDir).kind, 'zip');
  } finally { x.cleanup(); }
});

// ---- the command ----

test('import: the newest iPhone zip is extracted byte-identical to the manual flow; state recorded; zip untouched; work file removed; counts only', () => {
  const x = setup();
  const xml = exportXml();
  const manual = manualExtract(xml);
  try {
    const buf = iphoneZip(xml);
    const zip = x.put('exportar.zip', buf, new Date('2030-01-03T12:00:00Z'));
    const before = fs.statSync(zip);
    const r = x.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(x.snapshot(), manual.snapshot(), 'extract CSVs + _meta.json identical to unzip -> extract.mjs');
    const st = x.state();
    assert.deepEqual(Object.keys(st).sort(), ['exportLastDate', 'file', 'importedAt', 'mtimeMs', 'rows', 'sha256', 'size']);
    assert.equal(st.file, 'exportar.zip');
    assert.equal(st.sha256, sha(buf));
    assert.equal(st.size, buf.length);
    assert.equal(st.exportLastDate, '2030-01-03');
    assert.equal(st.rows.weight, 3);
    assert.match(st.importedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(fs.readFileSync(zip), buf, 'the zip is never modified');
    assert.equal(fs.statSync(zip).mtimeMs, before.mtimeMs);
    assert.deepEqual(x.work(), [], 'the work file is removed');
    assert.match(r.stdout, /import:health: exportar\.zip .*imported/);
    assert.ok(!r.stdout.includes('Báscula') && !r.stderr.includes('Báscula'), 'no personal content is printed');
    assert.deepEqual(fs.readdirSync(x.importDir), ['exportar.zip'], 'nothing written into the files folder');
  } finally { x.cleanup(); manual.cleanup(); }
});

test('import: the same zip again is skipped (exit 0, one line); --force re-imports it; a new zip is imported', () => {
  const x = setup();
  try {
    x.put('exportar.zip', iphoneZip(), new Date('2030-01-03T12:00:00Z'));
    assert.equal(x.run().status, 0);
    const first = x.state();
    const again = x.run();
    assert.equal(again.status, 0);
    assert.match(again.stdout, /^import:health: exportar\.zip already imported \(sha256 [0-9a-f]{12}\); --force imports it again\n$/);
    assert.deepEqual(x.state(), first);
    const forced = x.run('--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /imported/);
    assert.equal(x.state().sha256, first.sha256);
    const xml2 = exportXml({ days: ['2030-01-01', '2030-01-02', '2030-01-03', '2030-01-04'] });
    x.put('exportar 2.zip', iphoneZip(xml2), new Date('2030-01-05T12:00:00Z'));
    assert.equal(x.run().status, 0);
    assert.equal(x.state().file, 'exportar 2.zip');
    assert.equal(x.state().rows.weight, 4);
  } finally { x.cleanup(); }
});

test('import: a plain export.xml in the import folder is extracted directly (no work file)', () => {
  const x = setup();
  const xml = exportXml();
  const manual = manualExtract(xml);
  try {
    x.put('export.xml', xml);
    const r = x.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(x.snapshot(), manual.snapshot());
    assert.equal(x.state().file, 'export.xml');
    assert.equal(fs.existsSync(path.join(x.data, 'import-work')), false);
  } finally { x.cleanup(); manual.cleanup(); }
});

test('import: no import folder or nothing in it -> exit 0 with one line, nothing written', () => {
  const x = setup();
  try {
    let r = x.run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^import:health: nothing to import in .*import \(no \.zip or export\.xml\)\n$/);
    fs.rmSync(x.importDir, { recursive: true });
    r = x.run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^import:health: no import folder at .*import; nothing to import\n$/);
    assert.deepEqual(fs.readdirSync(x.data), ['files']);
  } finally { x.cleanup(); }
});

test('import errors: corrupt zip, no export entry, truncated export -> exit 1, previous extract untouched, lastError recorded, no work file', () => {
  const x = setup();
  try {
    x.put('exportar.zip', iphoneZip(), new Date('2030-01-03T12:00:00Z'));
    assert.equal(x.run().status, 0);
    const good = x.snapshot();
    const ok = x.state();
    const cases = [
      ['corrupt', 'bad.zip', Buffer.from('PK\x03\x04 this is not really a zip')],
      ['no-export', 'cda.zip', zipBuffer([{ name: 'apple_health_export/export_cda.xml', data: '<x/>' }])],
      ['truncated', 'cut.zip', iphoneZip(exportXml({ closed: false }))],
      ['corrupt', 'crc.zip', zipBuffer([{ name: ACCENTED, data: exportXml(), crc: 7 }])],
    ];
    let t = Date.parse('2030-02-01T00:00:00Z');
    for (const [code, name, buf] of cases) {
      t += 86_400_000;
      x.put(name, buf, new Date(t));
      const r = x.run();
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /^ERROR: import:health: /m, name);
      assert.deepEqual(x.snapshot(), good, `${name}: the previous extract is untouched`);
      const st = x.state();
      assert.deepEqual({ ...st, lastError: undefined }, { ...ok, lastError: undefined }, `${name}: the last good import is kept`);
      assert.equal(st.lastError.code, code, name);
      assert.equal(st.lastError.file, name);
      assert.equal(st.lastError.sha256, sha(buf));
      assert.deepEqual(x.work(), [], `${name}: no work file left`);
      assert.ok(fs.existsSync(path.join(x.importDir, name)), 'the bad file is kept');
    }
    // a later good import clears lastError
    x.put('good.zip', iphoneZip(exportXml({ days: ['2030-01-01', '2030-01-02'] })), new Date(t + 86_400_000));
    assert.equal(x.run().status, 0);
    assert.equal(x.state().lastError, undefined);
    assert.equal(x.state().file, 'good.zip');
  } finally { x.cleanup(); }
});

test('import: a work file left by a killed import (dead pid) is removed on the next run', () => {
  const x = setup();
  try {
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
    fs.mkdirSync(path.join(x.data, 'import-work'));
    fs.writeFileSync(path.join(x.data, 'import-work', `export.xml.${dead}.tmp`), 'left over');
    x.put('exportar.zip', iphoneZip());
    assert.equal(x.run().status, 0);
    assert.deepEqual(x.work(), []);
  } finally { x.cleanup(); }
});

test('CLI: --help exits 0 with the usage, an unknown flag exits 2 before anything runs', async () => {
  const x = setup();
  try {
    const help = x.run('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node scripts\/import-health\.mjs \[--force\]/);
    const bad = x.run('--nope');
    assert.equal(bad.status, 2);
    assert.deepEqual(fs.readdirSync(x.data), ['files']);
    // main() is importable and injectable (refresh.mjs runs the CLI as a child; the tests may call it directly)
    const lines = [];
    assert.equal(await main({}, { env: x.env, log: (m) => lines.push(m), error: (m) => lines.push(m) }), 0);
    assert.match(lines.join('\n'), /nothing to import/);
  } finally { x.cleanup(); }
});

// ---- the Shortcut layering after an import (sync-shortcut.mjs) ----

test('layering: import -> Shortcut sync gives the same extract as the manual flow (unzip -> extract.mjs -> sync)', () => {
  const x = setup();
  const xml = exportXml();
  const manual = manualExtract(xml);
  try {
    x.put('exportar.zip', iphoneZip(xml));
    assert.equal(x.run().status, 0);
    // a Shortcut payload: the export's partial last day (01-03) plus a newer day (01-04)
    const daily = (...pairs) => pairs.map(([d, v]) => `${d}T00:00:00+01:00;${v}`).join('\n');
    const items = [{ id: '1', payload: { hrv: '2030-01-04T07:00:00+01:00;45', steps_phone: daily(['2030-01-03', 5000], ['2030-01-04', 6000]) } }];
    syncDir(x.out, items);
    syncDir(manual.out, items);
    const strip = (snap) => Object.fromEntries(Object.entries(snap).map(([f, t]) => [f, f === '_meta.json' || f === '.shortcut-cache.json' ? JSON.parse(t) : t]));
    assert.deepEqual(strip(x.snapshot()), strip(manual.snapshot()));
    assert.ok(x.snapshot()['hrv.csv'].includes('2030-01-04,45,Shortcut'), 'the Shortcut rows layer on the imported extract');
  } finally { x.cleanup(); manual.cleanup(); }
});

// ---- hardening (verifier advisories A1-A5) ----

test('A1 zip: an entry declared over maxBytes is refused before anything is written (code too-large)', async () => {
  const x = setup();
  try {
    const zip = x.put('exportar.zip', iphoneZip());
    const entry = (await listZip(zip))[1];
    const dest = path.join(x.root, 'out.xml');
    await assert.rejects(extractEntry(zip, entry, dest, { maxBytes: entry.size - 1 }), { code: 'too-large' });
    assert.equal(fs.existsSync(dest), false, 'nothing written');
    await extractEntry(zip, entry, dest, { maxBytes: entry.size });
    assert.equal(fs.statSync(dest).size, entry.size);
  } finally { x.cleanup(); }
});

test('A1 import: an export over HC_IMPORT_MAX_BYTES -> exit 1, lastError too-large, no work file, extract untouched; a bad value exits 2', () => {
  const x = setup();
  try {
    x.put('exportar.zip', iphoneZip(), new Date('2030-01-03T12:00:00Z'));
    assert.equal(x.run().status, 0);
    const good = x.snapshot();
    x.put('big.zip', iphoneZip(exportXml({ days: ['2030-01-01', '2030-01-02', '2030-01-03', '2030-01-04'] })), new Date('2030-01-05T12:00:00Z'));
    x.env.HC_IMPORT_MAX_BYTES = '100';
    const r = x.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /HC_IMPORT_MAX_BYTES/);
    assert.equal(x.state().lastError.code, 'too-large');
    assert.equal(x.state().file, 'exportar.zip');
    assert.deepEqual(x.work(), []);
    assert.deepEqual(x.snapshot(), good);
    x.env.HC_IMPORT_MAX_BYTES = 'lots';
    const bad = x.run();
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /HC_IMPORT_MAX_BYTES/);
    delete x.env.HC_IMPORT_MAX_BYTES;
    assert.equal(x.run().status, 0);
    assert.equal(x.state().file, 'big.zip');
  } finally { x.cleanup(); }
});

test('A2: two entries that both match the export name are ambiguous (null / no-export), never first-wins', () => {
  const e = (...names) => names.map((name) => ({ name }));
  assert.equal(exportEntry(e('apple_health_export/export.xml', 'apple_health_export/exportación.xml')), null);
  assert.equal(exportEntry(e('apple_health_export/export.xml', 'apple_health_export/export.xml')), null);
  assert.equal(exportEntry(e('export.xml', 'apple_health_export/Export.xml')), null);
  const x = setup();
  try {
    x.put('two.zip', zipBuffer([{ name: 'apple_health_export/export.xml', data: exportXml() }, { name: ACCENTED, data: exportXml() }]));
    const r = x.run();
    assert.equal(r.status, 1);
    assert.equal(x.state().lastError.code, 'no-export');
  } finally { x.cleanup(); }
});

test('A3: an export without any <Record (zip or plain export.xml) is refused as empty and the extract is kept', () => {
  const x = setup();
  try {
    x.put('exportar.zip', iphoneZip(), new Date('2030-01-03T12:00:00Z'));
    assert.equal(x.run().status, 0);
    const good = x.snapshot();
    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="es_ES">\n<ExportDate value="2030-01-03 08:00:00 +0100"/>\n</HealthData>\n';
    let t = Date.parse('2030-02-01T00:00:00Z');
    for (const [name, buf] of [['empty.zip', iphoneZip(empty)], ['export.xml', Buffer.from(empty)]]) {
      t += 86_400_000;
      x.put(name, buf, new Date(t));
      const r = x.run();
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.equal(x.state().lastError.code, 'empty', name);
      assert.equal(x.state().file, 'exportar.zip');
      assert.deepEqual(x.snapshot(), good, name);
      assert.deepEqual(x.work(), []);
      fs.rmSync(path.join(x.importDir, name));
    }
  } finally { x.cleanup(); }
});

test('A4: skipping the newest file because it is the last successful import clears a stale lastError', () => {
  const x = setup();
  try {
    x.put('exportar.zip', iphoneZip(), new Date('2030-01-03T12:00:00Z'));
    assert.equal(x.run().status, 0);
    const ok = x.state();
    x.put('bad.zip', 'not a zip', new Date('2030-01-04T12:00:00Z'));
    assert.equal(x.run().status, 1);
    assert.equal(x.state().lastError.code, 'corrupt');
    fs.rmSync(path.join(x.importDir, 'bad.zip'));
    const r = x.run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /already imported/);
    assert.deepEqual(x.state(), ok);
  } finally { x.cleanup(); }
});

test('A5: same name + size + mtime as the last import is skipped without hashing; a new mtime is hashed; --force still imports', () => {
  const x = setup();
  try {
    const mtime = new Date('2030-01-03T12:00:00Z');
    const xml = exportXml();
    const f = x.put('export.xml', xml, mtime);
    assert.equal(x.run().status, 0);
    const st = x.state();
    assert.equal(st.mtimeMs, mtime.getTime());
    // same length, different bytes, same mtime: the fast path does not read it
    const other = xml.replace('value="1000"', 'value="2000"');
    assert.equal(other.length, xml.length);
    fs.writeFileSync(f, other);
    fs.utimesSync(f, mtime, mtime);
    const skip = x.run();
    assert.equal(skip.status, 0);
    assert.match(skip.stdout, /already imported/);
    assert.deepEqual(x.state(), st);
    // a new mtime -> hashed -> new content imported
    const later = new Date('2030-01-04T12:00:00Z');
    fs.utimesSync(f, later, later);
    assert.equal(x.run().status, 0);
    assert.notEqual(x.state().sha256, st.sha256);
    assert.equal(x.state().mtimeMs, later.getTime());
    // a touched but identical file is hashed, matches and is skipped
    fs.utimesSync(f, mtime, mtime);
    const same = x.run();
    assert.match(same.stdout, /already imported/);
    const forced = x.run('--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /imported in/);
  } finally { x.cleanup(); }
});
