#!/usr/bin/env node
/* The LAN stack the `lan-*` E2E projects run against (playwright.config.mjs `webServer`), the same pieces as a
 * LOOP server (docs/lan-services.md) without Docker:
 *
 *   - a fresh EMPTY Postgres database, created on the server TEST_DATABASE_URL points at (like `npm run test:pg`)
 *     and dropped on exit;
 *   - the data service (services/loop-ingest/src/server.js) in container mode (HC_BUILD=container): it runs the real
 *     migrations, then scripts/refresh.mjs builds the personal page from its own (empty) data into a temporary
 *     HC_SITE_DIR, and POST /sync rebuilds it, exactly like the loop-server image;
 *   - a small front server standing in for loop-web's nginx (services/loop-web/nginx.conf.template): it serves the
 *     published site and proxies EXACTLY the routes nginx proxies, with the same path rewrites, methods and
 *     headers (Host: loop-ingest, X-Forwarded-Host = the browser's Host), so the service's Host / Origin checks
 *     run as in production. Everything else under /api/ is a 404.
 *
 * It listens on 127.0.0.1:E2E_LAN_PORT (default 18290) once the first page is published, and tears everything
 * down (child, database, temporary folders) on SIGINT / SIGTERM. Run by hand to look at the stack in a browser:
 *   TEST_DATABASE_URL=postgres://postgres:x@127.0.0.1:5544/postgres node e2e/lan/stack.mjs */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../paths.mjs';
import { BUILD_LOCK } from '../../scripts/lib/astro-build.mjs';

export const LAN_PORT = Number(process.env.E2E_LAN_PORT || 18290);
const SERVICE = path.join(ROOT, 'services', 'loop-ingest');
const log = (msg) => console.log(`[e2e-stack] ${msg}`);

/** The pg driver the data service installs (npm --prefix services/loop-ingest ci); the root package has none. */
function pgDriver() {
  return createRequire(path.join(SERVICE, 'package.json'))('pg');
}

async function admin(url, sql) {
  const client = new (pgDriver().Client)({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** A free TCP port on loopback. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `pid` and every process below it (Linux `ps --ppid`): the data service and the page build it runs
 * (scripts/refresh.mjs and its Astro child). They stay in the stack's own process group, so a forced kill of that
 * group (Playwright's webServer escalation) ends them too; stop() walks the tree for the graceful path. */
function processTree(pid) {
  const out = [pid];
  for (let i = 0; i < out.length; i++) {
    let kids = '';
    try {
      kids = execFileSync('ps', ['-o', 'pid=', '--ppid', String(out[i])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      // exit 1 with no output is "no child"; anything else (no ps, a ps without --ppid) means the build children
      // cannot be found and may outlive the stop: say so instead of failing silently
      if (err.status !== 1 || String(err.stderr || '').trim()) log(`cannot list the children of ${out[i]} (${err.code || err.message}): the page build may outlive the stop`);
    }
    for (const k of kids.split(/\s+/).filter(Boolean)) out.push(Number(k));
  }
  return out;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM the tree, then SIGKILL what is left; resolves once none of it runs. */
async function stopTree(pid) {
  let tree = processTree(pid);
  for (const p of tree) {
    try { process.kill(p, 'SIGTERM'); } catch {}
  }
  for (let i = 0; i < 50 && tree.some(alive); i++) await wait(100);
  tree = [...new Set([...tree, ...processTree(pid)])].filter(alive);
  for (const p of tree) {
    try { process.kill(p, 'SIGKILL'); } catch {}
  }
  for (let i = 0; i < 20 && tree.some(alive); i++) await wait(100);
}

/** Remove the repo's Astro build lock when the process holding it is gone (a page build killed by stop() never
 * releases it, and every later build would wait 10 minutes for it to go stale). A live holder's lock stays. */
function dropOrphanBuildLock() {
  let holder;
  try {
    holder = Number(fs.readFileSync(BUILD_LOCK, 'utf8').trim());
  } catch {
    return;
  }
  if (!Number.isInteger(holder) || holder <= 0) return;
  try {
    process.kill(holder, 0);
  } catch (err) {
    if (err.code === 'ESRCH') fs.rmSync(BUILD_LOCK, { force: true });
  }
}


/** nginx's /api routes: [method set, upstream path] for a request path, or null (404). */
export function upstreamFor(method, pathname) {
  if (pathname === '/api/sync') return method === 'POST' ? { path: '/sync', body: false } : { deny: true };
  if (pathname === '/api/sync/status') return method === 'GET' ? { path: '/sync/status', body: false } : { deny: true };
  if (pathname.startsWith('/api/food/')) {
    return ['GET', 'POST', 'PUT', 'DELETE'].includes(method)
      ? { path: '/food/' + pathname.slice('/api/food/'.length), body: true, header: 'x-hc-food' }
      : { deny: true };
  }
  if (pathname.startsWith('/api/journal/')) {
    return ['GET', 'PUT'].includes(method)
      ? { path: '/journal/' + pathname.slice('/api/journal/'.length), body: true, header: 'x-hc-journal' }
      : { deny: true };
  }
  return null;
}

/** nginx's server-level headers (services/loop-web/nginx.conf.template), on every response like `add_header … always`. */
export const SECURITY_HEADERS = Object.freeze({
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "frame-ancestors 'none'",
});

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.pdf': 'application/pdf' };

function serveStatic(siteDir, pathname, res) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const ok = rel === 'index.html' || rel === 'status.json' || /^manuales\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.pdf$/.test(rel);
  const file = path.join(siteDir, rel);
  if (!ok || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache, no-store',
  });
  fs.createReadStream(file).pipe(res);
}

/** The front server: the published site + nginx's /api proxy rules, upstream = the data service on `ingestPort`. */
export function createFront({ siteDir, ingestPort }) {
  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://front');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      return serveStatic(siteDir, url.pathname, res);
    }
    const route = upstreamFor(req.method, url.pathname);
    if (!route) return res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    if (route.deny) return res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
    const headers = {};
    // what nginx forwards by default (minus hop-by-hop headers) plus its explicit proxy_set_header lines
    for (const [k, v] of Object.entries(req.headers)) {
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(k)) headers[k] = v;
    }
    headers.host = 'loop-ingest';
    if (route.header) headers['x-forwarded-host'] = req.headers.host;
    if (!route.body) {
      delete headers['content-length'];
      delete headers['content-type'];
    }
    const up = http.request(
      { host: '127.0.0.1', port: ingestPort, method: req.method, path: route.path + url.search, headers, timeout: 15_000 },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on('timeout', () => up.destroy(new Error('upstream timeout')));
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('bad gateway');
    });
    if (route.body) req.pipe(up);
    else {
      req.resume();
      up.end();
    }
  });
}

/** Start the whole stack; resolves to { baseURL, stop() } once the first page is published. `onStop(stop)` receives the
 * teardown before anything is created, so a signal during the (long) boot build still cleans up. */
export async function startStack({ databaseUrl = process.env.TEST_DATABASE_URL, port = LAN_PORT, onStop = () => {} } = {}) {
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is not set: the LAN E2E stack needs a Postgres it may CREATE DATABASE on');
  // every piece is created after the teardown that removes it exists
  let tmp = null;
  let dbName = null;
  let child = null;
  let exited = false;
  let front = null;
  let stopping = null;
  const stop = () => (stopping ??= (async () => {
    if (front) await new Promise((r) => front.close(() => r()));
    if (child) {
      // the data service AND the page build it may be running, which would otherwise keep writing into the folder
      // removed below
      await stopTree(child.pid);
      dropOrphanBuildLock();
    }
    if (dbName) await admin(databaseUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch((e) => log(`drop failed: ${e.message}`));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  })());
  onStop(stop);

  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-e2e-'));
    const dirs = { data: path.join(tmp, 'data'), files: path.join(tmp, 'files'), site: path.join(tmp, 'site') };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

    // named before it exists: a stop while CREATE DATABASE runs still drops it (DROP … IF EXISTS)
    dbName = `loop_e2e_${randomBytes(6).toString('hex')}`;
    await admin(databaseUrl, `CREATE DATABASE ${dbName}`);
    if (stopping) {
      await admin(databaseUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      throw new Error('stopped during startup');
    }
    const dbUrl = new URL(databaseUrl);
    dbUrl.pathname = `/${dbName}`;

    const ingestPort = await freePort();
    if (stopping) throw new Error('stopped during startup');
    child = spawn(process.execPath, [path.join(SERVICE, 'src', 'server.js')], {
      cwd: SERVICE,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: tmp,
        TZ: 'Europe/Madrid',
        PORT: String(ingestPort),
        INGEST_TOKEN: randomBytes(32).toString('hex'),
        DATABASE_URL: dbUrl.toString(),
        HC_BUILD: 'container',
        HC_SITE_DIR: dirs.site,
        HC_DATA_DIR: dirs.data,
        HC_FILES_DIR: dirs.files,
        HC_VERSION: 'e2e',
        HC_REFRESH_MINUTES: '1440',
        TRIGGER_DIR: path.join(tmp, 'trigger'),
        ASTRO_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('exit', () => { exited = true; });

    // the boot build publishes status.json with publishedAt (scripts/refresh.mjs); a first build takes ~30-60 s
    const deadline = Date.now() + 240_000;
    const status = path.join(dirs.site, 'status.json');
    for (;;) {
      if (stopping) throw new Error('stopped during startup');
      if (exited) throw new Error('the data service exited during startup (its log is above)');
      if (Date.now() > deadline) throw new Error('no page published within 240 s');
      try {
        if (JSON.parse(fs.readFileSync(status, 'utf8')).publishedAt) break;
      } catch {}
      await wait(500);
    }
    front = createFront({ siteDir: dirs.site, ingestPort });
    await new Promise((resolve, reject) => {
      front.once('error', reject);
      front.listen(port, '127.0.0.1', resolve);
    });
    log(`ready on http://127.0.0.1:${port} (data service :${ingestPort}, database ${dbName})`);
  } catch (err) {
    await stop();
    throw err;
  }
  return { baseURL: `http://127.0.0.1:${port}`, stop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // registered before the start, so Ctrl-C or Playwright's SIGTERM during the boot build still tears down
  let stop = null;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      if (stop) await stop();
      process.exit(0);
    });
  }
  await startStack({ onStop: (fn) => { stop = fn; } }).catch((err) => {
    console.error(`[e2e-stack] ${err.message}`);
    process.exit(1);
  });
}
