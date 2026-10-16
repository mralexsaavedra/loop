/* docker/loop-server.Dockerfile + docker/docker-compose.yml (the loop-server preview stack): the pieces the install,
 * the hardening and a later release depend on, read as text (no YAML parser, like scripts/loop-web-config.test.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const dockerfile = read('docker', 'loop-server.Dockerfile');
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
  for (const n of ['container_name: loop-db', 'container_name: loop-server', 'name: loop-db-data', 'name: loop-server-data', 'name: loop-site', 'name: loop-net']) {
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
