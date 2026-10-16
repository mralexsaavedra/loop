/* docker/loop-server.Dockerfile + docker/loop-web.Dockerfile + docker/docker-compose.yml (the server preview stack):
 * the pieces the install, the hardening and a later release depend on, read as text (no YAML parser, like
 * scripts/loop-web-config.test.mjs), plus one `docker compose config` render when Docker is installed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const dockerfile = read('docker', 'loop-server.Dockerfile');
const webDockerfile = read('docker', 'loop-web.Dockerfile');
const compose = read('docker', 'docker-compose.yml');
const ingestCompose = read('services', 'loop-ingest', 'docker-compose.yml');

function serviceBlock(text, name) {
  const m = new RegExp(`^  ${name}:\\n((?: {4,}.*\\n|\\s*\\n)+)`, 'm').exec(text);
  assert.ok(m, `service ${name}`);
  return m[1];
}

test('Dockerfile: the same digest-pinned node base as the loop-ingest image, VERSION build-arg, OCI labels', () => {
  const from = (text) => /^FROM (\S+)$/m.exec(text)?.[1];
  assert.match(from(dockerfile), /^node:22-alpine@sha256:[0-9a-f]{64}$/);
  assert.equal(from(dockerfile), from(read('services', 'loop-ingest', 'Dockerfile')));
  assert.match(dockerfile, /^ARG VERSION=dev$/m);
  for (const label of ['title', 'source', 'licenses', 'version']) assert.match(dockerfile, new RegExp(`org\\.opencontainers\\.image\\.${label}=`), label);
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$VERSION"/);
  assert.match(dockerfile, /^\s+HC_VERSION=\$VERSION \\$/m, 'status.json reports the image version');
});

test('Dockerfile: container mode on, data and site volumes, production deps only, non-root, healthcheck, the data service entry point', () => {
  for (const env of ['NODE_ENV=production', 'HC_BUILD=container', 'HC_DATA_DIR=/data', 'HC_SITE_DIR=/site', 'ASTRO_TELEMETRY_DISABLED=1']) {
    assert.match(dockerfile, new RegExp(`^\\s*(ENV )?${env}( \\\\)?$`, 'm'), env);
  }
  const installs = [...dockerfile.matchAll(/npm (?:--prefix \S+ )?ci ([^&\n]+)/g)].map((m) => m[1]);
  assert.equal(installs.length, 2);
  for (const flags of installs) assert.match(flags, /--omit=dev/);
  const pkg = JSON.parse(read('package.json'));
  for (const dep of ['astro', 'esbuild']) assert.ok(pkg.dependencies[dep], `${dep} is a production dependency (the page build runs in the image)`);
  assert.match(dockerfile, /^USER node$/m);
  assert.ok(dockerfile.indexOf('USER node') > dockerfile.lastIndexOf('RUN '), 'nothing runs as root after USER node');
  assert.match(dockerfile, /^HEALTHCHECK .*\n\s+CMD node -e "fetch\('http:\/\/localhost:8088\/healthz'\)/m);
  assert.match(dockerfile, /^CMD \["node", "services\/loop-ingest\/src\/server\.js"\]$/m);
  assert.doesNotMatch(dockerfile, /^COPY \. /m, 'never the whole context');
});

test('compose: the image + a build from the repo root, the volumes, the owner files bind mount, required port, HC_INSTANCE naming', () => {
  const b = serviceBlock(compose, 'loop-server');
  assert.match(b, /^\s+image: mralexandersaavedra\/loop-server:\$\{HC_VERSION:-[\d.]+\}$/m);
  assert.match(b, /^\s+context: \.\.\n\s+dockerfile: docker\/loop-server\.Dockerfile\n\s+args:\n\s+VERSION: \$\{HC_VERSION:-[\d.]+\}$/m);
  for (const v of ['loop-server-data:/data', 'loop-site:/site', '${HC_FILES_LOCATION:-./files}:/data/files']) {
    assert.ok(b.includes(`      - ${v}\n`), v);
  }
  assert.match(b, /^\s+- "\$\{INGEST_BIND:\+\$\{INGEST_BIND\}:\}\$\{INGEST_PORT:\?set INGEST_PORT in docker\/\.env\}:8088"$/m);
  assert.match(compose, /^name: loop-server\$\{HC_INSTANCE:\+-\$\{HC_INSTANCE\}\}$/m);
  for (const n of ['container_name: loop-db', 'container_name: loop-server', 'container_name: loop-web', 'name: loop-db-data', 'name: loop-server-data', 'name: loop-site', 'name: loop-net']) {
    assert.ok(compose.includes(`${n}\${HC_INSTANCE:+-\${HC_INSTANCE}}`), n);
  }
  assert.match(b, /^\s+INGEST_TOKEN: \$\{INGEST_TOKEN\}$/m);
  assert.match(b, /^\s+DB_HOST: loop-db$/m);
});

test('compose: the database service and its volume name are exactly services/loop-ingest\'s (the data carries over)', () => {
  assert.equal(/postgres:17-alpine@sha256:[0-9a-f]{64}/.exec(compose)?.[0], /postgres:17-alpine@sha256:[0-9a-f]{64}/.exec(ingestCompose)?.[0]);
  assert.ok(compose.includes('name: loop-db-data${HC_INSTANCE:+-${HC_INSTANCE}}'));
});

test('compose hardening: read-only root fs, tmpfs for every path the build writes (owned by node), no capability, init, limits, rotated logs', () => {
  const b = serviceBlock(compose, 'loop-server');
  assert.match(b, /^\s+read_only: true$/m);
  assert.match(b, /^\s+init: true$/m);
  const mounts = [...b.matchAll(/^\s+- (\/[^:\s]+):size=\d+m,uid=1000,gid=1000$/gm)].map((m) => m[1]);
  assert.deepEqual(mounts, ['/tmp', '/app/.astro', '/app/web/.astro', '/app/web/node_modules']);
  // the Dockerfile creates the same folders for the node user (a run without the compose file still works)
  for (const dir of ['.astro', 'web/.astro', 'web/node_modules']) assert.match(dockerfile, new RegExp(`chown node:node .*\\s${dir.replace('.', '\\.')}(\\s|$)`), dir);
  assert.match(dockerfile, /^\s+HC_BUILD_DIR=\/tmp\//m, 'the build output is under the /tmp tmpfs');
  assert.match(b, /^\s+cap_drop: \[ALL\]$/m);
  assert.doesNotMatch(b, /cap_add/);
  assert.match(b, /^\s+security_opt: \[no-new-privileges:true\]$/m);
  assert.match(b, /^\s+mem_limit: \d+[mg]$/m);
  assert.match(b, /^\s+pids_limit: \d+$/m);
  assert.match(b, /^\s+logging: \*logging$/m);
  assert.match(serviceBlock(compose, 'loop-db'), /^\s+read_only: true$/m);
});

test('docker/.env.example names every variable the compose file reads; .env and the files folder are gitignored', () => {
  const example = read('docker', '.env.example');
  const vars = new Set([...compose.matchAll(/\$\{([A-Z_]+)/g)].map((m) => m[1]));
  for (const v of vars) assert.match(example, new RegExp(`^${v}=`, 'm'), v);
  const ignore = read('docker', '.gitignore').split('\n');
  for (const line of ['.env', '.env.*', '!.env.example', 'files/']) assert.ok(ignore.includes(line), line);
});

test('loop-web Dockerfile: the same digest-pinned nginx as services/loop-web, VERSION build-arg, OCI labels', () => {
  const from = /^FROM (\S+)$/m.exec(webDockerfile)?.[1];
  assert.match(from, /^nginx:alpine@sha256:[0-9a-f]{64}$/);
  assert.equal(from, /image: (nginx:alpine@sha256:[0-9a-f]{64})/.exec(read('services', 'loop-web', 'docker-compose.yml'))?.[1]);
  assert.match(webDockerfile, /^ARG VERSION=dev$/m);
  for (const label of ['title', 'source', 'licenses', 'version']) assert.match(webDockerfile, new RegExp(`org\\.opencontainers\\.image\\.${label}=`), label);
  assert.match(webDockerfile, /org\.opencontainers\.image\.version="\$VERSION"/);
  // Docker seeds a new named volume from the first container that mounts it: loop-server's node user (uid 1000, the
  // uid of its tmpfs mounts) must be able to publish into loop-site whichever container compose creates first
  assert.match(webDockerfile, /chown 1000:1000 \/usr\/share\/nginx\/html$/m);
  assert.match(webDockerfile, /rm -f \/usr\/share\/nginx\/html\/\*/, 'no nginx default page seeded into the site volume');
  assert.match(webDockerfile, /^HEALTHCHECK .*\n\s+CMD wget -q -O \/dev\/null http:\/\/127\.0\.0\.1\/nginx-health/m);
});

test('loop-web Dockerfile: copies exactly the audited template + hosts.sh from services/loop-web (single source), nothing else', () => {
  const copies = [...webDockerfile.matchAll(/^COPY (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(copies, [
    '--chmod=0644 services/loop-web/nginx.conf.template /etc/nginx/templates/default.conf.template',
    '--chmod=0755 services/loop-web/hosts.sh /docker-entrypoint.d/15-hc-hosts.sh',
  ]);
  assert.doesNotMatch(webDockerfile, /^ADD /m);
  // no second copy of the config under docker/ that could drift from the audited one
  for (const f of fs.readdirSync(path.join(ROOT, 'docker'))) assert.doesNotMatch(f, /nginx|\.template$|hosts\.sh/, f);
});

test('compose loop-web: the image + a build from the repo root, the site volume read-only, no bind mount, port, HC_INSTANCE naming', () => {
  const b = serviceBlock(compose, 'loop-web');
  assert.match(b, /^\s+image: mralexandersaavedra\/loop-web:\$\{HC_VERSION:-[\d.]+\}$/m);
  assert.match(b, /^\s+context: \.\.\n\s+dockerfile: docker\/loop-web\.Dockerfile\n\s+args:\n\s+VERSION: \$\{HC_VERSION:-[\d.]+\}$/m);
  const mounts = [...b.matchAll(/^ {6}- (\S+:\/\S*)$/gm)].map((m) => m[1]).filter((m) => !m.includes(':size='));
  assert.deepEqual(mounts, ['loop-site:/usr/share/nginx/html:ro'], 'only the site volume, read-only; the template is baked in');
  const directives = b.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(directives, /nginx\.conf\.template|hosts\.sh|\.\/site/);
  assert.match(b, /^\s+- "\$\{PLAN_WEB_BIND:\+\$\{PLAN_WEB_BIND\}:\}\$\{PLAN_WEB_PORT:-8090\}:80"$/m);
  assert.match(b, /^\s+PLAN_WEB_EXTRA_HOSTS: \$\{PLAN_WEB_EXTRA_HOSTS:-\}$/m);
  assert.match(b, /^\s+container_name: loop-web\$\{HC_INSTANCE:\+-\$\{HC_INSTANCE\}\}$/m);
  assert.match(b, /^\s+depends_on:\n\s+loop-server:\n\s+condition: service_healthy$/m);
  assert.match(b, /^\s+test: \["CMD", "wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1\/nginx-health"\]$/m);
  assert.doesNotMatch(b, /INGEST_PORT|INGEST_TOKEN|POSTGRES_/, 'no secret and no data port in the web container');
});

test('compose loop-web hardening: read-only root fs, tmpfs for conf.d / cache / run / tmp, only the caps nginx needs, limits', () => {
  const b = serviceBlock(compose, 'loop-web');
  assert.match(b, /^\s+read_only: true$/m);
  const tmpfs = [...b.matchAll(/^\s+- (\/[^:\s]+):size=\d+m$/gm)].map((m) => m[1]);
  assert.deepEqual(tmpfs, ['/etc/nginx/conf.d', '/var/cache/nginx', '/run', '/tmp']);
  assert.match(b, /^\s+cap_drop: \[ALL\]$/m);
  assert.match(b, /^\s+cap_add: \[CHOWN, SETGID, SETUID\]$/m);
  assert.match(b, /^\s+security_opt: \[no-new-privileges:true\]$/m);
  assert.match(b, /^\s+mem_limit: \d+[mg]$/m);
  assert.match(b, /^\s+pids_limit: \d+$/m);
  assert.match(b, /^\s+logging: \*logging$/m);
});

test('compose loop-server: network alias loop-ingest (the template upstream and the service Host allowlist stay unchanged)', () => {
  assert.match(serviceBlock(compose, 'loop-server'), /^\s+networks:\n\s+default:\n(?:\s+#.*\n)*\s+aliases: \[loop-ingest\]$/m);
  assert.match(read('services', 'loop-web', 'nginx.conf.template'), /^\s+server loop-ingest:8088 resolve;$/m);
  assert.match(read('services', 'loop-ingest', 'src', 'http.js'), /^const LOCAL_HOSTS = \[[^\]]*'loop-ingest'/m);
});

test('compose rendered by docker compose: the alias, the read-only site mount, the network and the instance names', { skip: spawnSync('docker', ['compose', 'version']).status === 0 ? false : 'docker compose not installed' }, () => {
  const render = (env) => {
    const r = spawnSync('docker', ['compose', '-f', path.join(ROOT, 'docker', 'docker-compose.yml'), '--project-directory', fs.mkdtempSync(path.join(os.tmpdir(), 'hc-compose-')), 'config', '--format', 'json'],
      { env: { PATH: process.env.PATH, HOME: os.tmpdir(), POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'd', INGEST_TOKEN: 't', INGEST_PORT: '18088', ...env }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  for (const [env, suffix] of [[{}, ''], [{ HC_INSTANCE: 'second' }, '-second']]) {
    const c = render(env);
    const web = c.services['loop-web'];
    assert.equal(web.container_name, `loop-web${suffix}`);
    assert.deepEqual(web.volumes.map((v) => [v.type, v.source, v.target, v.read_only]), [['volume', 'loop-site', '/usr/share/nginx/html', true]]);
    assert.equal(c.volumes['loop-site'].name, `loop-site${suffix}`);
    assert.deepEqual(c.services['loop-server'].networks.default.aliases, ['loop-ingest']);
    assert.ok(web.networks && 'default' in web.networks);
    assert.equal(c.networks.default.name, `loop-net${suffix}`);
    assert.equal(web.ports[0].target, 80);
    assert.equal(web.ports[0].published, '8090');
  }
});
