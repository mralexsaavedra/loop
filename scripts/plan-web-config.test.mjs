/* Static guards for the on-demand refresh wiring (services/plan-web nginx + compose + systemd units,
 * services/health-ingest compose). They pin the SECURITY boundary: the plan-web server may proxy
 * exactly three exact ingest routes (POST /sync, GET /sync/status, and the Shortcut's bearer-checked
 * POST /ingest/health-auto-export) plus the food log prefix (/api/food/ -> /food/), never a data
 * export endpoint. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

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

test('nginx proxies ONLY /api/sync, /api/sync/status, /ingest/health-auto-export (exact) and the /api/food/ prefix, to the host ingest port', () => {
  const proxied = locations(nginx).filter((l) => /proxy_pass\s/.test(l.body));
  assert.deepEqual(proxied.map((l) => l.spec).sort(), ['/api/food/', '= /api/sync', '= /api/sync/status', '= /ingest/health-auto-export']);
  const target = (spec) => /proxy_pass\s+([^;]+);/.exec(proxied.find((l) => l.spec === spec).body)[1];
  assert.equal(target('= /api/sync'), 'http://host.docker.internal:${INGEST_PORT}/sync');
  assert.equal(target('= /api/sync/status'), 'http://host.docker.internal:${INGEST_PORT}/sync/status');
  assert.match(proxied.find((l) => l.spec === '= /api/sync').body, /limit_except POST/);
  assert.match(proxied.find((l) => l.spec === '= /api/sync/status').body, /limit_except GET/);
  assert.equal((nginx.match(/proxy_pass\s/g) || []).length, 4, 'no other proxy_pass anywhere');
});

test('nginx /api/food/: ingest /food/ only, GET/POST/PUT/DELETE, the body passed, 16 KB cap, the X-HC-Food header forwarded', () => {
  const food = locations(nginx).find((l) => l.spec === '/api/food/');
  assert.ok(food, 'a prefix location for the food log');
  assert.match(food.body, /proxy_pass\s+http:\/\/host\.docker\.internal:\$\{INGEST_PORT\}\/food\/;/);
  assert.match(food.body, /limit_except GET POST PUT DELETE \{ deny all; \}/);
  assert.doesNotMatch(food.body, /proxy_pass_request_body off/, 'writes carry a JSON body');
  assert.match(food.body, /client_max_body_size 16k;/, 'same cap as the service');
  assert.match(food.body, /proxy_set_header X-HC-Food \$http_x_hc_food;/);
  assert.match(food.body, /proxy_set_header Host host\.docker\.internal;/, 'the proxy hop names a host ingest allows');
  assert.match(food.body, /proxy_connect_timeout 5s;/);
  assert.match(food.body, /proxy_read_timeout 15s;/);
  assert.doesNotMatch(food.body, /add_header\s+Access-Control/i, 'never approves a cross-site request');
});

test('nginx: everything else under /api is a 404; data endpoints are never named', () => {
  const api = locations(nginx).find((l) => l.spec === '/api/');
  assert.ok(api, 'a catch-all /api/ location exists');
  assert.match(api.body, /return 404;/);
  const directives = nginx.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(directives, /\/export|\/sync\/strava|\/healthz/, 'no data export, Strava pull or health endpoint is ever named');
  const specs = locations(nginx).map((l) => l.spec);
  assert.ok(!specs.some((s) => /^(\^~\s+|~\*?\s+)?\/ingest\/?$/.test(s) || /^(\^~\s+)?\/ingest\//.test(s)), 'no /ingest/ prefix or regex location: other /ingest/* paths stay 404');
  assert.deepEqual(specs.filter((s) => /ingest/.test(s)), ['= /ingest/health-auto-export'], 'the only ingest location is the exact Shortcut route');
});

// The iOS Shortcut posts its payload through plan-web when plan-web is the public entry (behind an
// SSO tunnel that bypasses /ingest/* and /api/sync); ingest checks the bearer itself.
test('nginx = /ingest/health-auto-export: exact, POST only, the body passed with the ingest cap, auth headers forwarded', () => {
  const ingest = locations(nginx).find((l) => l.spec === '= /ingest/health-auto-export');
  assert.ok(ingest, 'an EXACT-match location for the Shortcut upload');
  assert.match(ingest.body, /proxy_pass\s+http:\/\/host\.docker\.internal:\$\{INGEST_PORT\}\/ingest\/health-auto-export;/);
  assert.match(ingest.body, /limit_except POST \{ deny all; \}/);
  assert.doesNotMatch(ingest.body, /proxy_pass_request_body off/, 'the JSON payload is the whole point');
  assert.match(ingest.body, /client_max_body_size 8m;/, 'a Shortcut payload is a few hundred KB');
  const server = read('services', 'health-ingest', 'src', 'server.js');
  const def = /MAX_BODY_BYTES = Number\(process\.env\.MAX_BODY_BYTES \?\? ([\d\s*]+)\)/.exec(server);
  assert.ok(def, 'the ingest default MAX_BODY_BYTES is readable');
  const ingestMax = def[1].split('*').reduce((a, n) => a * Number(n.trim()), 1);
  const capMb = Number(/client_max_body_size (\d+)m;/.exec(ingest.body)[1]);
  assert.ok(capMb * 1024 * 1024 <= ingestMax, 'the nginx cap never exceeds the ingest default');
  assert.match(ingest.body, /proxy_set_header Authorization \$http_authorization;/);
  assert.match(ingest.body, /proxy_set_header Automation-Name \$http_automation_name;/);
  assert.match(ingest.body, /proxy_set_header Content-Type \$content_type;/);
  assert.match(ingest.body, /proxy_set_header Host host\.docker\.internal;/);
  assert.match(ingest.body, /proxy_connect_timeout 5s;/);
  assert.match(ingest.body, /proxy_read_timeout 60s;/);
  assert.match(ingest.body, /client_body_buffer_size 1m;/, 'a few-hundred-KB payload stays in memory');
  assert.doesNotMatch(ingest.body, /add_header\s+Access-Control/i);
});

test('nginx = /ingest/health-auto-export: a request without a Bearer token is refused (401) before the body is read', () => {
  const ingest = locations(nginx).find((l) => l.spec === '= /ingest/health-auto-export');
  assert.match(ingest.body, /if \(\$http_authorization !~\* "\^Bearer\\s\+\\S\+"\) \{ return 401; \}/);
  const re = new RegExp(/!~\* "([^"]+)"/.exec(ingest.body)[1], 'i');
  for (const ok of ['Bearer abc123', 'bearer  x']) assert.ok(re.test(ok), ok);
  for (const bad of ['', 'Bearer', 'Bearer ', 'Basic abc', 'abc']) assert.ok(!re.test(bad), bad);
});

// Path normalization: an SSO proxy may match its bypass rules (/ingest/*, /api/sync) on the RAW path
// while nginx serves the normalized one (/ingest/%2e%2e/index.html -> the page). Refuse such paths.
test('nginx: a server-level guard refuses dot-segments, encoded dots / slashes / backslashes and // in the raw path (400)', () => {
  const server = nginx.slice(nginx.indexOf('server {'));
  const m = /if \(\$request_uri ~\* "([^"]+)"\) \{ return 400; \}/.exec(server);
  assert.ok(m, 'a $request_uri guard returning 400');
  assert.ok(server.indexOf(m[0]) < server.indexOf('location '), 'before the first location');
  const re = new RegExp(m[1], 'i');
  for (const bad of ['/ingest/%2e%2e/index.html', '/ingest/%2E%2E/status.json', '/ingest/../status.json', '/api/sync/..%2ffood/log',
    '/api/sync/%2F..', '/ingest/x%5c..%5cstatus.json', '//status.json', '/api//food/log', '/api/food/%2e/log', '/ingest/health-auto-export/..']) {
    assert.ok(re.test(bad), bad);
  }
  for (const ok of ['/', '/index.html', '/status.json', '/api/sync', '/api/sync/status', '/api/food/log?date=2026-10-01', '/api/food/products',
    '/api/food/log/42', '/api/food/off?q=a..b%2F%2e//x', '/ingest/health-auto-export']) {
    assert.ok(!re.test(ok), ok);
  }
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

// ---- DNS rebinding: a Host allowlist for EVERY path ----------------------------------------------
const hostsScript = path.join(ROOT, PLAN_WEB, 'hosts.sh');

/** The map block that decides $hc_host_ok, and its regex keys as JS RegExps (PCRE subset). */
function hostMap() {
  const m = /map \$host \$hc_host_ok \{\n([\s\S]*?)\n\}/.exec(nginx);
  assert.ok(m, 'a map $host $hc_host_ok block');
  const regexes = [...m[1].matchAll(/"~([^"]+)"\s+1;/g)].map((x) => new RegExp(x[1]));
  return { body: m[1], regexes };
}
const allowedByMap = (host) => {
  const { body, regexes } = hostMap();
  const literal = [...body.matchAll(/^\s*([a-z0-9.-]+)\s+1;/gm)].map((x) => x[1]);
  return literal.includes(host) || regexes.some((r) => r.test(host));
};

test('nginx: every request is checked against the Host map at SERVER level (421 otherwise), before any location', () => {
  const { body } = hostMap();
  assert.match(body, /default\s+0;/, 'unknown names are refused by default');
  assert.match(body, /^\s*localhost\s+1;/m);
  assert.match(body, /include \/etc\/nginx\/hc-extra-hosts\.map;/, 'the optional extra names');
  const server = nginx.slice(nginx.indexOf('server {'));
  const guard = server.indexOf('if ($hc_host_ok = 0) { return 421; }');
  assert.ok(guard > 0, 'server-level guard');
  assert.ok(guard < server.indexOf('location '), 'before the first location, so it covers the page, status.json and /api/*');
});

test('nginx Host map: IP literals (v4, bracketed v6) and localhost pass; any other name (a rebinding domain) does not', () => {
  for (const h of ['192.168.1.10', '10.0.0.5', '127.0.0.1', '[::1]', '[fd00::12]', '[fe80::1:2]', 'localhost']) assert.equal(allowedByMap(h), true, h);
  for (const h of ['evil.example', '192.168.1.10.nip.io', 'a.192.168.1.10', '1.2.3.4.evil.example', '[::1].evil.example', 'localhost.evil.example', '', 'plan.lan']) {
    assert.equal(allowedByMap(h), false, h);
  }
});

test('plan-web compose: PLAN_WEB_EXTRA_HOSTS (empty by default) and the entrypoint script that renders it', () => {
  assert.match(planCompose, /PLAN_WEB_EXTRA_HOSTS:\s*\$\{PLAN_WEB_EXTRA_HOSTS:-\}/);
  assert.match(planCompose, /\.\/hosts\.sh:\/docker-entrypoint\.d\/15-hc-hosts\.sh:ro/);
  assert.ok(fs.statSync(hostsScript).mode & 0o111, 'executable (the nginx entrypoint skips non-executable scripts)');
});

function renderHosts(value) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hc-hosts-')), 'hosts.map');
  const r = spawnSync('sh', [hostsScript], { env: { PATH: process.env.PATH, HC_HOSTS_MAP: out, ...(value === undefined ? {} : { PLAN_WEB_EXTRA_HOSTS: value }) }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { map: fs.readFileSync(out, 'utf8'), stderr: r.stderr };
}

test('hosts.sh: comma / space separated names, lowercased, one exact map entry each; invalid ones are skipped with a warning', () => {
  assert.equal(renderHosts(undefined).map, '', 'nothing by default');
  assert.equal(renderHosts('').map, '');
  const r = renderHosts(' Plan.Lan, nas.home.arpa  bad_host;x .dot trailing. ~^.*$ ');
  assert.equal(r.map, 'plan.lan 1;\nnas.home.arpa 1;\n');
  for (const bad of ['bad_host;x', '.dot', 'trailing.', '~^.*$']) assert.match(r.stderr, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('health-ingest compose passes FOOD_ALLOWED_HOSTS (empty by default) for the same extra names', () => {
  assert.match(ingestCompose, /FOOD_ALLOWED_HOSTS:\s*\$\{FOOD_ALLOWED_HOSTS:-\}/);
});

test('nginx: gzip at SERVER level for the page, status.json, CSS / JS and JSON; never on the proxied ingest routes', () => {
  const server = nginx.slice(nginx.indexOf('server {'));
  const head = server.slice(0, server.indexOf('location '));
  assert.match(head, /^\s*gzip on;/m, 'server-level gzip');
  assert.match(head, /^\s*gzip_vary on;/m, 'Vary: Accept-Encoding for caches');
  assert.match(head, /^\s*gzip_min_length 1024;/m);
  assert.match(head, /^\s*gzip_comp_level 5;/m);
  const types = /^\s*gzip_types ([^;]+);/m.exec(head);
  assert.ok(types, 'gzip_types listed');
  assert.deepEqual(types[1].trim().split(/\s+/).sort(), ['application/javascript', 'application/json', 'text/css'],
    'text/html is always compressed once gzip is on (listing it is a duplicate-MIME warning)');
  assert.doesNotMatch(nginx.slice(0, nginx.indexOf('server {')), /^\s*gzip/m, 'nothing outside the server block');
  // Proxied responses reflect request input (food search, labels) next to stored data: never compress
  // them (a BREACH-style length oracle), and their bodies are small anyway.
  const proxied = locations(nginx).filter((x) => /proxy_pass\s/.test(x.body));
  assert.equal(proxied.length, 4);
  for (const l of proxied) assert.match(l.body, /^\s*gzip off;/m, `${l.spec}: gzip off`);
});
