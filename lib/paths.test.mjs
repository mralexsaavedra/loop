/* lib/paths.mjs — where every personal / generated data file lives: the data-root layout under HC_DATA_DIR or
 * <repo>/loop-data, and the legacy table the migration reads. Both are pinned path by path: a change here moves
 * real files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DATA_DIR_ENV, DEFAULT_DATA_DIR, FILES_DIR_ENV, dataPaths, displayPath, legacyPaths } from './paths.mjs';
import { ONBOARDING_JSON } from './profile/onboarding.mjs';
import { FOODLOG_FILE } from './nutrition/score.mjs';
import { JOURNAL_FILE } from './journal/bake.mjs';

const REPO = path.join(path.sep, 'repo');
const r = (...p) => path.join(REPO, ...p);

test('the env var names', () => {
  assert.equal(DATA_DIR_ENV, 'HC_DATA_DIR');
  assert.equal(FILES_DIR_ENV, 'HC_FILES_DIR');
  assert.equal(DEFAULT_DATA_DIR, 'loop-data');
});

test('legacyPaths: exactly the pre-data-root paths inside the clone (what the migration moves)', () => {
  assert.deepEqual(legacyPaths({ repoRoot: REPO }), {
    layout: 'legacy',
    root: REPO,
    extractDir: r('data', 'apple-health', 'extract'),
    extractMeta: r('data', 'apple-health', 'extract', '_meta.json'),
    shortcutCache: r('data', 'apple-health', 'extract', '.shortcut-cache.json'),
    journalCsv: r('data', 'apple-health', 'extract', 'journal-daily.csv'),
    journalMeta: r('data', 'apple-health', 'extract', 'journal-daily.meta.json'),
    exportXml: r('data', 'apple-health', 'export.xml'),
    foodlogDir: r('data', 'nutrition'),
    foodlogCsv: r('data', 'nutrition', 'foodlog-daily.csv'),
    foodlogMeta: r('data', 'nutrition', 'foodlog-daily.meta.json'),
    profileDir: r('data', 'profile'),
    settings: r('data', 'profile', 'settings.json'),
    onboarding: r('data', 'profile', 'onboarding.json'),
    stravaProfile: r('data', 'profile', 'strava-profile.json'),
    avatar: r('data', 'profile', 'avatar.jpg'),
    documents: {
      profile: r('profile', 'profile.json'),
      plan: r('data', 'nutrition', 'plan-data.json'),
      training: r('data', 'training', 'training-data.json'),
    },
    documentsState: r('data', 'profile', 'documents-sync.json'),
    filesDir: null,
    importDir: r('data', 'apple-health'),
    manualsDir: r('data', 'gear'),
    documentsDir: null,
  });
});

test('no HC_DATA_DIR (unset, empty or blank): the data-root layout under <repo>/loop-data', () => {
  const def = dataPaths({ repoRoot: REPO, env: {} });
  assert.deepEqual(def, dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: r('loop-data') } }));
  assert.equal(def.layout, 'data-root');
  assert.equal(def.root, r('loop-data'));
  assert.equal(def.extractDir, r('loop-data', 'extract'));
  assert.equal(def.documents.plan, r('loop-data', 'cache', 'plan.json'));
  assert.equal(def.manualsDir, r('loop-data', 'files', 'manuals'));
  assert.deepEqual(dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: '' } }), def);
  assert.deepEqual(dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: '  ' } }), def);
});

test('HC_FILES_DIR alone moves only the files folder of the default data root', () => {
  const p = dataPaths({ repoRoot: REPO, env: { HC_FILES_DIR: '/owner-files' } });
  assert.equal(p.root, r('loop-data'));
  assert.equal(p.filesDir, path.resolve('/owner-files'));
  assert.equal(p.manualsDir, path.resolve('/owner-files/manuals'));
});

test('HC_DATA_DIR: the data-root layout under it', () => {
  const D = path.join(path.sep, 'srv', 'loop-data');
  const d = (...p) => path.join(D, ...p);
  assert.deepEqual(dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: D } }), {
    layout: 'data-root',
    root: D,
    extractDir: d('extract'),
    extractMeta: d('extract', '_meta.json'),
    shortcutCache: d('extract', '.shortcut-cache.json'),
    journalCsv: d('extract', 'journal-daily.csv'),
    journalMeta: d('extract', 'journal-daily.meta.json'),
    exportXml: d('files', 'import', 'export.xml'),
    foodlogDir: d('foodlog'),
    foodlogCsv: d('foodlog', 'foodlog-daily.csv'),
    foodlogMeta: d('foodlog', 'foodlog-daily.meta.json'),
    profileDir: d('profile'),
    settings: d('profile', 'settings.json'),
    onboarding: d('profile', 'onboarding.json'),
    stravaProfile: d('profile', 'strava-profile.json'),
    avatar: d('profile', 'avatar.jpg'),
    documents: { profile: d('cache', 'profile.json'), plan: d('cache', 'plan.json'), training: d('cache', 'training.json') },
    documentsState: d('cache', '.sync-state.json'),
    filesDir: d('files'),
    importDir: d('files', 'import'),
    manualsDir: d('files', 'manuals'),
    documentsDir: d('files', 'documents'),
  });
});

test('HC_FILES_DIR moves only the owner files folder (import, manuals, documents)', () => {
  const p = dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: '/srv/loop-data', HC_FILES_DIR: '/mnt/owner' } });
  assert.equal(p.filesDir, path.resolve('/mnt/owner'));
  assert.equal(p.importDir, path.resolve('/mnt/owner/import'));
  assert.equal(p.exportXml, path.resolve('/mnt/owner/import/export.xml'));
  assert.equal(p.manualsDir, path.resolve('/mnt/owner/manuals'));
  assert.equal(p.documentsDir, path.resolve('/mnt/owner/documents'));
  assert.equal(p.extractDir, path.resolve('/srv/loop-data/extract'));
});

test('a relative HC_DATA_DIR / HC_FILES_DIR resolves against the repo root, never the working directory', () => {
  const p = dataPaths({ repoRoot: REPO, env: { HC_DATA_DIR: 'loop-data', HC_FILES_DIR: '../owner' } });
  assert.equal(p.root, r('loop-data'));
  assert.equal(p.filesDir, path.resolve(REPO, '..', 'owner'));
});

test('env defaults to process.env; a missing repoRoot throws', () => {
  const saved = process.env.HC_DATA_DIR;
  try {
    process.env.HC_DATA_DIR = '/from-process';
    assert.equal(dataPaths({ repoRoot: REPO }).root, path.resolve('/from-process'));
  } finally {
    if (saved === undefined) delete process.env.HC_DATA_DIR; else process.env.HC_DATA_DIR = saved;
  }
  assert.throws(() => dataPaths({ env: {} }), /repoRoot/);
  assert.throws(() => legacyPaths({}), /repoRoot/);
});

// the sync scripts' own names (data/, which lib tests never import) are pinned by their HC_DATA_DIR tests
test('the file names agree with the lib modules that read them', () => {
  for (const p of [dataPaths({ repoRoot: REPO, env: {} }), legacyPaths({ repoRoot: REPO })]) {
    assert.equal(path.basename(p.onboarding), ONBOARDING_JSON);
    assert.equal(path.basename(p.foodlogCsv), FOODLOG_FILE);
    assert.equal(path.basename(p.journalCsv), JOURNAL_FILE);
  }
});

test('displayPath: relative inside the repo, absolute outside it', () => {
  assert.equal(displayPath(REPO, r('data', 'profile', 'settings.json')), path.join('data', 'profile', 'settings.json'));
  assert.equal(displayPath(REPO, path.join(path.sep, 'srv', 'x.json')), path.join(path.sep, 'srv', 'x.json'));
  assert.equal(displayPath(REPO, path.join(path.sep, 'repo-other', 'x.json')), path.join(path.sep, 'repo-other', 'x.json'));
});
