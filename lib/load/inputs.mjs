/* loadInputs({repoRoot, dataMode}) — the single file-loading entry point for
 * the Astro build (astro-plan-web migration, slice 2). New code: the legacy
 * generators each have their own bespoke, hardcoded-path loading (kept as-is
 * to avoid disturbing their existing error-message tests); this is the
 * shared loader the design's Data Flow diagram puts before the pure lib/*
 * transforms.
 *
 * ingredients.json is always the public DB regardless of data mode. plan/
 * training come from the personal (gitignored) files in personal mode, or
 * the tracked .example seeds in example mode. extractDir resolves to the
 * real Apple Health extract directory in personal mode and to the tracked
 * synthetic data/demo/extract in example mode, only if it exists on disk —
 * otherwise null, so downstream lib/health code degrades to its empty-state
 * shape exactly like a fresh clone with no export.
 */
import fs from 'node:fs';
import path from 'node:path';

function readJson(p, hint) {
  if (!fs.existsSync(p)) {
    throw new Error(
      `loadInputs: ${p} not found.` +
      (hint ? ` ${hint}` : ''),
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadInputs({ repoRoot, dataMode }) {
  const mode = dataMode === 'example' ? 'example' : 'personal';
  const nutritionDir = path.join(repoRoot, 'data', 'nutrition');
  const trainingDir = path.join(repoRoot, 'data', 'training');

  const ingFile = readJson(
    path.join(nutritionDir, 'ingredients.json'),
    'It is the public food DB the plan depends on. A fresh clone ships it; do not delete it.',
  );
  if (!ingFile.ingredients || typeof ingFile.ingredients !== 'object') {
    throw new Error('loadInputs: ingredients.json must contain a top-level "ingredients" object.');
  }

  const planName = mode === 'example' ? 'plan-data.example.json' : 'plan-data.json';
  const plan = readJson(
    path.join(nutritionDir, planName),
    mode === 'personal'
      ? 'Copy plan-data.example.json -> plan-data.json and edit it, or build with DATA_MODE=example.'
      : undefined,
  );

  // training-data.json is OPTIONAL in personal mode (CLAUDE.md: "the Hoy tab
  // is optional and source-agnostic") — unlike plan-data.json, its absence
  // is not an error. Degrade to the same empty shape a real file with no
  // programmed sessions would have; Hoy/Entrenos already render that as a
  // rest/unprogrammed day (lib/training/program.mjs's trainingMeta(), the
  // client scripts), so nothing downstream needs a null-check. The example
  // seed is NOT optional — it ships tracked, so its absence is a real error.
  const trainingName = mode === 'example' ? 'training-data.example.json' : 'training-data.json';
  const trainingPath = path.join(trainingDir, trainingName);
  const training = (mode === 'personal' && !fs.existsSync(trainingPath))
    ? { days: {} }
    : readJson(trainingPath, mode === 'personal' ? 'Copy training-data.example.json -> training-data.json and edit it, or leave it absent (the Hoy/Entrenos tabs are optional).' : undefined);

  // personal -> the real (gitignored) Apple Health extract; example -> the tracked, clearly
  // synthetic demo extract (scripts/make-demo-data.mjs), so the example page shows every section.
  // Either way, a missing directory resolves to null (the empty-state shape of a fresh clone).
  const dir = mode === 'personal'
    ? path.join(repoRoot, 'data', 'apple-health', 'extract')
    : path.join(repoRoot, 'data', 'demo', 'extract');
  const extractDir = fs.existsSync(dir) ? dir : null;

  return { ingredients: ingFile.ingredients, plan, training, extractDir };
}
