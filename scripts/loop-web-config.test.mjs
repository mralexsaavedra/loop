/* Static guards for the on-demand refresh wiring (services/loop-web nginx + compose + systemd units,
 * services/loop-ingest compose). They pin the SECURITY boundary: the loop-web server may proxy
 * exactly three exact ingest routes (POST /sync, GET /sync/status, and the Shortcut's bearer-checked
 * POST /ingest/health-auto-export) plus the food log prefix (/api/food/ -> /food/) and the journal
 * prefix (/api/journal/ -> /journal/), never a data
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
const LOOP_WEB = path.join('services', 'loop-web');
const nginx = read(LOOP_WEB, 'nginx.conf.template');
const planCompose = read(LOOP_WEB, 'docker-compose.yml');
const pathUnit = read(LOOP_WEB, 'systemd', 'loop-web-refresh.path');
const serviceUnit = read(LOOP_WEB, 'systemd', 'loop-web-refresh.service');
const ingestCompose = read('services', 'loop-ingest', 'docker-compose.yml');

/** `location <spec> { body }` blocks (bodies may hold one nested level, e.g. limit_except; a quoted
 * regex spec may hold braces). */
function locations(conf) {
  return [...conf.matchAll(/location\s+((?:"[^"]*"|[^{"])+?)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => ({ spec: m[1].trim(), body: m[2] }));
}

test('nginx proxies ONLY /api/sync, /api/sync/status, /ingest/health-auto-export (exact) and the /api/food/ + /api/journal/ prefixes, to the host ingest port', () => {
  const proxied = locations(nginx).filter((l) => /proxy_pass\s/.test(l.body));
  assert.deepEqual(proxied.map((l) => l.spec).sort(), ['/api/food/', '/api/journal/', '= /api/sync', '= /api/sync/status', '= /ingest/health-auto-export']);
  const target = (spec) => /proxy_pass\s+([^;]+);/.exec(proxied.find((l) => l.spec === spec).body)[1];
  assert.equal(target('= /api/sync'), 'http://host.docker.internal:${INGEST_PORT}/sync');
  assert.equal(target('= /api/sync/status'), 'http://host.docker.internal:${INGEST_PORT}/sync/status');
  assert.match(proxied.find((l) => l.spec === '= /api/sync').body, /limit_except POST/);
  assert.match(proxied.find((l) => l.spec === '= /api/sync/status').body, /limit_except GET/);
  assert.equal((nginx.match(/proxy_pass\s/g) || []).length, 5, 'no other proxy_pass anywhere');
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

test('nginx /api/journal/: ingest /journal/ only, GET/PUT, 16 KB cap, the X-HC-Journal header forwarded', () => {
  const j = locations(nginx).find((l) => l.spec === '/api/journal/');
  assert.ok(j, 'a prefix location for the journal');
  assert.match(j.body, /proxy_pass\s+http:\/\/host\.docker\.internal:\$\{INGEST_PORT\}\/journal\/;/);
  assert.match(j.body, /limit_except GET PUT \{ deny all; \}/);
  assert.match(j.body, /client_max_body_size 16k;/, 'same cap as the service');
  assert.match(j.body, /proxy_set_header X-HC-Journal \$http_x_hc_journal;/);
  assert.match(j.body, /proxy_set_header Host host\.docker\.internal;/);
  assert.doesNotMatch(j.body, /add_header\s+Access-Control/i, 'never approves a cross-site request');
});

test('nginx /api/food/ + /api/journal/ forward the Host the browser asked for as X-Forwarded-Host (ingest binds the write Origin to it)', () => {
  for (const spec of ['/api/food/', '/api/journal/']) {
    const l = locations(nginx).find((x) => x.spec === spec);
    assert.match(l.body, /proxy_set_header X-Forwarded-Host \$http_host;/, spec);
  }
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

// The iOS Shortcut posts its payload through loop-web when loop-web is the public entry (behind an
// SSO tunnel that bypasses /ingest/* and /api/sync); ingest checks the bearer itself.
test('nginx = /ingest/health-auto-export: exact, POST only, the body passed with the ingest cap, auth headers forwarded', () => {
  const ingest = locations(nginx).find((l) => l.spec === '= /ingest/health-auto-export');
  assert.ok(ingest, 'an EXACT-match location for the Shortcut upload');
  assert.match(ingest.body, /proxy_pass\s+http:\/\/host\.docker\.internal:\$\{INGEST_PORT\}\/ingest\/health-auto-export;/);
  assert.match(ingest.body, /limit_except POST \{ deny all; \}/);
  assert.doesNotMatch(ingest.body, /proxy_pass_request_body off/, 'the JSON payload is the whole point');
  assert.match(ingest.body, /client_max_body_size 8m;/, 'a Shortcut payload is a few hundred KB');
  const server = read('services', 'loop-ingest', 'src', 'server.js');
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

test('loop-web compose: host-gateway alias, nginx template mount, INGEST_PORT default', () => {
  assert.match(planCompose, /extra_hosts:\s*\n\s*-\s*"host\.docker\.internal:host-gateway"/);
  assert.match(planCompose, /\.\/nginx\.conf\.template:\/etc\/nginx\/templates\/default\.conf\.template:ro/);
  assert.match(planCompose, /INGEST_PORT:\s*\$\{INGEST_PORT:-8088\}/);
  assert.match(planCompose, /\.\/site:\/usr\/share\/nginx\/html:ro/, 'still only ./site is served');
});

test('loop-ingest compose bind-mounts the trigger dir', () => {
  assert.match(ingestCompose, /-\s*\.\/trigger:\/trigger/);
  assert.match(ingestCompose, /TRIGGER_DIR:\s*\/trigger/);
});

test('loop-ingest compose: the database volume has an explicit name, independent of the project name', () => {
  assert.match(ingestCompose, /^\s+- loop-db-data:\/var\/lib\/postgresql\/data$/m);
  assert.match(ingestCompose, /^volumes:\n {2}loop-db-data:\n(?:\s+#.*\n)*\s+name: loop-db-data\$\{HC_INSTANCE:\+-\$\{HC_INSTANCE\}\}$/m);
  assert.match(ingestCompose, /^\s+container_name: loop-db\$\{HC_INSTANCE:\+-\$\{HC_INSTANCE\}\}$/m);
});

test('systemd path unit watches the trigger file and starts the refresh service', () => {
  assert.match(pathUnit, /^PathModified=\/path\/to\/loop\/services\/loop-ingest\/trigger\/refresh$/m);
  assert.match(pathUnit, /^Unit=loop-web-refresh\.service$/m);
  assert.match(pathUnit, /^WantedBy=multi-user\.target$/m);
});

test('systemd service: oneshot running refresh.sh from the repo as the repo OWNER (placeholder), waiting for the lock', () => {
  assert.match(serviceUnit, /^Type=oneshot$/m);
  assert.match(serviceUnit, /^User=REPO_OWNER$/m, 'a placeholder the installer must replace, never a hardcoded root');
  assert.doesNotMatch(serviceUnit, /^User=root$/m);
  assert.match(serviceUnit, /^WorkingDirectory=\/path\/to\/loop$/m);
  assert.match(serviceUnit, /^ExecStart=\/path\/to\/loop\/services\/loop-web\/refresh\.sh$/m);
  assert.match(serviceUnit, /^Environment=PLAN_WEB_WAIT_LOCK=1$/m);
  const timeout = Number(/^TimeoutStartSec=(\d+)$/m.exec(serviceUnit)[1]);
  assert.ok(timeout >= 900 + 3 * (300 + 900 + 300), 'covers the lock wait + 3 passes of sync/npm ci/generate');
});

test('systemd service is hardened: no new privileges, read-only system and home, writable repo only', () => {
  const directives = serviceUnit.split('\n').map((l) => l.trim());
  for (const line of ['NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'ProtectHome=read-only', 'ReadWritePaths=/path/to/loop',
    'CacheDirectory=loop-web-refresh', 'Environment=npm_config_cache=/var/cache/loop-web-refresh']) {
    assert.ok(directives.includes(line), line);
  }
});

test('systemd service: kernel, control groups, SUID, personality, realtime, namespaces and syscall architecture locked down; files stay world-readable for nginx', () => {
  const directives = serviceUnit.split('\n').map((l) => l.trim());
  for (const line of ['ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectKernelLogs=yes', 'ProtectControlGroups=yes', 'RestrictSUIDSGID=yes',
    'LockPersonality=yes', 'RestrictRealtime=yes', 'RestrictNamespaces=yes', 'SystemCallArchitectures=native', 'UMask=0022']) {
    assert.ok(directives.includes(line), line);
  }
  // nginx in the loop-web container reads ./site as another uid: a stricter umask (0027) would make the page 403
  assert.ok(!directives.some((l) => /^UMask=00[2-7]7$/.test(l)), 'never a umask that hides ./site from other users');
  // node's JIT needs writable + executable memory
  assert.ok(!directives.some((l) => l.startsWith('MemoryDenyWriteExecute=')), 'no MemoryDenyWriteExecute (breaks node)');
});

test('refresh.sh does not override the safe.directory setting (the unit runs as the repo owner)', () => {
  assert.doesNotMatch(read(LOOP_WEB, 'refresh.sh'), /safe\.directory/);
});

test('every error code refresh.sh can write has a human reason in the page copy (es + en)', async () => {
  const { es, en } = await import('../web/src/i18n/sync-templates.mjs');
  const codes = [...read(LOOP_WEB, 'refresh.sh').matchAll(/^\s*fail ([a-z_]+) /gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(codes)].sort(), ['branch', 'build', 'install', 'lock', 'sanity']);
  for (const code of [...codes, 'trigger_write']) {
    assert.ok(es.errors[code] && en.errors[code], code);
  }
});

test('no personal paths in the tracked loop-web files', () => {
  for (const text of [nginx, planCompose, pathUnit, serviceUnit, read(LOOP_WEB, 'refresh.sh'), read(LOOP_WEB, 'README.md')]) {
    assert.doesNotMatch(text, /\/root\/|\/home\/|\/Users\//);
  }
});

// ---- DNS rebinding: a Host allowlist for EVERY path ----------------------------------------------
const hostsScript = path.join(ROOT, LOOP_WEB, 'hosts.sh');

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
  assert.match(body, /include \/etc\/nginx\/conf\.d\/hc-extra-hosts\.map;/, 'the optional extra names (in conf.d: a tmpfs, the root filesystem is read-only)');
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

test('loop-web compose: PLAN_WEB_EXTRA_HOSTS (empty by default) and the entrypoint script that renders it', () => {
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

test('loop-ingest compose passes FOOD_ALLOWED_HOSTS (empty by default) for the same extra names', () => {
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
  assert.match(head, /#[^\n]*every block that proxies to ingest MUST set `gzip off;`[^\n]*\n\s*gzip on;/, 'the rule is written next to gzip on');
  // every location that proxies (any proxy_pass, however many there are), not a fixed list
  const proxied = locations(nginx).filter((x) => /proxy_pass\s/.test(x.body));
  assert.equal(proxied.length, (nginx.match(/^\s*proxy_pass\s/gm) || []).length, 'every proxy_pass sits in a parsed location');
  for (const l of proxied) assert.match(l.body, /^\s*gzip off;/m, `${l.spec}: gzip off`);
});

// ---- device manuals: /manuales/<file>.pdf (static, published by refresh.sh) ----------------------
test('nginx /manuales/: only a bare .pdf file name is served, as an inline PDF with nosniff; everything else there is a 404', async () => {
  const locs = locations(nginx);
  const pdf = locs.find((l) => /^~\s/.test(l.spec) && l.spec.includes('/manuales/'));
  assert.ok(pdf, 'a regex location for the manual files');
  const pattern = /^~\s+"([^"]+)"$/.exec(pdf.spec);
  assert.ok(pattern, 'a quoted regex');
  const re = new RegExp(pattern[1]);
  for (const ok of ['/manuales/acme-bike-computer-100-manual-es.pdf', '/manuales/example-ems-suit-7-manual.pdf', '/manuales/A.pdf']) assert.ok(re.test(ok), ok);
  for (const bad of ['/manuales/', '/manuales/x.txt', '/manuales/.x.pdf', '/manuales/a/b.pdf', '/manuales/x.PDF', '/manuales/x.pdf/', '/x/manuales/x.pdf', '/manuales/x.pdfx']) {
    assert.ok(!re.test(bad), bad);
  }
  // nginx and the publisher accept the same file names
  const { MANUAL_FILE_RE } = await import('../lib/profile/profile.mjs');
  assert.equal(pattern[1], `^/manuales/${MANUAL_FILE_RE.source.slice(1)}`);
  assert.match(pdf.body, /types \{ \}/, 'no extension-based type');
  assert.match(pdf.body, /default_type application\/pdf;/);
  assert.match(pdf.body, /add_header X-Content-Type-Options nosniff always;/);
  assert.match(pdf.body, /add_header Content-Disposition inline always;/);
  assert.match(pdf.body, /add_header Content-Security-Policy "default-src 'none'; object-src 'self'; frame-ancestors 'none'" always;/,
    'a restrictive CSP that still lets the built-in PDF viewer render inline (CSP `sandbox` blocks it)');
  assert.match(pdf.body, /add_header Cache-Control "no-cache" always;/, 'a location add_header drops the server one: re-added');
  assert.match(pdf.body, /limit_except GET \{ deny all; \}/, 'GET (and HEAD) only');
  assert.match(pdf.body, /try_files \$uri =404;/);
  assert.match(pdf.body, /autoindex off;/);
  assert.doesNotMatch(pdf.body, /proxy_pass/);
  const rest = locs.find((l) => l.spec === '/manuales/');
  assert.ok(rest, 'a prefix location (not ^~, so the regex above still wins) for everything else');
  assert.match(rest.body, /return 404;/);
});

test('nginx /manuales/ sits behind the server-level Host and raw-path guards (both precede every location)', () => {
  const server = nginx.slice(nginx.indexOf('server {'));
  const first = server.indexOf('location ');
  assert.ok(server.indexOf('if ($hc_host_ok = 0) { return 421; }') < first);
  assert.ok(server.indexOf('if ($request_uri ~*') < first);
  const re = new RegExp(/if \(\$request_uri ~\* "([^"]+)"\)/.exec(server)[1], 'i');
  for (const bad of ['/manuales/../status.json', '/manuales/%2e%2e/index.html', '/manuales//x.pdf', '/manuales/a%2fb.pdf']) assert.ok(re.test(bad), bad);
});

test('the SSO docs keep /manuales/ behind SSO (never in a bypass rule)', () => {
  const readme = read(LOOP_WEB, 'README.md');
  assert.match(readme, /`\/manuales\/`[^\n]*stays behind SSO/);
});

// Security headers on every response: the page writes food and journal entries, so it must not be framed by
// another site (clickjacking), sniffed as another type or leak its URL. nginx drops ALL inherited add_header
// lines in a block that has its own, so every block with an add_header repeats the set.
const SECURITY_HEADERS = [
  /add_header\s+X-Content-Type-Options\s+nosniff\s+always;/,
  /add_header\s+X-Frame-Options\s+DENY\s+always;/,
  /add_header\s+Referrer-Policy\s+no-referrer\s+always;/,
  /add_header\s+Content-Security-Policy\s+"[^"]*frame-ancestors 'none'[^"]*"\s+always;/,
];
test('nginx: server_tokens off and the security headers at server level and in every block with its own add_header', () => {
  const directives = nginx.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(directives, /server_tokens\s+off;/);
  const server = directives.slice(directives.indexOf('server {'), directives.indexOf('location'));
  for (const re of SECURITY_HEADERS) assert.match(server, re, `server level: ${re}`);
  const withHeaders = locations(nginx).filter((l) => /add_header\s/.test(l.body));
  assert.ok(withHeaders.length >= 2, 'status.json and the manuals set their own headers');
  for (const l of withHeaders) for (const re of SECURITY_HEADERS) assert.match(l.body, re, `${l.spec}: ${re}`);
});

// ---- Rate limits: the proxied ingest routes only, never the page ---------------------------------
test('nginx limit_req: every proxied /api/* and /ingest/* location is rate-limited (429), generously; static serving never is', () => {
  const directives = nginx.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const zones = Object.fromEntries([...directives.matchAll(/limit_req_zone \$binary_remote_addr zone=(\w+):(\d+)m rate=(\d+)r\/([sm]);/g)]
    .map((m) => [m[1], { perSecond: Number(m[3]) / (m[4] === 'm' ? 60 : 1) }]));
  assert.deepEqual(Object.keys(zones).sort(), ['hc_api', 'hc_ingest']);
  assert.ok(zones.hc_api.perSecond >= 5, 'the page polls /api/sync/status and loads several food / journal calls at once');
  assert.ok(zones.hc_ingest.perSecond >= 0.5, 'the Shortcut uploads a few payloads in a row');
  const head = directives.slice(directives.indexOf('server {'), directives.indexOf('location '));
  assert.match(head, /^\s*limit_req_status 429;/m);
  const proxied = locations(nginx).filter((l) => /proxy_pass\s/.test(l.body));
  assert.deepEqual(proxied.map((l) => l.spec).sort(), ['/api/food/', '/api/journal/', '= /api/sync', '= /api/sync/status', '= /ingest/health-auto-export']);
  for (const l of proxied) {
    const zone = l.spec === '= /ingest/health-auto-export' ? 'hc_ingest' : 'hc_api';
    const m = new RegExp(`limit_req zone=${zone} burst=(\\d+) nodelay;`).exec(l.body);
    assert.ok(m, `${l.spec}: limit_req zone=${zone}`);
    assert.ok(Number(m[1]) >= 10, `${l.spec}: a generous burst`);
  }
  for (const l of locations(nginx).filter((x) => !/proxy_pass\s/.test(x.body))) assert.doesNotMatch(l.body, /limit_req/, `${l.spec} is never limited`);
  assert.doesNotMatch(head, /^\s*limit_req zone/m, 'no server-level limit (it would cover the page)');
});

// ---- Container hardening (both compose files) ----------------------------------------------------
/** The block of one service in a compose file (its indented lines up to the next service or top-level key). */
function serviceBlock(compose, name) {
  const m = new RegExp(`^  ${name}:\\n((?: {4,}.*\\n|\\s*\\n)+)`, 'm').exec(compose);
  assert.ok(m, `service ${name}`);
  return m[1];
}
const HARDENING = [
  ['loop-web', planCompose, ['/etc/nginx/conf.d', '/var/cache/nginx', '/run', '/tmp'], ['CHOWN', 'SETGID', 'SETUID']],
  ['loop-db', ingestCompose, ['/var/run/postgresql', '/tmp'], ['CHOWN', 'DAC_READ_SEARCH', 'SETGID', 'SETUID']],
  ['loop-ingest', ingestCompose, ['/tmp'], []],
];
test('compose hardening: read-only root fs + tmpfs for the written paths, every capability dropped but the needed ones, no-new-privileges, limits, rotated logs', () => {
  for (const [name, compose, tmpfs, caps] of HARDENING) {
    const b = serviceBlock(compose, name);
    assert.match(b, /^\s+read_only: true$/m, `${name}: read_only`);
    const mounts = [...b.matchAll(/^\s+- (\/[^:\s]+):size=\d+m$/gm)].map((m) => m[1]);
    assert.deepEqual(mounts, tmpfs, `${name}: tmpfs`);
    assert.match(b, /^\s+cap_drop: \[ALL\]$/m, `${name}: cap_drop ALL`);
    const add = /^\s+cap_add: \[([A-Z_, ]+)\]$/m.exec(b);
    assert.deepEqual(add ? add[1].split(/,\s*/) : [], caps, `${name}: cap_add`);
    assert.match(b, /^\s+security_opt: \[no-new-privileges:true\]$/m, `${name}: no-new-privileges`);
    assert.match(b, /^\s+mem_limit: \d+[mg]$/m, `${name}: memory limit`);
    assert.match(b, /^\s+cpus: [\d.]+$/m, `${name}: cpu limit`);
    assert.match(b, /^\s+pids_limit: \d+$/m, `${name}: pids limit`);
  }
  assert.match(ingestCompose, /^x-logging: &logging\n\s+driver: json-file\n\s+options:\n\s+max-size: "10m"\n\s+max-file: "3"$/m);
  for (const name of ['loop-db', 'loop-ingest']) assert.match(serviceBlock(ingestCompose, name), /^\s+logging: \*logging$/m, name);
  assert.match(serviceBlock(planCompose, 'loop-web'), /logging:\n\s+driver: json-file\n\s+options:\n\s+max-size: "10m"\n\s+max-file: "3"/);
});

test('loop-web healthcheck: nginx answers /nginx-health itself (exact, no proxy, inside the Host and raw-path guards)', () => {
  assert.match(serviceBlock(planCompose, 'loop-web'), /healthcheck:\n\s+#.*\n\s+test: \["CMD", "wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1\/nginx-health"\]/);
  const h = locations(nginx).find((l) => l.spec === '= /nginx-health');
  assert.ok(h, 'location = /nginx-health');
  assert.match(h.body, /return 200 "ok\\n";/);
  assert.doesNotMatch(h.body, /proxy_pass|add_header/);
  assert.equal(allowedByMap('127.0.0.1'), true, 'the healthcheck Host passes the map');
});
