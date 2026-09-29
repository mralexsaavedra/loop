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
 * real Apple Health extract directory only in personal mode, and only if it
 * exists on disk — otherwise null, so downstream lib/health code degrades to
 * its empty-state shape exactly like a fresh clone with no export.
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

  const trainingName = mode === 'example' ? 'training-data.example.json' : 'training-data.json';
  const training = readJson(
    path.join(trainingDir, trainingName),
    mode === 'personal'
      ? 'Copy training-data.example.json -> training-data.json and edit it, or build with DATA_MODE=example.'
      : undefined,
  );

  let extractDir = null;
  if (mode === 'personal') {
    const dir = path.join(repoRoot, 'data', 'apple-health', 'extract');
    if (fs.existsSync(dir)) extractDir = dir;
  }

  return { ingredients: ingFile.ingredients, plan, training, extractDir };
}
