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
  assert.match(read('docker/example.env'), new RegExp(`^HC_VERSION=${VERSION.replaceAll('.', '\\.')}$`, 'm'));
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
  // each architecture on a native runner (no QEMU: emulated arm64 crashed Node during npm ci), merged into one manifest
  assert.match(rel, /- platform: linux\/amd64\n\s+runner: ubuntu-24\.04\n/);
  assert.match(rel, /- platform: linux\/arm64\n\s+runner: ubuntu-24\.04-arm\n/);
  assert.doesNotMatch(rel, /setup-qemu-action/, 'no emulation');
  assert.match(rel, /push-by-digest=true/);
  // the per-arch build's labels carry the plain X.Y.Z version (org.opencontainers.image.version), not the tag name
  assert.match(rel, /images: mralexandersaavedra\/\$\{\{ matrix\.image \}\}\n {10}# only for the OCI labels[^\n]*\n {10}tags: type=semver,pattern=\{\{version\}\}\n {6}- id: build/);
  assert.match(rel, /docker buildx imagetools create/);
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
  assert.match(rel, /^\s+build-args: VERSION=\$\{\{ needs\.check\.outputs\.version \}\}$/m, 'OCI version label from the checked tag');
  for (const t of ['type=semver,pattern={{version}}', 'type=semver,pattern={{major}}.{{minor}}', 'type=raw,value=latest']) assert.ok(rel.includes(t), t);
  assert.match(rel, /^\s+needs: \[check, test\]$/m, 'nothing is pushed before the version check and the CI suites + image smoke');
  // least privilege: read-only contents at the top; the ONLY job that widens it is github-release (contents: write,
  // to publish the GitHub Release once both images are out); every action pinned to a commit SHA
  assert.match(rel, /^permissions:\n {2}contents: read\n/m);
  assert.equal((rel.match(/permissions:/g) || []).length, 2, 'the top-level block + the github-release job');
  assert.deepEqual([...rel.matchAll(/^ +(\S+): write$/gm)].map((m) => m[1]), ['contents']);
  const ghRelease = rel.slice(rel.indexOf('\n  github-release:'));
  assert.ok(rel.indexOf('\n  github-release:') > 0 && /permissions:\n {6}contents: write/.test(ghRelease), 'write is scoped to github-release');
  assert.equal(rel.slice(0, rel.indexOf('\n  github-release:')).match(/: write/g), null, 'no other job writes');
  const uses = [...rel.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 6);
  for (const u of uses) if (!u.startsWith('./')) assert.match(u, /@[0-9a-f]{40}$/, `${u} pinned by commit SHA`);
});

test('the release waits for the whole CI (suites, Postgres, image build + smoke): ci.yml is a reusable workflow it calls', () => {
  const rel = read('.github/workflows/release.yml');
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^on:\n(?:.*\n)*? {2}workflow_call:$/m, 'ci.yml can be called');
  assert.match(rel, /^ {2}test:\n {4}uses: \.\/\.github\/workflows\/ci\.yml$/m, 'release.yml calls it as job test');
  assert.match(rel, /^ {2}build:\n {4}needs: \[check, test\]$/m, 'nothing is built or pushed before the checks and the CI');
  assert.match(rel, /^ {2}image:\n {4}needs: \[check, build\]$/m);
  assert.match(ci, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(ci, /: write/);
});

test('CI builds both images for amd64 (no push) and smoke-tests a minimal compose stack (scripts/image-smoke.sh)', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^ {2}images:\n(?:.*\n)*? {6}- run: scripts\/image-smoke\.sh$/m, 'the images job runs the smoke script');
  assert.doesNotMatch(ci, /docker\/login-action|push: true/, 'CI never pushes');
  const sh = read('scripts/image-smoke.sh');
  assert.ok((fs.statSync(path.join(ROOT, 'scripts/image-smoke.sh')).mode & 0o111) !== 0, 'executable');
  for (const s of ['set -euo pipefail', 'docker/docker-compose.yml', 'build', 'up -d --wait', '/healthz', '/status.json', 'publishedAt', '102400', 'down -v', 'linux/amd64', 'INGEST_BIND=127.0.0.1', 'PLAN_WEB_BIND=127.0.0.1', 'trap ']) assert.ok(sh.includes(s), s);
  assert.doesNotMatch(sh, /docker (image )?push|docker builder prune|docker (image )?rm .*:1\.0\.0/);
});

test('every checkout in the workflows drops the job token from .git/config (persist-credentials: false)', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const text = read(f);
    const checkouts = text.split('\n').map((l, i) => [l, i]).filter(([l]) => /uses: actions\/checkout@/.test(l));
    assert.ok(checkouts.length > 0, f);
    const lines = text.split('\n');
    for (const [, i] of checkouts) {
      const block = [];
      for (let j = i + 1; j < lines.length && /^\s{8,}\S/.test(lines[j]); j += 1) block.push(lines[j]);
      assert.ok(block.some((l) => /^\s+persist-credentials: false$/.test(l)), `${f}:${i + 1} persist-credentials: false`);
    }
  }
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

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/* A scratch git repo with the version files, committed on `main` (mirrored as origin/main, as a fetch-depth 0
 * checkout has it), `tags` on that commit; `offMain` tags a commit origin/main does not contain. */
function runCheck({ tag, version = VERSION, changelog, compose, env, tags = [], offMain = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  try {
    const sub = (s) => (version === VERSION ? s : s.replaceAll(VERSION, version));
    fs.mkdirSync(path.join(dir, 'docker'));
    fs.writeFileSync(path.join(dir, 'package.json'), sub(read('package.json')));
    fs.writeFileSync(path.join(dir, 'docker/docker-compose.yml'), compose ?? sub(read('docker/docker-compose.yml')));
    fs.writeFileSync(path.join(dir, 'docker/example.env'), env ?? sub(read('docker/example.env')));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog ?? `# Changelog\n\n## [${version}] - 2026-10-20\n\nNotes.\n`);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'release');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (offMain) git(dir, 'commit', '-q', '--allow-empty', '-m', 'not on main');
    for (const t of tags) git(dir, 'tag', t);
    const out = path.join(dir, '.github-output');
    fs.writeFileSync(out, '');
    // GitHub's default `run` shell: bash -e -o pipefail
    const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', CHECK_SCRIPT], {
      cwd: dir,
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', HOME: dir, GITHUB_REF_NAME: tag ?? `v${version}`, GITHUB_SHA: git(dir, 'rev-parse', 'HEAD'), GITHUB_OUTPUT: out },
      encoding: 'utf8',
    });
    return { status: r.status, out: r.stdout + r.stderr, outputs: fs.readFileSync(out, 'utf8') };
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

test('the release check refuses a compose HC_VERSION default or example.env HC_VERSION that differs', () => {
  const compose = read('docker/docker-compose.yml').replace(`image: mralexandersaavedra/loop-web:\${HC_VERSION:-${VERSION}}`, 'image: mralexandersaavedra/loop-web:${HC_VERSION:-0.0.1}');
  assert.notEqual(compose, read('docker/docker-compose.yml'));
  const a = runCheck({ compose });
  assert.notEqual(a.status, 0);
  assert.match(a.out, /HC_VERSION defaults/);
  const b = runCheck({ env: read('docker/example.env').replace(/^HC_VERSION=.*$/m, 'HC_VERSION=0.0.1') });
  assert.notEqual(b.status, 0);
  assert.match(b.out, /example\.env HC_VERSION/);
});

test('the release check refuses an example.env HC_VERSION that only matches the version as a regex', () => {
  const r = runCheck({ env: read('docker/example.env').replace(/^HC_VERSION=.*$/m, `HC_VERSION=${VERSION.replaceAll('.', 'x')}`) });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /example\.env HC_VERSION/);
});

test('the release check refuses an UNRELEASED first version heading even with a dated one further down', () => {
  const r = runCheck({ changelog: `# Changelog\n\n## [${VERSION}] - UNRELEASED\n\nNotes.\n\n## [${VERSION}] - 2026-10-20\n\nOld.\n` });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /first version heading/);
});

test('the release check refuses a loop-server or loop-web image line with a hardcoded tag', () => {
  for (const img of IMAGES) {
    const compose = read('docker/docker-compose.yml').replace(`image: ${img}:\${HC_VERSION:-${VERSION}}`, `image: ${img}:${VERSION}`);
    assert.notEqual(compose, read('docker/docker-compose.yml'), img);
    const r = runCheck({ compose });
    assert.notEqual(r.status, 0, `${img}: ${r.out}`);
    assert.match(r.out, /image line/);
  }
});

test('the release check refuses anything but a plain X.Y.Z version, consistent everywhere', () => {
  for (const version of [`${VERSION}-rc.1`, `${VERSION}+build.5`, '1.0']) {
    const r = runCheck({ version });
    assert.notEqual(r.status, 0, `${version}: ${r.out}`);
    assert.match(r.out, /not a plain X\.Y\.Z/, version);
  }
});

test('the release check refuses a tagged commit that is not on main', () => {
  const r = runCheck({ offMain: true });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /not on main/);
});

test('latest moves only for the highest X.Y.Z tag; a backport publishes X.Y.Z and X.Y but not latest', () => {
  const v = `v${VERSION}`;
  const [maj, min, pat] = VERSION.split('.').map(Number);
  assert.match(runCheck({ tags: [v] }).outputs, /^latest=true$/m, 'the only release');
  assert.match(runCheck({ tags: [`v${maj}.${min}.${pat + 1}`, v] }).outputs, /^latest=false$/m, 'a newer patch exists');
  assert.match(runCheck({ tags: [`v${maj + 1}.0.0`, v] }).outputs, /^latest=false$/m, 'a newer major exists');
  // numeric, not lexical (0.10.0 > 0.9.0, 1.10.0 > 1.9.0); pre-release and non-semver tags are ignored
  assert.match(runCheck({ tags: [v, 'v0.9.0', 'v0.10.0', `v${maj + 1}.0.0-rc.1`, 'vnext', 'v99'] }).outputs, /^latest=true$/m, 'only older or non-release tags');
  assert.match(runCheck({ version: '1.10.0', tags: ['v1.9.0', 'v1.10.0'] }).outputs, /^latest=true$/m, '1.10.0 > 1.9.0');
  assert.match(runCheck({ version: '1.9.0', tags: ['v1.9.0', 'v1.10.0'] }).outputs, /^latest=false$/m, '1.9.0 < 1.10.0');
});

test('the image job tags latest only from the check job\'s ordering, never metadata-action\'s automatic latest', () => {
  const rel = read('.github/workflows/release.yml');
  assert.match(rel, /^\s+fetch-depth: 0$/m, 'the check sees main and every tag');
  assert.match(rel, /^\s+latest: \$\{\{ steps\.version\.outputs\.latest \}\}$/m, 'job output');
  assert.match(rel, /type=raw,value=latest,enable=\$\{\{ needs\.check\.outputs\.latest == 'true' \}\}/);
  assert.match(rel, /^\s+flavor: latest=false$/m, 'no automatic latest on a semver tag');
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
  assert.deepEqual(urls.map((m) => m[2]).sort(), ['docker/docker-compose.yml', 'docker/example.env']);
  for (const [, tag, file] of urls) {
    assert.equal(tag, `v${VERSION}`, `${file} is downloaded from the release tag`);
    assert.ok(exists(file), file);
  }
  assert.match(readme, /^\s+curl -fsSLO https:\/\/\S+\/docker\/docker-compose\.yml$/m, 'kept under its own name');
  assert.match(readme, /^\s+curl -fsSL -o \.env https:\/\/\S+\/docker\/example\.env$/m, 'saved as .env');
});

test('the server restore block waits for the database, stops at the first error and only then starts the rest', () => {
  const g = read('docs/guides/upgrading.md');
  const block = g.match(/```sh\n(docker compose up -d --wait loop-db[^`]*)```/);
  assert.ok(block, 'the restore block starts the database with --wait (a plain up -d returns before Postgres accepts connections)');
  const lines = block[1].trim().split('\n');
  assert.deepEqual(lines.slice(0, -1).filter((l) => !l.endsWith(' &&')), [], 'every line but the last ends in && (safe to paste whole)');
  assert.match(lines[1], /psql -q -v ON_ERROR_STOP=1 /, 'psql stops at the first failing statement');
  assert.equal(lines.at(-1), 'docker compose up -d');
});

test('the docs sections that docker/docker-compose.yml and the /setup skill point at exist', () => {
  const header = read('docker/docker-compose.yml').match(/docs\/lan-services\.md -> ([^)]+)\)/);
  assert.ok(header, 'the compose header names a docs/lan-services.md section');
  assert.match(read('docs/lan-services.md'), new RegExp(`^## ${header[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), header[1]);
  const close = read('.claude/skills/setup/SKILL.md').split('## Close\n')[1];
  assert.doesNotMatch(close, /level/, 'the setup skill speaks of paths (server, coach), not levels');
});

test('community files: security policy and contributing guide', () => {
  for (const p of ['SECURITY.md', 'CONTRIBUTING.md', 'services/loop-ingest/.dockerignore']) assert.ok(exists(p), p);
  assert.equal(JSON.parse(read('services/loop-ingest/package.json')).license, 'MIT');
});
