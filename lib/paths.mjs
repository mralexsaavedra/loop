/* Where every personal and generated data file lives: the single source of those paths for the syncs, the page
 * build, the coach's document CLI and the manuals publisher. PURE path math (no fs: lib/fs-boundary.test.mjs).
 *
 *   dataPaths({ repoRoot, env = process.env }) -> absolute paths (the data-root layout below)
 *   legacyPaths({ repoRoot })                  -> the pre-data-root paths (only scripts/migrate-data-root.mjs
 *                                                 and the old-path warning read them)
 *
 * HC_DATA_DIR (DATA_DIR_ENV) picks the data root; unset (empty or blank) = <repoRoot>/loop-data (DEFAULT_DATA_DIR,
 * gitignored). A relative value resolves against repoRoot (never the working directory, so a build, a sync and a test
 * agree wherever they run).
 *
 *   the DATA-ROOT layout under the data root:
 *     extract/        the processed Apple Health extract (_meta.json, .shortcut-cache.json, journal-daily.csv + .meta.json)
 *     foodlog/        foodlog-daily.csv + foodlog-daily.meta.json
 *     profile/        settings.json, onboarding.json, strava-profile.json, avatar.jpg
 *     cache/          profile.json, plan.json, training.json: the copies of the database documents
 *                     (scripts/sync-documents.mjs) + .sync-state.json (their sync state)
 *     files/          the owner files folder; HC_FILES_DIR (FILES_DIR_ENV, relative = against repoRoot) replaces it
 *                     (a bind mount): import/ (Health export: export.xml), manuals/ (device manuals the page
 *                     links), documents/ (clinical, nutritionist, training PDFs, coach-only)
 *     import-state.json  the last Apple Health import (scripts/import-health.mjs: file, sha256, rows, lastError)
 *     import-work/    that import's temporary export.xml (on the data root: the files folder may be read-only)
 *
 *   the LEGACY layout (legacyPaths), the paths inside the clone before the data root (npm run migrate:data-root
 *   moves them):
 *     extractDir      data/apple-health/extract/          exportXml   data/apple-health/export.xml
 *     foodlogDir      data/nutrition/                     profileDir  data/profile/
 *     documents       profile/profile.json, data/nutrition/plan-data.json, data/training/training-data.json
 *     documentsState  data/profile/documents-sync.json    manualsDir  data/gear/
 *     filesDir, documentsDir  null (coach PDFs sat in data/training, data/nutritionist)
 *
 * Example mode never reads these: it keeps the tracked repo files (lib/load/inputs.mjs). The page output
 * (web/dist, services/loop-web/site) and the repo's backups/ stay in the clone. */
import path from 'node:path';

export const DATA_DIR_ENV = 'HC_DATA_DIR';
export const FILES_DIR_ENV = 'HC_FILES_DIR';
/** The data root when HC_DATA_DIR is unset, relative to the repo root (one line in .gitignore). */
export const DEFAULT_DATA_DIR = 'loop-data';

const setting = (env, name) => {
  const v = env && env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

function common({ root, extractDir, foodlogDir, profileDir, importDir }) {
  return {
    root,
    extractDir,
    extractMeta: path.join(extractDir, '_meta.json'),
    shortcutCache: path.join(extractDir, '.shortcut-cache.json'),
    journalCsv: path.join(extractDir, 'journal-daily.csv'),
    journalMeta: path.join(extractDir, 'journal-daily.meta.json'),
    exportXml: path.join(importDir, 'export.xml'),
    foodlogDir,
    foodlogCsv: path.join(foodlogDir, 'foodlog-daily.csv'),
    foodlogMeta: path.join(foodlogDir, 'foodlog-daily.meta.json'),
    profileDir,
    settings: path.join(profileDir, 'settings.json'),
    onboarding: path.join(profileDir, 'onboarding.json'),
    stravaProfile: path.join(profileDir, 'strava-profile.json'),
    avatar: path.join(profileDir, 'avatar.jpg'),
  };
}

/** The pre-data-root paths inside the clone at `repoRoot` (see the header); only the migration and the old-path
 * warning read them.
 * @param {{ repoRoot: string }} opts */
export function legacyPaths({ repoRoot }) {
  if (!repoRoot) throw new Error('legacyPaths: repoRoot is required');
  const r = (...p) => path.join(repoRoot, ...p);
  return {
    layout: 'legacy',
    ...common({ root: repoRoot, extractDir: r('data', 'apple-health', 'extract'), foodlogDir: r('data', 'nutrition'), profileDir: r('data', 'profile'), importDir: r('data', 'apple-health') }),
    documents: { profile: r('profile', 'profile.json'), plan: r('data', 'nutrition', 'plan-data.json'), training: r('data', 'training', 'training-data.json') },
    documentsState: r('data', 'profile', 'documents-sync.json'),
    filesDir: null,
    importDir: r('data', 'apple-health'),
    manualsDir: r('data', 'gear'),
    documentsDir: null,
  };
}

/** Every personal / generated data path for the clone at `repoRoot`: the data-root layout under HC_DATA_DIR, or
 * <repoRoot>/loop-data when it is unset (see the header).
 * @param {{ repoRoot: string, env?: Record<string, string | undefined> }} opts */
export function dataPaths({ repoRoot, env = process.env }) {
  if (!repoRoot) throw new Error('dataPaths: repoRoot is required');
  const root = path.resolve(repoRoot, setting(env, DATA_DIR_ENV) || DEFAULT_DATA_DIR);
  const filesSetting = setting(env, FILES_DIR_ENV);
  const filesDir = filesSetting ? path.resolve(repoRoot, filesSetting) : path.join(root, 'files');
  const importDir = path.join(filesDir, 'import');
  const cache = path.join(root, 'cache');
  return {
    layout: 'data-root',
    ...common({ root, extractDir: path.join(root, 'extract'), foodlogDir: path.join(root, 'foodlog'), profileDir: path.join(root, 'profile'), importDir }),
    documents: { profile: path.join(cache, 'profile.json'), plan: path.join(cache, 'plan.json'), training: path.join(cache, 'training.json') },
    documentsState: path.join(cache, '.sync-state.json'),
    filesDir,
    importDir,
    manualsDir: path.join(filesDir, 'manuals'),
    documentsDir: path.join(filesDir, 'documents'),
    importState: path.join(root, 'import-state.json'),
    importWorkDir: path.join(root, 'import-work'),
  };
}

/** A path for a message: relative to the repo when inside it (today's wording), absolute when outside. */
export function displayPath(repoRoot, file) {
  const rel = path.relative(repoRoot, file);
  return rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel) ? rel : file;
}
