/* Device manuals for the LAN page: copies ONLY the PDFs named by profile/profile.json
 * devices[].manual from data/gear/ (gitignored, the user's local copies) into
 * services/plan-web/site/manuales/, which plan-web nginx serves as /manuales/<file>.pdf. Run by
 * services/plan-web/refresh.sh after every publish (scripts/publish-manuals.mjs); a failure there never
 * blocks the page.
 *
 * Rules: a manual name is a bare file name (isManualFile: no folders, no dot-segments); the source must
 * be a REGULAR file directly in data/gear (a symlink is refused, opened with O_NOFOLLOW), start with the
 * PDF magic bytes and stay under MAX_MANUAL_BYTES; a missing / refused file is a warning and is not
 * published. Everything in the output folder that is not a published manual is removed (a stale
 * manual, a temp file). A broken or invalid profile.json leaves the folder untouched (the build ignores
 * such a file too; `npm run check` names the problem). A symlinked output folder is an error. Copies
 * are atomic (temp file + rename) and skipped when the published copy is already identical.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isManualFile } from './profile.mjs';
import { readManualProfile } from './read.mjs';

export const MAX_MANUAL_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-');

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The manual file names of the devices the profile sheet shows (hidden devices skipped), deduped. */
export function referencedManuals(manual) {
  const m = manual && typeof manual === 'object' ? manual : {};
  const hide = new Set((Array.isArray(m.hiddenDevices) ? m.hiddenDevices : []).map(str).filter(Boolean).map((n) => n.toLowerCase()));
  const out = [];
  for (const d of Array.isArray(m.devices) ? m.devices : []) {
    const name = str(d?.name);
    if (!name || hide.has(name.toLowerCase()) || !isManualFile(d.manual) || out.includes(d.manual)) continue;
    out.push(d.manual);
  }
  return out;
}

/** Reads one source with O_NOFOLLOW; {buf} or {problem} (missing | a reason it is refused). */
function readSource(gearDir, file, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(path.join(gearDir, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return { problem: 'missing' };
    if (err.code === 'ELOOP') return { problem: 'is a symlink' };
    return { problem: `cannot be read (${err.code || 'error'})` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { problem: 'is not a regular file' };
    if (st.size > maxBytes) return { problem: `is larger than ${Math.round(maxBytes / 1024 / 1024)} MB` };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (!n) break;
      off += n;
    }
    if (off !== st.size || !buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return { problem: 'is not a PDF' };
    return { buf };
  } catch (err) {
    return { problem: `cannot be read (${err.code || 'error'})` };
  } finally {
    fs.closeSync(fd);
  }
}

function sameFile(dest, buf) {
  try {
    const st = fs.lstatSync(dest);
    return st.isFile() && st.size === buf.length && fs.readFileSync(dest).equals(buf);
  } catch {
    return false;
  }
}

/**
 * {published, missing, refused, removed, skipped}. Throws only when the output folder cannot be used
 * (a symlink, not a directory) — the caller logs it and keeps the page.
 */
export function publishManuals({ profileFile, gearDir, outDir, maxBytes = MAX_MANUAL_BYTES, warn = console.warn }) {
  const result = { published: [], missing: [], refused: [], removed: [], skipped: false };
  const { data, error } = readManualProfile(profileFile);
  if (error) {
    warn(`WARNING: ${error}\n  Device manuals left as they are until profile.json is fixed.`);
    result.skipped = true;
    return result;
  }
  const wanted = referencedManuals(data);

  if (fs.existsSync(outDir) || isLink(outDir)) {
    const st = fs.lstatSync(outDir);
    if (st.isSymbolicLink()) throw new Error(`${outDir} is a symlink, refusing to publish manuals through it`);
    if (!st.isDirectory()) throw new Error(`${outDir} is not a directory`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const file of wanted) {
    const src = readSource(gearDir, file, maxBytes);
    if (src.problem === 'missing') {
      result.missing.push(file);
      warn(`WARNING: device manual ${file} not found in data/gear/, not published.`);
      continue;
    }
    if (src.problem) {
      result.refused.push(file);
      warn(`WARNING: device manual ${file} ${src.problem}, not published.`);
      continue;
    }
    const dest = path.join(outDir, file);
    if (!sameFile(dest, src.buf)) {
      const tmp = path.join(outDir, `.${file}.tmp`);
      fs.writeFileSync(tmp, src.buf, { mode: 0o644 });
      fs.renameSync(tmp, dest);
    }
    result.published.push(file);
  }

  for (const entry of fs.readdirSync(outDir).sort()) {
    if (result.published.includes(entry)) continue;
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
    result.removed.push(entry);
  }
  return result;
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
