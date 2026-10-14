#!/usr/bin/env node
/* Pulls the in-page onboarding document (GET <INGEST_URL>/food/profile, the profile + accepted nutrition
 * targets of a user without an AI coach) into data/profile/onboarding.json, which the build reads.
 *
 * Env    : INGEST_URL (default http://localhost:<INGEST_PORT of this clone's services/health-ingest/.env>, else
 *          :8088). No token: /food/* is the unauthenticated, LAN-only layer (header X-HC-Food: 1).
 * Output : data/profile/onboarding.json (gitignored), replaced atomically and only when it changed. A wizard
 *          never completed (profile null) writes nothing.
 * Errors : a missing / old service (404, 503) or a malformed body only WARNS and keeps the previous file
 *          (exit 0), like the settings sync; a write failure exits 1. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseUrl, ENV_FILE, writeAtomic } from '../data/apple-health/sync-common.mjs';
import { ONBOARDING_JSON, normalizeOnboarding } from '../lib/profile/onboarding.mjs';
import { isMain } from './lib/is-main.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_OUT = path.join(ROOT, 'data', 'profile');

async function fetchProfile(baseUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/food/profile`, {
      headers: { 'x-hc-food': '1', accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`ingest service answered HTTP ${res.status}${res.status === 404 ? ' (rebuild the health-ingest container)' : ''}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError' || ctrl.signal.aborted) throw new Error(`request timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function main({ env = process.env, log = console.log, warn = console.warn, fetchImpl = fetch } = {}) {
  const dir = env.SYNC_PROFILE_OUT_DIR || DEFAULT_OUT;
  const base = readBaseUrl(env, env.INGEST_ENV_FILE || ENV_FILE);
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
    log(`Onboarding: written -> ${path.relative(ROOT, file)}`);
    return 0;
  } catch (err) {
    warn(`ERROR: onboarding sync could not write ${ONBOARDING_JSON} (${err.message})`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code));
}
