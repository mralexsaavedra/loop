#!/usr/bin/env node
/* Pulls the in-page onboarding document (GET <INGEST_URL>/food/profile, the profile + accepted nutrition
 * targets of a user without an AI coach) into loop-data/profile/onboarding.json, which the build reads.
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/loop-ingest/.env>, else
 *          :8088). No token: /food/* is the unauthenticated, LAN-only layer (header X-HC-Food: 1).
 * Output : loop-data/profile/onboarding.json (gitignored), replaced atomically and only when it changed. A wizard
 *          never completed (profile null) writes nothing.
 * Errors : a missing / old service (404, 503) or a malformed body only WARNS and keeps the previous file
 *          (exit 0), like the settings sync; a write failure exits 1. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseUrl, fetchJson, writeAtomic, runCli } from '../data/apple-health/sync-common.mjs';
import { ONBOARDING_JSON, normalizeOnboarding } from '../lib/profile/onboarding.mjs';
import { isMain } from './lib/is-main.mjs';
import { dataPaths, displayPath } from '../lib/paths.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The folder onboarding.json lands in (lib/paths.mjs: data/profile, or <HC_DATA_DIR>/profile). */
export const defaultOut = (env = process.env) => dataPaths({ repoRoot: ROOT, env }).profileDir;

async function fetchProfile(baseUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    return await fetchJson(`${baseUrl}/food/profile`, null, {
      fetchImpl, timeoutMs, headers: { 'x-hc-food': '1', accept: 'application/json' }, redirect: 'error',
    });
  } catch (err) {
    if (err.status === 404) err.message += ' (rebuild the loop-ingest container)';
    throw err;
  }
}

export async function main({ env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch } = {}) {
  const dir = env.SYNC_PROFILE_OUT_DIR || defaultOut(env);
  const base = readBaseUrl(env);
  let doc;
  try {
    doc = normalizeOnboarding(await fetchProfile(base, { fetchImpl }));
  } catch (err) {
    warn(`WARNING: onboarding sync skipped (${err.message}); the previous ${ONBOARDING_JSON} is kept`);
    return 0;
  }
  if (doc === null) {
    log('Onboarding: not completed on the page; nothing written');
    return 0;
  }
  try {
    const file = path.join(dir, ONBOARDING_JSON);
    const text = JSON.stringify(doc, null, 2) + '\n';
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (prev === text) {
      log('Onboarding: unchanged');
      return 0;
    }
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(file, text);
    log(`Onboarding: written -> ${displayPath(ROOT, file)}`);
    return 0;
  } catch (err) {
    warn(`ERROR: onboarding sync could not write ${ONBOARDING_JSON} (${err.message})`);
    return 1;
  }
}

const USAGE = `Usage: node scripts/sync-onboarding.mjs

Pulls the in-page onboarding document from the ingest service into loop-data/profile/onboarding.json.
  -h, --help   this help
Env: INGEST_URL, INGEST_ENV_FILE (default services/loop-ingest/.env, for its INGEST_PORT).`;

if (isMain(import.meta.url)) runCli(() => main(), { guardDataRoot: true, usage: USAGE });
