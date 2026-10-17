#!/usr/bin/env node
/* `npm run connect -- <url>`: makes this clone the coach client of a LOOP server for good. It checks that <url>
 * answers GET /export/files with the token (a LOOP server installed with the images, docs/data-pipeline.md -> Coach
 * as a client of a LOOP server) and saves {url, token} in <data root>/server.json (mode 600, gitignored with the
 * data root), which every sync then reads after the environment and before services/loop-ingest/.env
 * (data/apple-health/sync-common.mjs). No more INGEST_URL / INGEST_TOKEN in every new terminal.
 *
 *   npm run connect -- <url>        the token from INGEST_TOKEN, else asked in the terminal (not echoed)
 *   npm run connect -- --forget     removes the saved server
 *
 * 200 = saved; 401 = the token was refused, 404 = a host-mode LOOP server (its clone syncs on its own: INGEST_URL /
 * INGEST_TOKEN or services/loop-ingest/.env), anything else = not reachable: ERROR, exit 1, nothing saved. The token
 * is never printed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMain } from './lib/is-main.mjs';
import { dataRootGuardError } from './lib/data-root-guard.mjs';
import { serverFileOf } from '../data/apple-health/sync-common.mjs';
import { displayPath } from '../lib/paths.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_MS = 15000;

export const USAGE = `Usage: npm run connect -- <url> | --forget

Saves the LOOP server this clone is a client of (its data port, e.g. http://192.168.1.10:8088) with its token in
loop-data/server.json (mode 600; HC_DATA_DIR's server.json), after checking the server answers GET /export/files
with the token. Every \`npm run sync\` then uses it (INGEST_URL / INGEST_TOKEN in the environment still win).
The token comes from INGEST_TOKEN, else it is asked in the terminal (not echoed).
  --forget     remove the saved server
  -h, --help   this help`;

/** The URL to save (no trailing slash), or null: http(s), no credentials, no query or fragment, no path. */
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return `${u.protocol}//${u.host}`;
}

/** Reads one line from the terminal without echoing it. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** GET <url>/export/files with the token: the HTTP status, or throws (no answer, timeout). */
async function probe(url, token, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${url}/export/files`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: ctrl.signal });
    await res.body?.cancel?.();
    return res.status;
  } catch (err) {
    // eslint-disable-next-line preserve-caught-error
    if (ctrl.signal.aborted) throw new Error(`no answer after ${TIMEOUT_MS / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function save(file, url, token) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ url, token }, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * The CLI; returns the exit code. `isTTY` / `prompt` / `fetchImpl` are injected by the tests (scripts/connect.test.mjs);
 * SYNC_CLIENT_ROOT = the clone root the data root resolves against (tests), default this clone.
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, log?: (m: string) => void, warn?: (m: string) => void, fetchImpl?: typeof fetch, isTTY?: boolean, prompt?: (q: string) => Promise<string> }} [opts]
 */
export async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, warn = console.error, fetchImpl = fetch, isTTY = Boolean(process.stdin.isTTY), prompt = promptHidden } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { forget: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (err) {
    warn(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    log(USAGE);
    return 0;
  }
  if (values.forget ? positionals.length !== 0 : positionals.length !== 1) {
    warn(USAGE);
    return 2;
  }
  const repoRoot = env.SYNC_CLIENT_ROOT || ROOT;
  const guard = dataRootGuardError({ repoRoot, env });
  if (guard) {
    warn(`ERROR: ${guard}`);
    return 1;
  }
  const file = serverFileOf(env);
  const shown = displayPath(repoRoot, file);
  if (values.forget) {
    if (!fs.existsSync(file)) {
      log(`No saved server (${shown} does not exist)`);
      return 0;
    }
    fs.rmSync(file);
    log(`Forgot the saved server (${shown} removed); npm run sync now uses INGEST_URL / INGEST_TOKEN or services/loop-ingest/.env`);
    return 0;
  }
  const url = normalizeUrl(positionals[0]);
  if (!url) {
    warn(`ERROR: ${JSON.stringify(positionals[0]).slice(0, 80)} is not a server URL: give http(s)://<host>:<port> (the server's data port, INGEST_PORT of its docker/.env), no path, query or credentials; nothing saved`);
    return 1;
  }
  let token = String(env.INGEST_TOKEN ?? '').trim();
  if (!token) {
    if (!isTTY) {
      warn('ERROR: no token: set INGEST_TOKEN for this one command (the server\'s INGEST_TOKEN, docker/.env) or run it in a terminal to be asked; nothing saved');
      return 1;
    }
    try {
      token = String(await prompt(`Ingest token of ${url} (INGEST_TOKEN in its docker/.env; not shown): `)).trim();
    } catch (err) {
      warn(`ERROR: ${err.message}; nothing saved`);
      return 1;
    }
    if (!token) {
      warn('ERROR: empty token; nothing saved');
      return 1;
    }
  }
  let status;
  try {
    status = await probe(url, token, fetchImpl);
  } catch (err) {
    warn(`ERROR: could not reach ${url} (${err.cause?.code || err.message}); nothing saved`);
    return 1;
  }
  if (status === 401) {
    warn(`ERROR: ${url} refused the token (HTTP 401): use the server's INGEST_TOKEN (docker/.env on the server); nothing saved`);
    return 1;
  }
  if (status === 404) {
    warn(`ERROR: ${url} has no /export/files (HTTP 404): a host-mode LOOP server (or an image older than 1.0.0). A clone of a host-mode server syncs on its own: set INGEST_URL / INGEST_TOKEN, or INGEST_TOKEN= / INGEST_PORT= in services/loop-ingest/.env; nothing saved`);
    return 1;
  }
  if (status !== 200) {
    warn(`ERROR: ${url}/export/files answered HTTP ${status} (not a LOOP server's data port?); nothing saved`);
    return 1;
  }
  save(file, url, token);
  log(`Connected: ${url} is a LOOP server; saved to ${shown} (mode 600). \`npm run sync\` now mirrors it in every terminal (\`npm run connect -- --forget\` undoes it)`);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(`ERROR: ${err?.message ?? err}`); process.exitCode = 1; });
}
