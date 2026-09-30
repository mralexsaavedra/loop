/* Static guards for the on-demand refresh wiring (services/plan-web nginx + compose + systemd units,
 * services/health-ingest compose). They pin the SECURITY boundary: the public plan-web server may
 * proxy exactly two ingest routes (POST /sync, GET /sync/status), never a data endpoint. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PLAN_WEB = path.join('services', 'plan-web');
const nginx = read(PLAN_WEB, 'nginx.conf.template');
const planCompose = read(PLAN_WEB, 'docker-compose.yml');
const pathUnit = read(PLAN_WEB, 'systemd', 'plan-web-refresh.path');
const serviceUnit = read(PLAN_WEB, 'systemd', 'plan-web-refresh.service');
const ingestCompose = read('services', 'health-ingest', 'docker-compose.yml');

/** `location <spec> { body }` blocks (bodies may hold one nested level, e.g. limit_except). */
function locations(conf) {
  return [...conf.matchAll(/location\s+([^{]+?)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => ({ spec: m[1].trim(), body: m[2] }));
}

test('nginx proxies ONLY /api/sync and /api/sync/status, as exact locations, to the host ingest port', () => {
  const proxied = locations(nginx).filter((l) => /proxy_pass\s/.test(l.body));
  assert.deepEqual(proxied.map((l) => l.spec).sort(), ['= /api/sync', '= /api/sync/status']);
  const target = (spec) => /proxy_pass\s+([^;]+);/.exec(proxied.find((l) => l.spec === spec).body)[1];
  assert.equal(target('= /api/sync'), 'http://host.docker.internal:${INGEST_PORT}/sync');
  assert.equal(target('= /api/sync/status'), 'http://host.docker.internal:${INGEST_PORT}/sync/status');
  assert.match(proxied.find((l) => l.spec === '= /api/sync').body, /limit_except POST/);
  assert.match(proxied.find((l) => l.spec === '= /api/sync/status').body, /limit_except GET/);
  assert.equal((nginx.match(/proxy_pass\s/g) || []).length, 2, 'no other proxy_pass anywhere');
});

test('nginx: everything else under /api is a 404; data endpoints are never named', () => {
  const api = locations(nginx).find((l) => l.spec === '/api/');
  assert.ok(api, 'a catch-all /api/ location exists');
  assert.match(api.body, /return 404;/);
  assert.doesNotMatch(nginx, /\/export|\/ingest/);
});

test('nginx serves status.json uncached', () => {
  const status = locations(nginx).find((l) => l.spec === '= /status.json');
  assert.ok(status);
  assert.match(status.body, /Cache-Control\s+"no-cache/);
});

test('plan-web compose: host-gateway alias, nginx template mount, INGEST_PORT default', () => {
  assert.match(planCompose, /extra_hosts:\s*\n\s*-\s*"host\.docker\.internal:host-gateway"/);
  assert.match(planCompose, /\.\/nginx\.conf\.template:\/etc\/nginx\/templates\/default\.conf\.template:ro/);
  assert.match(planCompose, /INGEST_PORT:\s*\$\{INGEST_PORT:-8088\}/);
  assert.match(planCompose, /\.\/site:\/usr\/share\/nginx\/html:ro/, 'still only ./site is served');
});

test('health-ingest compose bind-mounts the trigger dir', () => {
  assert.match(ingestCompose, /-\s*\.\/trigger:\/trigger/);
  assert.match(ingestCompose, /TRIGGER_DIR:\s*\/trigger/);
});

test('systemd path unit watches the trigger file and starts the refresh service', () => {
  assert.match(pathUnit, /^PathModified=\/path\/to\/health-coach\/services\/health-ingest\/trigger\/refresh$/m);
  assert.match(pathUnit, /^Unit=plan-web-refresh\.service$/m);
  assert.match(pathUnit, /^WantedBy=multi-user\.target$/m);
});

test('systemd service: oneshot running refresh.sh from the repo as the repo OWNER (placeholder), waiting for the lock', () => {
  assert.match(serviceUnit, /^Type=oneshot$/m);
  assert.match(serviceUnit, /^User=REPO_OWNER$/m, 'a placeholder the installer must replace, never a hardcoded root');
  assert.doesNotMatch(serviceUnit, /^User=root$/m);
  assert.match(serviceUnit, /^WorkingDirectory=\/path\/to\/health-coach$/m);
  assert.match(serviceUnit, /^ExecStart=\/path\/to\/health-coach\/services\/plan-web\/refresh\.sh$/m);
  assert.match(serviceUnit, /^Environment=PLAN_WEB_WAIT_LOCK=1$/m);
  const timeout = Number(/^TimeoutStartSec=(\d+)$/m.exec(serviceUnit)[1]);
  assert.ok(timeout >= 900 + 3 * (300 + 900 + 300), 'covers the lock wait + 3 passes of sync/npm ci/generate');
});

test('systemd service is hardened: no new privileges, read-only system and home, writable repo only', () => {
  const directives = serviceUnit.split('\n').map((l) => l.trim());
  for (const line of ['NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'ProtectHome=read-only', 'ReadWritePaths=/path/to/health-coach',
    'CacheDirectory=plan-web-refresh', 'Environment=npm_config_cache=/var/cache/plan-web-refresh']) {
    assert.ok(directives.includes(line), line);
  }
});

test('refresh.sh does not override the safe.directory setting (the unit runs as the repo owner)', () => {
  assert.doesNotMatch(read(PLAN_WEB, 'refresh.sh'), /safe\.directory/);
});

test('every error code refresh.sh can write has a human reason in the page copy (es + en)', async () => {
  const { es, en } = await import('../web/src/i18n/sync-templates.mjs');
  const codes = [...read(PLAN_WEB, 'refresh.sh').matchAll(/^\s*fail ([a-z_]+) /gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(codes)].sort(), ['branch', 'build', 'install', 'lock', 'sanity']);
  for (const code of [...codes, 'trigger_write']) {
    assert.ok(es.errors[code] && en.errors[code], code);
  }
});

test('no personal paths in the tracked plan-web files', () => {
  for (const text of [nginx, planCompose, pathUnit, serviceUnit, read(PLAN_WEB, 'refresh.sh'), read(PLAN_WEB, 'README.md')]) {
    assert.doesNotMatch(text, /\/root\/|\/home\/|\/Users\//);
  }
});
