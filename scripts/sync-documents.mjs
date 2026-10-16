#!/usr/bin/env node
/* Pulls the owner's documents (GET <INGEST_URL>/documents/:kind, services/loop-ingest/src/documents.js) into the
 * files the build, the syncs and the coach read: profile -> profile/profile.json, plan ->
 * data/nutrition/plan-data.json, training -> data/training/training-data.json. Runs FIRST in `npm run sync`:
 * sync-strava reads maxHr from profile.json.
 *
 * The database is the source once a document is saved there: a file whose content differs is replaced, so a
 * hand edit of a synced file is lost on the next sync (change the document through the service instead).
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else
 *          :8088), INGEST_TOKEN (else from that .env): the routes take the bearer token.
 *          SYNC_DOCUMENTS_ROOT: the root the files are written under (tests), default this clone.
 * Output : each file replaced atomically and only when its content changed (compared as parsed JSON, so a file
 *          with the same content in another formatting is left alone); 2-space JSON, the document's key order.
 *          A document never saved (null) writes nothing and keeps the file.
 * Errors : no token, a missing / old service (404, 503, 401) or a body that is not the document's shape only
 *          WARNS and keeps that file (exit 0), like the other page-data syncs; a write failure exits 1 (the
 *          other documents still sync). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseUrl, readIngestToken, fetchJson, writeAtomic, runCli } from '../data/apple-health/sync-common.mjs';
import { validateDocument } from '../services/loop-ingest/src/documents.js';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** kind -> the clone file it becomes, in sync order (profile first: sync-strava reads its maxHr). */
export const DOCUMENT_FILES = Object.freeze({
  profile: 'profile/profile.json',
  plan: 'data/nutrition/plan-data.json',
  training: 'data/training/training-data.json',
});

/** The document of a GET /documents/:kind body (null = never saved); throws on any other shape. */
function documentOf(kind, body) {
  if (!body || typeof body !== 'object' || body.kind !== kind || !('document' in body)) throw new Error('unexpected response');
  if (body.document === null) return null;
  const field = validateDocument(kind, body.document);
  if (field) throw new Error(`malformed document (${field})`);
  return body.document;
}

function sameContent(file, text) {
  if (!fs.existsSync(file)) return false;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === text;
  } catch {
    return false; // an unreadable / broken file is replaced
  }
}

export async function main({ env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch } = {}) {
  const root = env.SYNC_DOCUMENTS_ROOT || ROOT;
  const token = readIngestToken(env);
  if (!token) {
    warn('WARNING: document sync skipped (no ingest token: set INGEST_TOKEN or create services/loop-ingest/.env); the files are kept');
    return 0;
  }
  const base = readBaseUrl(env);
  let code = 0;
  for (const [kind, rel] of Object.entries(DOCUMENT_FILES)) {
    let doc;
    try {
      doc = documentOf(kind, await fetchJson(`${base}/documents/${kind}`, token, { fetchImpl, timeoutMs: 10000, redirect: 'error' }));
    } catch (err) {
      const hint = err.status === 404 ? ' (rebuild the loop-ingest container)' : '';
      warn(`WARNING: ${kind} document sync skipped (${err.message}${hint}); ${rel} is kept`);
      continue;
    }
    if (doc === null) {
      log(`Documents: ${kind} not in the database yet; ${rel} kept`);
      continue;
    }
    const file = path.join(root, rel);
    if (sameContent(file, JSON.stringify(doc))) {
      log(`Documents: ${kind} unchanged`);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
      log(`Documents: ${kind} written -> ${rel}`);
    } catch (err) {
      warn(`ERROR: ${kind} document sync could not write ${rel} (${err.message})`);
      code = 1;
    }
  }
  return code;
}

const USAGE = `Usage: node scripts/sync-documents.mjs

Pulls the owner's documents (profile, nutrition plan, training program) from the ingest service into
profile/profile.json, data/nutrition/plan-data.json and data/training/training-data.json.
  -h, --help   this help
Env: INGEST_URL, INGEST_TOKEN, INGEST_ENV_FILE (default services/loop-ingest/.env, for INGEST_PORT and INGEST_TOKEN).`;

if (isMain(import.meta.url)) runCli(() => main(), { usage: USAGE });
