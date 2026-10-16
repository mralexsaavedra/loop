/* The repo-root .dockerignore (the build context of docker/loop-server.Dockerfile and docker/loop-web.Dockerfile) is DEFAULT DENY: every personal
 * path stays out of the context sent to the Docker daemon, while the code and the tracked seeds the image needs get
 * in. Evaluated the way Docker does: the patterns in order, the last one that matches the path or one of its parent
 * folders wins, a leading `!` lets the path back in. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RULES = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => ({ negate: l.startsWith('!'), re: globToRegExp(l.replace(/^!/, '')) }));

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True when the path is excluded from the build context. */
function excluded(p) {
  const parts = p.split('/');
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let out = false;
  for (const { negate, re } of RULES) {
    if (candidates.some((c) => re.test(c))) out = !negate;
  }
  return out;
}

const PERSONAL = [
  'loop-data/cache/plan.json', 'loop-data/extract/weight.csv', 'loop-data/files/import/export.xml', 'loop-data/profile/onboarding.json',
  'backups/profile/about-me.md.old.bak', 'knowledge/cycling/video.md', 'local/program-sync.mjs', 'CLAUDE.local.md',
  'profile/about-me.md', 'profile/baseline.md', 'profile/coaches.md', 'profile/profile.json',
  'data/nutrition/plan-data.json', 'data/nutrition/plan-tables.md', 'data/nutrition/food-log.md', 'data/nutrition/foodlog-daily.csv',
  'data/nutrition/artifact.local.md', 'data/apple-health/export.xml', 'data/apple-health/extract/weight.csv', 'data/apple-health/extract/_meta.json',
  'data/apple-health/apple_health_export/export.xml', 'data/profile/settings.json', 'data/profile/onboarding.json', 'data/profile/avatar.jpg',
  'data/training/training-data.json', 'data/training/program.pdf', 'data/gear/manual.pdf', 'data/clinical/blood.pdf',
  'data/nutritionist/report.pdf', 'data/weight/weight-log.md', 'exportar.zip',
  '.env', 'services/loop-ingest/.env', 'services/loop-web/.env', 'docker/.env', 'docker/files/import/export.zip',
  'analysis/reports/2026-10-16.md', 'web/dist/personal/index.html', 'web/test/.golden/bake-golden.personal.json',
  'services/loop-web/site/index.html', 'services/loop-web/.refresh-state', 'services/loop-ingest/trigger/refresh',
  'odd/tasks/server-images.md', 'node_modules/astro/package.json', 'services/loop-ingest/node_modules/pg/package.json',
  'web/node_modules/.vite/x.js', '.astro/content.d.ts', 'web/.astro/types.d.ts',
];
const NEEDED = [
  'package.json', 'package-lock.json', 'lib/paths.mjs', 'lib/load/inputs.mjs', 'web/astro.config.mjs', 'web/pages/index.astro',
  'web/layouts/Plan.astro', 'web/src/env.mjs', 'web/src/fonts/Inter.woff2', 'scripts/refresh.mjs', 'scripts/build-web.mjs',
  'scripts/sync-all.mjs', 'scripts/lib/is-main.mjs', 'data/nutrition/generate.mjs', 'data/nutrition/ingredients.json',
  'data/nutrition/plan-data.example.json', 'data/training/training-data.example.json', 'data/apple-health/sync-shortcut.mjs',
  'data/profile/sync-profile.mjs', 'services/loop-ingest/package.json', 'services/loop-ingest/package-lock.json',
  'services/loop-ingest/src/server.js', 'services/loop-ingest/sql/012_documents.sql',
  'services/loop-web/nginx.conf.template', 'services/loop-web/hosts.sh',
];

test('.dockerignore starts by denying everything', () => {
  assert.equal(RULES[0].negate, false);
  assert.equal(RULES[0].re.source, '^[^/]*$');
});

test('.dockerignore keeps every personal path, secret, built page and dependency folder out of the build context', () => {
  for (const p of PERSONAL) assert.ok(excluded(p), p);
});

test('.dockerignore lets in the code and tracked seeds the loop-server image needs, but never their tests', () => {
  for (const p of NEEDED) assert.ok(!excluded(p), p);
  for (const p of ['scripts/refresh.test.mjs', 'lib/load/inputs.test.mjs', 'web/src/csp.test.mjs', 'services/loop-ingest/test/builder.test.js',
    'services/loop-ingest/src/x.test.js', 'web/test/content.test.mjs', 'docs/development.md', 'README.md', 'CHANGELOG.md']) {
    assert.ok(excluded(p), p);
  }
});

test('every tracked file the image would get is code or a tracked seed (no data/** file but the seeds)', () => {
  const tracked = fs.readdirSync(path.join(ROOT, 'data'), { recursive: true }).map((f) => `data/${String(f).split(path.sep).join('/')}`);
  const inData = tracked.filter((p) => fs.statSync(path.join(ROOT, p)).isFile() && !excluded(p));
  for (const p of inData) assert.match(p, /\.mjs$|^data\/nutrition\/ingredients\.json$|\.example\.json$/, p);
});

test('.dockerignore lets in exactly the nginx template and hosts.sh from services/loop-web (the loop-web image), nothing else there', () => {
  const dir = path.join(ROOT, 'services', 'loop-web');
  const files = fs.readdirSync(dir, { recursive: true }).map((f) => `services/loop-web/${String(f).split(path.sep).join('/')}`)
    .filter((p) => fs.statSync(path.join(ROOT, p)).isFile());
  assert.deepEqual(files.filter((p) => !excluded(p)).sort(), ['services/loop-web/hosts.sh', 'services/loop-web/nginx.conf.template']);
  for (const p of ['services/loop-web/.env', 'services/loop-web/site/status.json', 'services/loop-web/site/manuales/x.pdf',
    'services/loop-web/refresh.sh', 'services/loop-web/docker-compose.yml', 'services/loop-web/systemd/loop-web-refresh.service']) {
    assert.ok(excluded(p), p);
  }
});
