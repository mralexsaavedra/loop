#!/usr/bin/env node
/* Pulls the owner's documents (GET <INGEST_URL>/documents/:kind, services/loop-ingest/src/documents.js) into the
 * files the build, the syncs and the coach read: profile -> profile/profile.json, plan ->
 * data/nutrition/plan-data.json, training -> data/training/training-data.json (under HC_DATA_DIR:
 * <data root>/cache/{profile,plan,training}.json, lib/paths.mjs). Runs FIRST in `npm run sync`:
 * sync-strava reads maxHr from profile.json.
 *
 * The database is the source once a document is saved there, but a hand edit is never lost: the sync state
 * (scripts/lib/documents.mjs, data/profile/documents-sync.json) records what was last synced or pushed, and a
 * file that differs from it AND from the database is a local edit not pushed yet: kept, with a warning naming
 * `npm run documents -- push <kind>` (send it) and `npm run documents -- pull <kind> --force` (take the
 * database's, the file backed up to backups/<same path>.documents.bak first).
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else
 *          :8088), INGEST_TOKEN (else from that .env): the routes take the bearer token.
 *          HC_DATA_DIR / HC_FILES_DIR: the data root (lib/paths.mjs).
 *          SYNC_DOCUMENTS_ROOT: the clone root the files are resolved against (tests), default this clone.
 * Output : each file replaced atomically and only when its content changed (compared as parsed JSON, so a file
 *          with the same content in another formatting is left alone); 2-space JSON, the document's key order.
 *          A document never saved (null) writes nothing and keeps the file. The state file is updated.
 * Errors : no token, a missing / old service (404, 503, 401) or a body that is not the document's shape only
 *          WARNS and keeps that file (exit 0), like the other page-data syncs; a write failure exits 1 (the
 *          other documents still sync). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseUrl, readIngestToken, fetchJson, runCli } from '../data/apple-health/sync-common.mjs';
import { validateDocument } from '../services/loop-ingest/src/documents.js';
import {
  DOCUMENT_FILES, KINDS, documentLayout, contentHash, readState, recordState, readDocumentFile, writeDocumentFile, backupDocumentFile,
} from './lib/documents.mjs';
import { isMain } from './lib/is-main.mjs';

export { DOCUMENT_FILES };
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The document of a GET /documents/:kind body: {doc (null = never saved), revision}; throws on any other shape. */
export function documentOf(kind, body) {
  if (!body || typeof body !== 'object' || body.kind !== kind || !('document' in body) || !Number.isInteger(body.revision)) {
    throw new Error('unexpected response');
  }
  if (body.document === null) return { doc: null, revision: body.revision };
  const field = validateDocument(kind, body.document);
  if (field) throw new Error(`malformed document (${field})`);
  return { doc: body.document, revision: body.revision };
}

/** GET /documents/:kind with the bearer token: {doc, revision}. */
export function fetchDocument(base, token, kind, fetchImpl) {
  return fetchJson(`${base}/documents/${kind}`, token, { fetchImpl, timeoutMs: 10000, redirect: 'error' })
    .then((body) => documentOf(kind, body));
}

/**
 * Pulls `kinds` (default all, in sync order). `force` takes the database's document over a local edit, backing
 * the file up first. Returns the exit code: 1 when a file could not be written; with `strict` (an explicit
 * `npm run documents -- pull`) also when a document was skipped (no token, a service error, a local edit kept).
 */
export async function main({ env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch, kinds = KINDS, force = false, strict = false } = {}) {
  const docs = documentLayout(env.SYNC_DOCUMENTS_ROOT || ROOT, env);
  const token = readIngestToken(env);
  if (!token) {
    warn('WARNING: document sync skipped (no ingest token: set INGEST_TOKEN or create services/loop-ingest/.env); the files are kept');
    return strict ? 1 : 0;
  }
  const base = readBaseUrl(env);
  const state = readState(docs);
  let code = 0;
  let skipped = 0;
  for (const kind of kinds) {
    const rel = docs.rel(kind);
    let remote;
    try {
      remote = await fetchDocument(base, token, kind, fetchImpl);
    } catch (err) {
      const hint = err.status === 404 ? ' (rebuild the loop-ingest container)' : '';
      warn(`WARNING: ${kind} document sync skipped (${err.message}${hint}); ${rel} is kept`);
      skipped += 1;
      continue;
    }
    if (remote.doc === null) {
      log(`Documents: ${kind} not in the database yet; ${rel} kept`);
      continue;
    }
    try {
      const hash = contentHash(remote.doc);
      let local;
      try {
        local = readDocumentFile(docs, kind);
      } catch {
        local = { doc: undefined, hash: null }; // a broken file is a local state like any other edit
      }
      if (local?.hash === hash) {
        if (state[kind]?.revision !== remote.revision || state[kind]?.hash !== hash) recordState(docs, kind, remote.revision, hash);
        log(`Documents: ${kind} unchanged`);
        continue;
      }
      const untouched = local === null || (state[kind] && local.hash === state[kind].hash);
      if (!untouched && !force) {
        warn(`WARNING: ${rel} has changes that are not in the database; kept. Send them with \`npm run documents -- push ${kind}\`, or take the database's with \`npm run documents -- pull ${kind} --force\` (the file is backed up first)`);
        skipped += 1;
        continue;
      }
      const backup = untouched ? null : backupDocumentFile(docs, kind);
      writeDocumentFile(docs, kind, remote.doc);
      recordState(docs, kind, remote.revision, hash);
      log(`Documents: ${kind} written -> ${rel}${backup ? ` (your version backed up to ${backup})` : ''}`);
    } catch (err) {
      warn(`ERROR: ${kind} document sync could not write ${rel} (${err.message})`);
      code = 1;
    }
  }
  return strict && skipped ? Math.max(code, 1) : code;
}

const USAGE = `Usage: node scripts/sync-documents.mjs

Pulls the owner's documents (profile, nutrition plan, training program) from the ingest service into
profile/profile.json, data/nutrition/plan-data.json and data/training/training-data.json (with HC_DATA_DIR:
cache/profile.json, cache/plan.json and cache/training.json under it). A file with
changes that are not in the database is kept (see npm run documents).
  -h, --help   this help
Env: INGEST_URL, INGEST_TOKEN, INGEST_ENV_FILE (default services/loop-ingest/.env, for INGEST_PORT and INGEST_TOKEN),
HC_DATA_DIR (the data root).`;

if (isMain(import.meta.url)) runCli(() => main(), { usage: USAGE });
