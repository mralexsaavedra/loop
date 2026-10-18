/* Spanish user guides stay in step with the English ones (docs/README.md: the user guides only; the technical
 * docs stay English). Each English file in USER_GUIDES has a `<name>.es.md` sibling, and every pair has:
 *   - the language switch line at the very top (English `> **English** · [Español](<name>.es.md)`,
 *     Spanish `> [English](<name>.md) · **Español**`);
 *   - the same headings, same count, order and level (the text is translated);
 *   - the same fenced code blocks, byte-equal and in the same order (commands are never translated);
 *   - the same set of link targets once `.es.md` is read as `.md` (anchors into a translated page differ, so
 *     they are compared without the `#fragment`; every anchor is checked against its target page instead).
 * Every relative link of every file in the list must resolve: the file exists and its `#anchor` is a GitHub
 * heading slug of that file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES_DIR = 'docs/guides';

/** The English user guides that must have a Spanish sibling (repo-relative). */
export function userGuides(root = ROOT) {
  const guides = fs.readdirSync(path.join(root, GUIDES_DIR))
    .filter((f) => f.endsWith('.md') && !f.endsWith('.es.md'))
    .sort()
    .map((f) => `${GUIDES_DIR}/${f}`);
  return ['README.md', ...guides, 'docs/ios-shortcut.md', 'docs/onboarding.md'];
}

const esSibling = (file) => file.replace(/\.md$/, '.es.md');

/** Splits a Markdown text into its fenced code blocks (whole text, fences included) and the prose lines
 * outside them. A fence is ``` or ~~~ (3 or more), possibly indented inside a list item. */
export function parse(text) {
  const blocks = [];
  const prose = [];
  let open = null;
  for (const line of text.split('\n')) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      open.lines.push(line);
      if (fence && fence[1][0] === open.char && fence[1].length >= open.len && line.trim() === fence[1]) {
        blocks.push(open.lines.join('\n'));
        open = null;
      }
    } else if (fence) {
      open = { char: fence[1][0], len: fence[1].length, lines: [line] };
    } else {
      prose.push(line);
    }
  }
  if (open) blocks.push(open.lines.join('\n'));
  const headings = prose
    .map((l) => l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))
    .filter(Boolean)
    .map((m) => ({ level: m[1].length, text: m[2] }));
  const links = [];
  for (const line of prose) {
    const noCode = line.replace(/`[^`]*`/g, '');
    for (const m of noCode.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push(m[1]);
    for (const m of noCode.matchAll(/\b(?:src|href)="([^"]+)"/g)) links.push(m[1]);
  }
  return { blocks, headings, links };
}

/** GitHub's heading anchor: the text without Markdown, lower case, punctuation dropped, spaces → `-`. */
export function slug(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

function anchorsOf(text) {
  const seen = new Map();
  const out = new Set();
  for (const h of parse(text).headings) {
    const base = slug(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target);

/** Every problem with one English/Spanish pair, as readable lines (empty = in step). `enFile` is the English
 * file's repo-relative path, used to tell a link into a translated page from one into an English-only doc. */
export function comparePair(enText, esText, enFile, translated = new Set()) {
  const problems = [];
  const name = path.basename(enFile, '.md');
  const enFirst = enText.split('\n')[0];
  const esFirst = esText.split('\n')[0];
  const enSwitch = `> **English** · [Español](${name}.es.md)`;
  const esSwitch = `> [English](${name}.md) · **Español**`;
  if (enFirst !== enSwitch) problems.push(`English first line must be: ${enSwitch}`);
  if (esFirst !== esSwitch) problems.push(`Spanish first line must be: ${esSwitch}`);

  const en = parse(enText);
  const es = parse(esText);
  const levels = (p) => p.headings.map((h) => h.level).join(',');
  if (levels(en) !== levels(es)) {
    problems.push(`headings differ: English ${en.headings.length} [${levels(en)}], Spanish ${es.headings.length} [${levels(es)}]`);
  }
  if (en.blocks.length !== es.blocks.length) {
    problems.push(`code blocks differ: English ${en.blocks.length}, Spanish ${es.blocks.length}`);
  }
  for (let i = 0; i < Math.min(en.blocks.length, es.blocks.length); i++) {
    if (en.blocks[i] !== es.blocks[i]) problems.push(`code block ${i + 1} differs:\n${en.blocks[i]}\n---\n${es.blocks[i]}`);
  }

  const dir = path.posix.dirname(enFile);
  const norm = (target) => {
    const mapped = target.replace(/\.es\.md(?=$|#)/, '.md');
    if (isExternal(mapped)) return mapped;
    const [file, frag] = mapped.split('#');
    const resolved = path.posix.normalize(path.posix.join(dir, file));
    const intoTranslated = file === '' || translated.has(resolved);
    return intoTranslated || frag === undefined ? file : `${file}#${frag}`;
  };
  const enLinks = new Set(en.links.map(norm));
  const esLinks = new Set(es.links.map(norm));
  const onlyEn = [...enLinks].filter((l) => !esLinks.has(l));
  const onlyEs = [...esLinks].filter((l) => !enLinks.has(l));
  if (onlyEn.length) problems.push(`links only in English: ${onlyEn.join(', ')}`);
  if (onlyEs.length) problems.push(`links only in Spanish: ${onlyEs.join(', ')}`);
  // the Spanish page sends the reader to the Spanish sibling whenever there is one (the switch line excepted)
  const toEnglish = es.links.slice(1).filter((target) => {
    if (isExternal(target)) return false;
    const file = target.split('#')[0];
    return file !== '' && translated.has(path.posix.normalize(path.posix.join(dir, file)));
  });
  if (toEnglish.length) problems.push(`Spanish links to the English page of a translated guide: ${toEnglish.join(', ')}`);
  return problems;
}

/** Relative links of one file that do not resolve (missing file or anchor). */
export function brokenLinks(file, root = ROOT) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const broken = [];
  for (const target of parse(text).links) {
    if (isExternal(target)) continue;
    const [rel, frag] = target.split('#');
    const resolved = rel === '' ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
    const abs = path.join(root, resolved);
    if (!fs.existsSync(abs)) { broken.push(`${target} (no file ${resolved})`); continue; }
    if (frag && resolved.endsWith('.md') && !anchorsOf(fs.readFileSync(abs, 'utf8')).has(frag)) {
      broken.push(`${target} (no heading #${frag} in ${resolved})`);
    }
  }
  return broken;
}

test('every English user guide has its Spanish sibling', () => {
  const missing = userGuides().map(esSibling).filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, []);
});

test('each English / Spanish pair has the switch line, the same headings, code blocks and link targets', () => {
  const guides = userGuides();
  const translated = new Set(guides);
  const problems = [];
  for (const en of guides) {
    const es = esSibling(en);
    if (!fs.existsSync(path.join(ROOT, es))) continue; // reported by the sibling test
    const pair = comparePair(fs.readFileSync(path.join(ROOT, en), 'utf8'), fs.readFileSync(path.join(ROOT, es), 'utf8'), en, translated);
    problems.push(...pair.map((p) => `${en} ↔ ${es}: ${p}`));
  }
  assert.deepEqual(problems, []);
});

test('every relative link and anchor of the user guides resolves, in both languages', () => {
  const broken = [];
  for (const en of userGuides()) {
    for (const file of [en, esSibling(en)]) {
      if (fs.existsSync(path.join(ROOT, file))) broken.push(...brokenLinks(file).map((b) => `${file}: ${b}`));
    }
  }
  assert.deepEqual(broken, []);
});

// The checks themselves, on small in-memory pairs.
const EN = '> **English** · [Español](x.es.md)\n\n# Title\n\nSee [the other](y.md#a-b) and [ref](../ref.md#setup).\n\n```sh\nnpm test\n```\n\n## Next\n';
const ES = '> [English](x.md) · **Español**\n\n# Título\n\nVer [la otra](y.es.md#a-c) y [ref](../ref.md#setup).\n\n```sh\nnpm test\n```\n\n## Siguiente\n';
const TRANSLATED = new Set(['docs/x.md', 'docs/y.md']);

test('comparePair: a translated pair in step has no problems', () => {
  assert.deepEqual(comparePair(EN, ES, 'docs/x.md', TRANSLATED), []);
});

test('comparePair: a code block added to one side only is reported', () => {
  const problems = comparePair(EN, `${ES}\n\`\`\`sh\nnpm run sync\n\`\`\`\n`, 'docs/x.md', TRANSLATED);
  assert.ok(problems.some((p) => p.startsWith('code blocks differ')), problems.join('\n'));
});

test('comparePair: a code block whose content was changed (translated) is reported', () => {
  const problems = comparePair(EN, ES.replace('npm test', 'npm prueba'), 'docs/x.md', TRANSLATED);
  assert.ok(problems.some((p) => p.startsWith('code block 1 differs')), problems.join('\n'));
});

test('comparePair: a heading added to one side only, or at another level, is reported', () => {
  const added = comparePair(`${EN}\n## Extra\n`, ES, 'docs/x.md', TRANSLATED);
  assert.ok(added.some((p) => p.startsWith('headings differ')), added.join('\n'));
  const level = comparePair(EN, ES.replace('## Siguiente', '### Siguiente'), 'docs/x.md', TRANSLATED);
  assert.ok(level.some((p) => p.startsWith('headings differ')), level.join('\n'));
});

test('comparePair: a link on one side only, or an anchor changed into an English-only doc, is reported', () => {
  const extra = comparePair(EN, ES.replace('## Siguiente', '[z](z.md)\n\n## Siguiente'), 'docs/x.md', TRANSLATED);
  assert.ok(extra.some((p) => p.startsWith('links only in Spanish: z.md')), extra.join('\n'));
  const anchor = comparePair(EN, ES.replace('../ref.md#setup', '../ref.md#instalacion'), 'docs/x.md', TRANSLATED);
  assert.ok(anchor.some((p) => p.includes('../ref.md#setup')), anchor.join('\n'));
  const english = comparePair(EN, ES.replace('y.es.md#a-c', 'y.md#a-b'), 'docs/x.md', TRANSLATED);
  assert.ok(english.some((p) => p.startsWith('Spanish links to the English page')), english.join('\n'));
});

test('comparePair: a missing or wrong switch line is reported', () => {
  const problems = comparePair(EN.split('\n').slice(2).join('\n'), ES.replace('**Español**', 'Español'), 'docs/x.md', TRANSLATED);
  assert.equal(problems.filter((p) => p.includes('first line')).length, 2, problems.join('\n'));
});

test('slug: GitHub anchors (punctuation dropped, accents kept, code and links unwrapped)', () => {
  assert.equal(slug('Server — the page, the food log and the iPhone sync (Docker, no clone)'), 'server--the-page-the-food-log-and-the-iphone-sync-docker-no-clone');
  assert.equal(slug('Owner documents (`scripts/sync-documents.mjs`, first step of `npm run sync`)'), 'owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync');
  assert.equal(slug('Instalación del servidor'), 'instalación-del-servidor');
  assert.equal(slug('Your personal files move to `loop-data/`'), 'your-personal-files-move-to-loop-data');
});
