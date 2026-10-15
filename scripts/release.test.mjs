/* Release consistency: one version everywhere, pinned base images, the CI and image workflows, the
 * community files. Fails before a release can drift (docs/development.md → Releasing). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const IMAGE = 'mralexandersaavedra/loop-ingest';
const VERSION = JSON.parse(read('package.json')).version;

test('one version: the root package, the data service and the newest CHANGELOG release agree', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).version, VERSION);
  for (const p of ['package-lock.json', 'services/loop-ingest/package-lock.json']) assert.equal(JSON.parse(read(p)).version, VERSION, p);
  const top = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/m);
  assert.ok(top, 'CHANGELOG.md has a "## [x.y.z] - YYYY-MM-DD" release heading');
  assert.equal(top[1], VERSION);
});

test('one Node version: .nvmrc, both engines fields and the Dockerfile agree on 22', () => {
  assert.equal(read('.nvmrc').trim(), '22');
  for (const p of ['package.json', 'services/loop-ingest/package.json']) assert.equal(JSON.parse(read(p)).engines.node, '>=22.12', p);
  assert.match(read('services/loop-ingest/Dockerfile'), /^FROM node:22-alpine@sha256:[0-9a-f]{64}$/m);
});

test('every base image is pinned by digest (tag kept for humans; Dependabot moves the digest)', () => {
  const compose = read('services/loop-ingest/docker-compose.yml') + read('services/loop-web/docker-compose.yml');
  for (const img of ['postgres:17-alpine', 'nginx:alpine']) assert.match(compose, new RegExp(`image: ${img}@sha256:[0-9a-f]{64}`), img);
});

test('the data service runs the published image by default and still builds from source', () => {
  const c = read('services/loop-ingest/docker-compose.yml');
  assert.ok(c.includes(`image: ${IMAGE}:\${HC_VERSION:-${VERSION}}`), 'image with the release version as default');
  assert.match(c, /^\s+build: \.$/m, 'docker compose up --build still works from a clone');
  const d = read('services/loop-ingest/Dockerfile');
  for (const l of ['org.opencontainers.image.source', 'org.opencontainers.image.licenses', 'org.opencontainers.image.version']) assert.ok(d.includes(l), l);
  assert.match(d, /^HEALTHCHECK /m);
  assert.match(d, /^ENV NODE_ENV=production$/m);
});

test('CI runs both suites on every push and pull request; tags publish multi-arch images to Docker Hub', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run test:services/);
  const rel = read('.github/workflows/release.yml');
  assert.match(rel, /tags:\s*\n\s*- 'v\*'/);
  assert.match(rel, /linux\/amd64,linux\/arm64/);
  assert.ok(rel.includes(IMAGE), 'publishes the Docker Hub image');
  assert.match(rel, /secrets\.DOCKERHUB_TOKEN/);
  assert.ok(!/password:\s*[^$\s]/.test(rel), 'no credential in the file');
  assert.ok(exists('.github/dependabot.yml'));
  const dep = read('.github/dependabot.yml');
  for (const name of ['node', 'postgres']) {
    assert.match(dep, new RegExp(`dependency-name: ${name}\\n\\s+update-types: \\[version-update:semver-major\\]`), `${name} majors are ignored`);
  }
});

test('community files: security policy and contributing guide', () => {
  for (const p of ['SECURITY.md', 'CONTRIBUTING.md', 'services/loop-ingest/.dockerignore']) assert.ok(exists(p), p);
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).license, 'MIT');
});
