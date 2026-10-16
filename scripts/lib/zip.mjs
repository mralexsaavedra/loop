/* A minimal, read-only zip reader for the Apple Health export (scripts/import-health.mjs): lists the entries from the
 * central directory and streams ONE entry into a file, inflating it (Node's zlib) and checking its CRC-32 and size.
 * No dependency and no `unzip` binary, so the import behaves the same in the loop-server image (busybox), on a host
 * clone and on macOS / Windows, and a damaged zip is always detected (busybox `unzip -p` with a name that matches
 * nothing writes an empty file and exits 0).
 *
 * Handles what the iPhone writes: data descriptors (sizes only in the central directory), entry names in UTF-8
 * without the UTF-8 flag (`exportación.xml`, NFD), and zip64 (an export over 4 GB uncompressed). Methods: stored (0)
 * and deflate (8). Encrypted entries, other methods and multi-disk archives are refused. Every refusal is a
 * ZipError with code 'corrupt' (the import's error code for a zip it cannot read), except an entry over the caller's
 * byte cap: code 'too-large' (zip64 can declare ~2^53 bytes; the cap keeps a hostile zip from filling the disk).
 *
 *   listZip(file)                    -> [{ name, method, flags, crc32, compressedSize, size, localOffset }]
 *   extractEntry(file, entry, dest, { maxBytes, onChunk })
 *                                    -> writes dest (exclusive create, 0600), rejects on a CRC / size mismatch; an
 *                                       entry declared over maxBytes is refused before dest is created, and the
 *                                       output is cut off at maxBytes while streaming; onChunk sees every inflated
 *                                       chunk (the import's scan for <Record, no second read) */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class ZipError extends Error {
  constructor(message, code = 'corrupt') {
    super(message);
    this.code = code;
  }
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;
// the central directory of a Health export is a few KB (one entry per workout route); refuse absurd sizes
const MAX_CENTRAL_BYTES = 64 * 1024 * 1024;

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Entry names: UTF-8 when flagged OR when the bytes are valid UTF-8 (the iPhone omits the flag), else CP437-ish
 * latin1 (enough to match ASCII names). */
function decodeName(buf, flags) {
  if (flags & 0x800) return buf.toString('utf8');
  try { return utf8.decode(buf); } catch { return buf.toString('latin1'); }
}

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buf : buf.subarray(0, done);
}

const big = (b, at) => {
  const v = b.readBigUInt64LE(at);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('zip64 value out of range');
  return Number(v);
};

/** The entries of `file`, from its central directory. */
export async function listZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + MAX_COMMENT);
    const tail = readAt(fd, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) { at = i; break; }
    }
    if (at < 0) throw new ZipError('not a zip file, or cut off (no end of central directory)');
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdOffset = tail.readUInt32LE(at + 16);
    if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) throw new ZipError('multi-disk zip archives are not supported');
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locPos = size - tailLen + at - 20;
      const loc = locPos >= 0 ? readAt(fd, locPos, 20) : Buffer.alloc(0);
      if (loc.length < 20 || loc.readUInt32LE(0) !== ZIP64_LOCATOR) throw new ZipError('zip64 end of central directory locator missing');
      const recPos = big(loc, 8);
      const rec = readAt(fd, recPos, 56);
      if (rec.length < 56 || rec.readUInt32LE(0) !== ZIP64_EOCD) throw new ZipError('zip64 end of central directory missing');
      count = big(rec, 32);
      cdSize = big(rec, 40);
      cdOffset = big(rec, 48);
    }
    if (cdSize > MAX_CENTRAL_BYTES || cdOffset + cdSize > size) throw new ZipError('central directory out of bounds');
    const cd = readAt(fd, cdOffset, cdSize);
    if (cd.length < cdSize) throw new ZipError('central directory cut off');
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new ZipError(`central directory entry ${n + 1} is damaged`);
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc32 = cd.readUInt32LE(p + 16);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw new ZipError(`central directory entry ${n + 1} is cut off`);
      const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), flags);
      // zip64 extended information (0x0001): only the fields whose 32-bit value is 0xffffffff, in this order
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          const take = () => { if (q + 8 > x + 4 + len) throw new ZipError(`zip64 field of ${name} is cut off`); const v = big(cd, q); q += 8; return v; };
          if (entrySize === 0xffffffff) entrySize = take();
          if (compressedSize === 0xffffffff) compressedSize = take();
          if (localOffset === 0xffffffff) localOffset = take();
        }
        x += 4 + len;
      }
      entries.push({ name, method, flags, crc32, compressedSize, size: entrySize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** Streams `entry` of `file` into `dest` (created exclusively, mode 0600; the caller removes it on failure).
 * @param {{ maxBytes?: number, onChunk?: (chunk: Buffer) => void }} [opts] */
export async function extractEntry(file, entry, dest, opts = {}) {
  const { maxBytes = Infinity, onChunk } = opts;
  const tooLarge = () => new ZipError(`${entry.name} is larger than the ${maxBytes}-byte cap`, 'too-large');
  if (entry.size > maxBytes) throw tooLarge();
  if (entry.flags & 0x1) throw new ZipError(`${entry.name} is encrypted`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name} uses compression method ${entry.method} (only stored and deflate are supported)`);
  const fd = fs.openSync(file, 'r');
  let start;
  let fileSize;
  try {
    fileSize = fs.fstatSync(fd).size;
    const local = readAt(fd, entry.localOffset, 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL) throw new ZipError(`local header of ${entry.name} is damaged`);
    start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    fs.closeSync(fd);
  }
  if (start + entry.compressedSize > fileSize) throw new ZipError(`${entry.name} runs past the end of the zip (cut off)`);
  let crc = 0;
  let written = 0;
  const check = new Transform({
    transform(chunk, _enc, cb) {
      crc = zlib.crc32(chunk, crc);
      written += chunk.length;
      if (written > maxBytes) cb(tooLarge());
      else if (written > entry.size) cb(new ZipError(`${entry.name} inflates past its recorded size`));
      else {
        if (onChunk) onChunk(chunk);
        cb(null, chunk);
      }
    },
  });
  const source = entry.compressedSize > 0 ? fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 }) : Readable.from([]);
  const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  try {
    if (entry.method === 8 && entry.compressedSize > 0) await pipeline(source, zlib.createInflateRaw(), check, out);
    else await pipeline(source, check, out);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    if (err && typeof err.code === 'string' && err.code.startsWith('Z_')) throw new ZipError(`${entry.name} does not inflate (${err.message})`);
    throw err;
  }
  if (written !== entry.size || (crc >>> 0) !== (entry.crc32 >>> 0)) {
    throw new ZipError(`${entry.name} is damaged (CRC-32 or size mismatch)`);
  }
}
