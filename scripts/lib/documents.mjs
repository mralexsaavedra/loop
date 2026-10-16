/* The owner's documents shared by `npm run sync` (scripts/sync-documents.mjs, database -> files) and the coach's
 * `npm run documents` (scripts/documents.mjs, files -> database): which file each document becomes, the full
 * validation a document passes before it is pushed, and the sync state that tells a hand edit not pushed yet
 * from a file that only lags behind the database.
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

/** kind -> the clone file it becomes, in sync order (profile first: sync-strava reads its maxHr). */
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

/** {kind: {revision, hash}} from the state file; {} when it is missing or unreadable. */
export function readState(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

/** Records `kind` at {revision, hash}, keeping the other kinds. */
export function recordState(root, kind, revision, hash) {
  const file = path.join(root, STATE_FILE);
  const state = { ...readState(root), [kind]: { revision, hash } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(state, null, 2) + '\n');
}

/** The parsed file of `kind`: {doc, hash}, null when the file does not exist; throws on invalid JSON. */
export function readDocumentFile(root, kind) {
  const file = path.join(root, DOCUMENT_FILES[kind]);
  if (!fs.existsSync(file)) return null;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${DOCUMENT_FILES[kind]} is not valid JSON (${err.message})`, { cause: err });
  }
  return { doc, hash: contentHash(doc) };
}

/** Writes `doc` to the file of `kind` (2-space JSON, its key order), atomically. */
export function writeDocumentFile(root, kind, doc) {
  const file = path.join(root, DOCUMENT_FILES[kind]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
}

/** Copies the file of `kind` to backups/<same path>.documents.bak (the newest one only), before it is replaced. */
export function backupDocumentFile(root, kind) {
  const rel = DOCUMENT_FILES[kind];
  const target = path.join(root, 'backups', `${rel}.documents.bak`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, rel), target);
  return path.relative(root, target);
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
