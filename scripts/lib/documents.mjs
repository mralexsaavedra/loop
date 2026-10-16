/* The owner's documents shared by `npm run sync` (scripts/sync-documents.mjs, database -> files) and the coach's
 * `npm run documents` (scripts/documents.mjs, files -> database): which file each document becomes, the full
 * validation a document passes before it is pushed, and the sync state that tells a hand edit not pushed yet
 * from a file that only lags behind the database.
 *
 * Where the files live: lib/paths.mjs dataPaths (documentLayout below): today the clone files DOCUMENT_FILES /
 * STATE_FILE name, under HC_DATA_DIR <data root>/cache/{profile,plan,training}.json + cache/.sync-state.json.
 *
 * State (data/profile/documents-sync.json, gitignored): per kind, the revision and the content hash of the
 * document as last synced or pushed. A file whose hash is the recorded one has no local edits, so the database
 * may replace it; any other file is a local edit (or a file from before the documents existed) and is never
 * overwritten silently.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateNutrition } from '../../lib/nutrition/macros.mjs';
import { validateProgram } from '../../lib/training/program.mjs';
import { validateManual } from '../../lib/profile/profile.mjs';
import { validateDocument } from '../../services/loop-ingest/src/documents.js';
import { writeAtomic } from '../../data/apple-health/sync-common.mjs';
import { dataPaths, displayPath } from '../../lib/paths.mjs';

/** kind -> the clone file it becomes without HC_DATA_DIR (the legacy layout), in sync order (profile first:
 * sync-strava reads its maxHr). */
export const DOCUMENT_FILES = Object.freeze({
  profile: 'profile/profile.json',
  plan: 'data/nutrition/plan-data.json',
  training: 'data/training/training-data.json',
});
export const KINDS = Object.freeze(Object.keys(DOCUMENT_FILES));
export const STATE_FILE = 'data/profile/documents-sync.json';

/** The content hash of a parsed document: formatting never counts, key order and values do. */
export function contentHash(doc) {
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

/**
 * Where the documents of the clone at `root` live for `env` (lib/paths.mjs): file(kind) / state absolute,
 * rel(kind) for messages (repo-relative inside the clone, absolute outside it), backup(kind) the
 * backups/<same path>.documents.bak copy in the clone (the path relative to the data root when the file is
 * outside the clone). Every function below takes this layout.
 */
export function documentLayout(root, env = process.env) {
  const p = dataPaths({ repoRoot: root, env });
  const file = (kind) => p.documents[kind];
  const inClone = (f) => displayPath(root, f) !== f;
  return {
    root,
    file,
    rel: (kind) => displayPath(root, file(kind)),
    state: p.documentsState,
    backup: (kind) => path.join(root, 'backups', `${path.relative(inClone(file(kind)) ? root : p.root, file(kind))}.documents.bak`),
  };
}

/** {kind: {revision, hash}} from the state file; {} when it is missing or unreadable. */
export function readState(docs) {
  try {
    const s = JSON.parse(fs.readFileSync(docs.state, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

/** Records `kind` at {revision, hash}, keeping the other kinds. */
export function recordState(docs, kind, revision, hash) {
  const file = docs.state;
  const state = { ...readState(docs), [kind]: { revision, hash } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(state, null, 2) + '\n');
}

/** The parsed file of `kind`: {doc, hash}, null when the file does not exist; throws on invalid JSON. */
export function readDocumentFile(docs, kind) {
  const file = docs.file(kind);
  if (!fs.existsSync(file)) return null;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${docs.rel(kind)} is not valid JSON (${err.message})`, { cause: err });
  }
  return { doc, hash: contentHash(doc) };
}

/** Writes `doc` to the file of `kind` (2-space JSON, its key order), atomically. */
export function writeDocumentFile(docs, kind, doc) {
  const file = docs.file(kind);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
}

/** Copies the file of `kind` to backups/<same path>.documents.bak (the newest one only), before it is replaced. */
export function backupDocumentFile(docs, kind) {
  const target = docs.backup(kind);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(docs.file(kind), target);
  return path.relative(docs.root, target);
}

/**
 * The problems that keep `doc` out of the database (empty list = valid): the service's structural check plus
 * the full rules the build applies (validateNutrition with this clone's ingredients.json, validateProgram,
 * validateManual).
 */
export function documentProblems(root, kind, doc) {
  const field = validateDocument(kind, doc);
  if (field) return [field === 'document' ? 'the document must be a JSON object' : `"${field}" must be an object`];
  try {
    if (kind === 'plan') {
      const file = JSON.parse(fs.readFileSync(path.join(root, 'data', 'nutrition', 'ingredients.json'), 'utf8'));
      validateNutrition(file.ingredients, doc);
    } else if (kind === 'training') {
      validateProgram(doc);
    } else {
      return validateManual(doc);
    }
  } catch (err) {
    return [err.message];
  }
  return [];
}
