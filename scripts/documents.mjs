#!/usr/bin/env node
/* The coach's side of the owner's documents (the profile, the nutrition plan, the training program; the
 * database copy is services/loop-ingest/src/documents.js, the files are scripts/lib/documents.mjs documentLayout:
 * cache/ of the data root: loop-data/ in the clone (DOCUMENT_FILES), or HC_DATA_DIR).
 *
 *   npm run documents -- push <kind|all> [--force]   file -> database
 *   npm run documents -- pull <kind|all> [--force]   database -> file (what `npm run sync` does for all)
 *
 * The way to change a document: `npm run sync`, edit the file, `npm run documents -- push <kind>`. The first
 * push of a document is its import into the database.
 *
 * push: the file must pass the full rules the build applies (validateNutrition with ingredients.json,
 * validateProgram, validateManual) or nothing is sent. It is saved at the revision last synced or pushed (the
 * sync state), so a database changed since then is never overwritten: the push refuses and names both ways
 * out. --force saves over the database's current revision. A file equal to the database's only records the
 * state.
 * pull: like the sync for the named documents, but a document it could not write (no token, service error, a
 * local edit kept) exits 1; --force takes the database's document over a local edit, the file backed up to
 * backups/<same path>.documents.bak first.
 *
 * Env: INGEST_URL, INGEST_TOKEN, INGEST_ENV_FILE (as `npm run sync`); HC_DATA_DIR (the data root, lib/paths.mjs);
 * SYNC_DOCUMENTS_ROOT (tests).
 * `push all` skips a document whose file does not exist (an install without a training program); naming that
 * kind alone is an error.
 * Exit: 0 done, 1 a document was refused or could not be sent / written, 2 bad usage.
 */
import { parseArgs } from 'node:util';
import { readBaseUrl, readIngestToken } from '../data/apple-health/sync-common.mjs';
import { KINDS, documentLayout, contentHash, readState, recordState, readDocumentFile, documentProblems } from './lib/documents.mjs';
import { main as pull, fetchDocument, ROOT } from './sync-documents.mjs';
import { isMain } from './lib/is-main.mjs';

export const USAGE = `Usage: npm run documents -- <push|pull> <profile|plan|training|all> [--force]

  push   validate the file and save it in the database (the first push imports it)
  pull   write the database's document into the file (npm run sync does this for all)
  --force  push: save over a database changed since your last sync
           pull: replace a file with changes that are not in the database (backed up first)
  -h, --help   this help

Files: ${KINDS.map((k) => `${k} = ${documentLayout(ROOT).rel(k)}`).join(', ')}
Env: INGEST_URL, INGEST_TOKEN, INGEST_ENV_FILE (default services/loop-ingest/.env).`;

/** PUT /documents/:kind {revision, document}: {status, body}. */
async function putDocument(base, token, kind, revision, document, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl(`${base}/documents/${kind}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ revision, document }),
      redirect: 'error',
      signal: ctrl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* a non-JSON answer keeps body null */ }
    return { status: res.status, body };
  } catch (err) {
    // eslint-disable-next-line preserve-caught-error
    if (ctrl.signal.aborted) throw new Error('request timed out after 15 s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function pushOne({ root, docs, base, token, kind, force, all, fetchImpl, log, warn }) {
  const rel = docs.rel(kind);
  let local;
  try {
    local = readDocumentFile(docs, kind);
  } catch (err) {
    warn(`ERROR: ${kind} not pushed: ${err.message}`);
    return 1;
  }
  if (!local) {
    // `push all` on an install without an optional file (no training program yet): nothing to send, not an error
    if (all) {
      log(`Documents: ${kind} skipped (${rel} does not exist)`);
      return 0;
    }
    warn(`ERROR: ${kind} not pushed: ${rel} does not exist`);
    return 1;
  }
  const problems = documentProblems(root, kind, local.doc);
  if (problems.length) {
    warn(`ERROR: ${kind} not pushed: ${rel} breaks the rules the page build applies:\n  - ${problems.join('\n  - ')}`);
    return 1;
  }
  let remote;
  try {
    remote = await fetchDocument(base, token, kind, fetchImpl);
  } catch (err) {
    warn(`ERROR: ${kind} not pushed: the data service could not be read (${err.message})`);
    return 1;
  }
  if (remote.doc !== null && contentHash(remote.doc) === local.hash) {
    recordState(docs, kind, remote.revision, local.hash);
    log(`Documents: ${kind} already in the database (revision ${remote.revision})`);
    return 0;
  }
  const known = readState(docs)[kind];
  // the revision this file was based on: the last sync / push, or none for a first import. A database without
  // the document (a first import, or a database reset since the last sync) has nothing to lose: save at 0.
  const against = force || remote.doc === null ? remote.revision : known ? known.revision : 0;
  if (!force && against !== remote.revision) {
    warn(`ERROR: ${kind} not pushed: the database changed since your last sync (revision ${remote.revision}, yours ${against}). `
      + `Take the database's with \`npm run documents -- pull ${kind} --force\` (your file is backed up) and redo your change, `
      + `or replace it with \`npm run documents -- push ${kind} --force\``);
    return 1;
  }
  let res;
  try {
    res = await putDocument(base, token, kind, against, local.doc, fetchImpl);
  } catch (err) {
    warn(`ERROR: ${kind} not pushed: the data service could not be reached (${err.message})`);
    return 1;
  }
  if (res.status === 409) {
    warn(`ERROR: ${kind} not pushed: the database changed while pushing (revision ${res.body?.revision}). `
      + `Take the database's with \`npm run documents -- pull ${kind} --force\` (your file is backed up) and redo your change, `
      + `or replace it with \`npm run documents -- push ${kind} --force\``);
    return 1;
  }
  if (res.status !== 200 || !Number.isInteger(res.body?.revision)) {
    const why = res.body?.error ? `${res.body.error}${res.body.field ? ` (${res.body.field})` : ''}` : 'no detail';
    warn(`ERROR: ${kind} not pushed: the data service answered HTTP ${res.status}, ${why}`);
    return 1;
  }
  recordState(docs, kind, res.body.revision, local.hash);
  log(`Documents: ${kind} pushed from ${rel} (revision ${res.body.revision})`);
  return 0;
}

/** argv -> {command, kinds, force} or {exit, out|err}. */
export function parseCommand(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  } catch (err) {
    return { exit: 2, err: `ERROR: ${err.message}\n\n${USAGE}` };
  }
  if (parsed.values.help) return { exit: 0, out: USAGE };
  const [command, target, ...rest] = parsed.positionals;
  if (!['push', 'pull'].includes(command) || !(target === 'all' || KINDS.includes(target)) || rest.length) {
    return { exit: 2, err: `ERROR: expected push or pull and one of ${KINDS.join(', ')}, all\n\n${USAGE}` };
  }
  return { command, kinds: target === 'all' ? [...KINDS] : [target], all: target === 'all', force: parsed.values.force === true };
}

export async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch } = {}) {
  const cmd = parseCommand(argv);
  if (cmd.exit != null) {
    if (cmd.exit) warn(cmd.err); else log(cmd.out);
    return cmd.exit;
  }
  if (cmd.command === 'pull') return pull({ env, log, warn, fetchImpl, kinds: cmd.kinds, force: cmd.force, strict: true });
  const root = env.SYNC_DOCUMENTS_ROOT || ROOT;
  const docs = documentLayout(root, env);
  const token = readIngestToken(env);
  if (!token) {
    warn('ERROR: no ingest token: set INGEST_TOKEN or create services/loop-ingest/.env. Nothing pushed.');
    return 1;
  }
  const base = readBaseUrl(env);
  let code = 0;
  for (const kind of cmd.kinds) {
    code = Math.max(code, await pushOne({ root, docs, base, token, kind, force: cmd.force, all: cmd.all, fetchImpl, log, warn }));
  }
  return code;
}

if (isMain(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(`ERROR: ${err?.message ?? err}`); process.exitCode = 1; });
}
