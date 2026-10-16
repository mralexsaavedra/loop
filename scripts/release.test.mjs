/* Release consistency: one version everywhere, pinned base images, the CI and image workflows, the
 * community files. Fails before a release can drift (docs/development.md → Releasing). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const IMAGES = ['mralexandersaavedra/loop-server', 'mralexandersaavedra/loop-web'];
const VERSION = JSON.parse(read('package.json')).version;

test('one version: the root package, the data service, the server images\' tag default and the newest CHANGELOG release agree', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).version, VERSION);
  for (const p of ['package-lock.json', 'services/loop-ingest/package-lock.json']) assert.equal(JSON.parse(read(p)).version, VERSION, p);
  // the date is set at tag time (docs/development.md -> Releasing); until then the heading says UNRELEASED, and the
  // release workflow refuses to publish it (pinned below)
  const top = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\] - (?:\d{4}-\d{2}-\d{2}|UNRELEASED)$/m);
  assert.ok(top, 'CHANGELOG.md has a "## [x.y.z] - YYYY-MM-DD" (or "- UNRELEASED") release heading');
  assert.equal(top[1], VERSION);
  const defaults = [...read('docker/docker-compose.yml').matchAll(/HC_VERSION:-([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(defaults.length, 4, 'both images and both VERSION build args default to the release');
  for (const d of defaults) assert.equal(d, VERSION, 'docker/docker-compose.yml HC_VERSION default');
  assert.match(read('docker/.env.example'), new RegExp(`^HC_VERSION=${VERSION.replaceAll('.', '\\.')}$`, 'm'));
});

test('one Node version: .nvmrc, both engines fields and the Dockerfile agree on 22', () => {
  assert.equal(read('.nvmrc').trim(), '22');
  for (const p of ['package.json', 'services/loop-ingest/package.json']) assert.equal(JSON.parse(read(p)).engines.node, '>=22.12', p);
  for (const p of ['services/loop-ingest/Dockerfile', 'docker/loop-server.Dockerfile']) assert.match(read(p), /^FROM node:22-alpine@sha256:[0-9a-f]{64}$/m, p);
});

test('every base image is pinned by digest (tag kept for humans; Dependabot moves the digest)', () => {
  const compose = read('services/loop-ingest/docker-compose.yml') + read('services/loop-web/docker-compose.yml');
  for (const img of ['postgres:17-alpine', 'nginx:alpine']) assert.match(compose, new RegExp(`image: ${img}@sha256:[0-9a-f]{64}`), img);
  assert.match(read('docker/docker-compose.yml'), /image: postgres:17-alpine@sha256:[0-9a-f]{64}/);
  assert.match(read('docker/loop-web.Dockerfile'), /^FROM nginx:alpine@sha256:[0-9a-f]{64}$/m);
});

test('the host-mode data service still builds from a clone; both published images carry the OCI labels from the VERSION build arg', () => {
  const c = read('services/loop-ingest/docker-compose.yml');
  assert.match(c, /^\s+build: \.$/m, 'docker compose up --build still works from a clone');
  const d = read('services/loop-ingest/Dockerfile');
  assert.match(d, /^HEALTHCHECK /m);
  assert.match(d, /^ENV NODE_ENV=production$/m);
  for (const p of ['docker/loop-server.Dockerfile', 'docker/loop-web.Dockerfile']) {
    const f = read(p);
    assert.match(f, /^ARG VERSION=dev$/m, p);
    for (const l of ['org.opencontainers.image.source', 'org.opencontainers.image.licenses']) assert.ok(f.includes(l), `${p} ${l}`);
    assert.ok(f.includes('org.opencontainers.image.version="$VERSION"'), `${p} version label`);
    assert.match(f, /^HEALTHCHECK /m, p);
  }
});

test('CI runs the lint, the typecheck and both suites on every push and pull request; tags publish multi-arch images to Docker Hub', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm run typecheck/);
  assert.equal(JSON.parse(read('package.json')).scripts.lint, 'eslint .');
  assert.equal(JSON.parse(read('package.json')).scripts.typecheck, 'tsc --noEmit -p jsconfig.json');
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run test:services/);
  const rel = read('.github/workflows/release.yml');
  assert.match(rel, /tags:\s*\n\s*- 'v\*'/);
  assert.match(rel, /linux\/amd64,linux\/arm64/);
  assert.match(rel, /secrets\.DOCKERHUB_TOKEN/);
  assert.match(rel, /vars\.DOCKERHUB_USERNAME/);
  assert.ok(!/password:\s*[^$\s]/.test(rel), 'no credential in the file');
  assert.ok(exists('.github/dependabot.yml'));
  const dep = read('.github/dependabot.yml');
  for (const name of ['node', 'postgres', 'nginx']) {
    assert.match(dep, new RegExp(`dependency-name: ${name}\\n\\s+update-types: \\[version-update:semver-major\\]`), `${name} majors are ignored`);
  }
});

test('the release publishes exactly loop-server and loop-web from the repo-root Dockerfiles, after the version check', () => {
  const rel = read('.github/workflows/release.yml');
  assert.match(rel, /^\s+image: \[loop-server, loop-web\]$/m, 'one matrix entry per published image');
  assert.match(rel, /^\s+images: mralexandersaavedra\/\$\{\{ matrix\.image \}\}$/m);
  for (const img of IMAGES) assert.ok(exists(`docker/${img.split('/')[1]}.Dockerfile`), img);
  assert.ok(!rel.includes('loop-ingest:') && !/images: mralexandersaavedra\/loop-ingest/.test(rel), 'the host-mode loop-ingest image is no longer published');
  assert.match(rel, /^\s+context: \.$/m, 'the repo root is the build context (its default-deny .dockerignore)');
  assert.match(rel, /^\s+file: docker\/\$\{\{ matrix\.image \}\}\.Dockerfile$/m);
  assert.match(rel, /^\s+build-args: VERSION=\$\{\{ steps\.meta\.outputs\.version \}\}$/m, 'OCI version label from the tag');
  for (const t of ['type=semver,pattern={{version}}', 'type=semver,pattern={{major}}.{{minor}}', 'type=raw,value=latest']) assert.ok(rel.includes(t), t);
  assert.match(rel, /^\s+needs: check$/m, 'nothing is pushed before the version check');
  // least privilege: read-only contents at the top, no job widens it; every action pinned to a commit SHA
  assert.match(rel, /^permissions:\n {2}contents: read\n/m);
  assert.equal((rel.match(/permissions:/g) || []).length, 1, 'no job-level permissions');
  assert.doesNotMatch(rel, /: write/);
  const uses = [...rel.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 6);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} pinned by commit SHA`);
});

test('Dependabot moves the base image digests of the docker/ Dockerfiles and compose file too', () => {
  const dep = read('.github/dependabot.yml');
  assert.match(dep, /package-ecosystem: docker\n\s+directories: \[[^\]]*\/docker\]/);
  assert.match(dep, /package-ecosystem: docker-compose\n\s+directories: \[[^\]]*\/docker\]/);
});

// The check job's script, run for real against a scratch copy of the version files (bash + node, as on the runner).
const CHECK_SCRIPT = (() => {
  const rel = read('.github/workflows/release.yml');
  const m = rel.match(/\n {8}run: \|\n((?: {10}.*\n)+)/);
  assert.ok(m, 'the check job has a run block');
  return m[1].split('\n').map((l) => l.slice(10)).join('\n');
})();

function runCheck({ tag = `v${VERSION}`, changelog, compose, env } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  try {
    fs.mkdirSync(path.join(dir, 'docker'));
    fs.writeFileSync(path.join(dir, 'package.json'), read('package.json'));
    fs.writeFileSync(path.join(dir, 'docker/docker-compose.yml'), compose ?? read('docker/docker-compose.yml'));
    fs.writeFileSync(path.join(dir, 'docker/.env.example'), env ?? read('docker/.env.example'));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog ?? `# Changelog\n\n## [${VERSION}] - 2026-10-20\n\nNotes.\n`);
    const r = spawnSync('bash', ['-e', '-c', CHECK_SCRIPT], { cwd: dir, env: { PATH: process.env.PATH, GITHUB_REF_NAME: tag }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the release check passes one consistent dated version', () => {
  const r = runCheck();
  assert.equal(r.status, 0, r.out);
});

test('the release check refuses a tag that differs from package.json', () => {
  const r = runCheck({ tag: 'v9.9.9' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /tag v9\.9\.9 != v/);
});

test('the release check refuses a CHANGELOG entry still marked UNRELEASED', () => {
  const r = runCheck({ changelog: `# Changelog\n\n## [${VERSION}] - UNRELEASED\n\nNotes.\n` });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /still UNRELEASED/);
});

test('the release check refuses a compose HC_VERSION default or .env.example HC_VERSION that differs', () => {
  const compose = read('docker/docker-compose.yml').replace(`image: mralexandersaavedra/loop-web:\${HC_VERSION:-${VERSION}}`, 'image: mralexandersaavedra/loop-web:${HC_VERSION:-0.0.1}');
  assert.notEqual(compose, read('docker/docker-compose.yml'));
  const a = runCheck({ compose });
  assert.notEqual(a.status, 0);
  assert.match(a.out, /HC_VERSION defaults/);
  const b = runCheck({ env: read('docker/.env.example').replace(/^HC_VERSION=.*$/m, 'HC_VERSION=0.0.1') });
  assert.notEqual(b.status, 0);
  assert.match(b.out, /\.env\.example HC_VERSION/);
});

test('CI runs the data service suite against a real Postgres, the same image and digest as the compose file', () => {
  const ci = read('.github/workflows/ci.yml');
  const pinned = read('services/loop-ingest/docker-compose.yml').match(/image: (postgres:17-alpine@sha256:[0-9a-f]{64})/)[1];
  assert.ok(ci.includes(`image: ${pinned}`), 'the CI postgres service uses the compose pin');
  assert.match(ci, /TEST_DATABASE_URL: postgres:\/\//);
  assert.match(ci, /npm run test:pg/);
  assert.equal(JSON.parse(read('package.json')).scripts['test:pg'], 'npm --prefix services/loop-ingest ci --no-audit --no-fund && npm --prefix services/loop-ingest run test:pg');
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).scripts['test:pg'], 'node --test "test/pg/*.test.js"');
});

test('the README server quick start downloads the compose files of this release, which exist in the repo', () => {
  const readme = read('README.md');
  const urls = [...readme.matchAll(/https:\/\/raw\.githubusercontent\.com\/mralexsaavedra\/loop\/(v[^/]+)\/(docker\/[^\s]+)/g)];
  assert.deepEqual(urls.map((m) => m[2]).sort(), ['docker/.env.example', 'docker/docker-compose.yml']);
  for (const [, tag, file] of urls) {
    assert.equal(tag, `v${VERSION}`, `${file} is downloaded from the release tag`);
    assert.ok(exists(file), file);
  }
  assert.match(readme, /^\s+curl -fsSLO https:\/\/\S+\/docker\/docker-compose\.yml$/m, 'kept under its own name');
  assert.match(readme, /^\s+curl -fsSL -o \.env https:\/\/\S+\/docker\/\.env\.example$/m, 'saved as .env');
});

test('community files: security policy and contributing guide', () => {
  for (const p of ['SECURITY.md', 'CONTRIBUTING.md', 'services/loop-ingest/.dockerignore']) assert.ok(exists(p), p);
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).license, 'MIT');
});
