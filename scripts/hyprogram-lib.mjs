// Pure helpers for the Hyprogram sync (scripts/sync-hyprogram.mjs).
//
// No I/O, no network: everything here is unit-tested in hyprogram-lib.test.mjs.
// The runner owns login, fetch, and the filesystem; this module owns parsing,
// the ProseMirror -> Markdown rendering, PII stripping, date/week math, the
// fetch-plan selection and the manifest merge.

export const PROGRAM_ID = 'hp-hybrid';
export const DEFAULT_LOCALE = 'es-ES';
// Stop walking back once this many consecutive out-of-window days are seen (the
// athlete access window is a contiguous recent block, so older dates all 403).
export const STOP_AFTER_FORBIDDEN = 4;

// --- CLI --------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { dryRun: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit expects a positive integer');
      out.limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit expects a positive integer');
      out.limit = n;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

// --- env --------------------------------------------------------------------

// Parse KEY=VALUE lines. Returns only the two keys we use; never logs.
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

// --- dates ------------------------------------------------------------------

export function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ISO-8601 week label, e.g. "2026-W40". Week 1 is the week with the first
// Thursday of the year; weeks start on Monday.
export function isoWeek(isoDate) {
  if (!isValidIsoDate(isoDate)) throw new Error(`invalid date: ${isoDate}`);
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const year = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekFileName(isoDate) {
  return `${isoWeek(isoDate)}.md`;
}

// --- fetch plan -------------------------------------------------------------

// Which dates to request, newest first, skipping ones already saved. The runner
// requests them in order and stops early after a run of out-of-window (403)
// days, since access is a contiguous recent window.
export function selectDates(importantDays, savedDates = [], { limit = Infinity } = {}) {
  const saved = new Set(savedDates);
  const valid = [...new Set(importantDays.filter(isValidIsoDate))].sort().reverse();
  const out = [];
  for (const d of valid) {
    if (saved.has(d)) continue;
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

// --- PII --------------------------------------------------------------------

// Remove per-user data before persisting the workout JSON. The program content
// itself (sections, wod, coachNotes, title) is the thing we want; anything that
// identifies the owner (assigned users, personal video URLs) is dropped.
export function sanitizeDay(day) {
  const clone = JSON.parse(JSON.stringify(day));
  delete clone.users;
  delete clone.userId;
  delete clone.user;
  delete clone.assignedTo;
  if (Array.isArray(clone.videos)) {
    clone.videos = clone.videos.filter((v) => v && typeof v === 'object' && !hasPersonalId(v));
  }
  return clone;
}

function hasPersonalId(obj) {
  // Drop video entries whose URL embeds a user id folder (…/users-…/<uuid>/…).
  const s = JSON.stringify(obj);
  return /users?-[a-z-]*\/[0-9a-f]{8}-[0-9a-f]{4}/i.test(s);
}

// --- ProseMirror -> Markdown ------------------------------------------------

function applyMarks(text, marks = []) {
  let t = text;
  const has = (type) => marks.some((m) => m.type === type);
  if (has('code')) t = '`' + t + '`';
  if (has('bold') || has('strong')) t = `**${t}**`;
  if (has('italic') || has('em')) t = `*${t}*`;
  if (has('strike')) t = `~~${t}~~`;
  const link = marks.find((m) => m.type === 'link');
  if (link && link.attrs && link.attrs.href) t = `[${t}](${link.attrs.href})`;
  return t;
}

function inlineText(node) {
  if (!node) return '';
  if (node.type === 'text') return applyMarks(node.text ?? '', node.marks);
  if (node.type === 'hardBreak') return '  \n';
  if (Array.isArray(node.content)) return node.content.map(inlineText).join('');
  return '';
}

function renderBlocks(nodes, { indent = '' } = {}) {
  const out = [];
  for (const node of nodes || []) {
    out.push(renderBlock(node, { indent }));
  }
  // Collapse runs so an empty paragraph becomes a single blank line.
  return out;
}

function renderBlock(node, { indent = '' } = {}) {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph': {
      const t = (node.content || []).map(inlineText).join('').trimEnd();
      return indent + t;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level || 2));
      const t = (node.content || []).map(inlineText).join('').trim();
      return `${'#'.repeat(level)} ${t}`;
    }
    case 'bulletList':
      return (node.content || [])
        .map((li) => renderListItem(li, { indent, bullet: '-' }))
        .join('\n');
    case 'orderedList': {
      const start = node.attrs?.start || 1;
      return (node.content || [])
        .map((li, i) => renderListItem(li, { indent, bullet: `${start + i}.` }))
        .join('\n');
    }
    case 'listItem':
      return renderListItem(node, { indent, bullet: '-' });
    case 'blockquote':
      return renderBlocks(node.content, { indent })
        .join('\n')
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'codeBlock':
      return '```\n' + (node.content || []).map(inlineText).join('') + '\n```';
    case 'table':
      return renderTable(node);
    default:
      // Unknown block: render its children, or its inline text.
      if (Array.isArray(node.content)) {
        const inline = node.content.every((c) => c.type === 'text' || c.type === 'hardBreak');
        if (inline) return indent + node.content.map(inlineText).join('');
        return renderBlocks(node.content, { indent }).join('\n');
      }
      return '';
  }
}

function renderListItem(li, { indent, bullet }) {
  const inner = renderBlocks(li.content, { indent: indent + '  ' });
  // First block sits on the bullet line; nested blocks indent under it.
  const lines = [];
  let first = true;
  for (const block of inner) {
    if (block === '') continue;
    if (first) {
      lines.push(`${indent}${bullet} ${block.trimStart()}`);
      first = false;
    } else {
      lines.push(block);
    }
  }
  if (first) lines.push(`${indent}${bullet}`);
  return lines.join('\n');
}

function renderTable(node) {
  const rows = (node.content || []).filter((r) => r.type === 'tableRow');
  if (!rows.length) return '';
  const cellText = (cell) => (cell.content || []).map((b) => (b.content || []).map(inlineText).join('')).join(' ').trim();
  const grid = rows.map((r) => (r.content || []).map(cellText));
  const cols = Math.max(...grid.map((r) => r.length));
  const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |';
  const out = [line(grid[0]), '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'];
  for (const r of grid.slice(1)) out.push(line(r));
  return out.join('\n');
}

// Render a ProseMirror/TipTap doc to Markdown. Empty paragraphs are preserved
// as blank lines; consecutive blanks are collapsed.
export function pmToMarkdown(doc) {
  if (!doc || !Array.isArray(doc.content)) return '';
  const blocks = renderBlocks(doc.content, {});
  const text = blocks.join('\n\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// --- day -> markdown --------------------------------------------------------

function pickLocale(obj, locale) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[locale] != null) return obj[locale];
  if (obj[DEFAULT_LOCALE] != null) return obj[DEFAULT_LOCALE];
  const first = Object.keys(obj)[0];
  return first ? obj[first] : undefined;
}

// Render one workout day as a Markdown block (no top-level file header; the
// week file groups several of these).
export function renderDayMarkdown(day, { locale = DEFAULT_LOCALE } = {}) {
  const date = day.workoutDate || (day.id || '').replace(/^.*?(\d{4}-\d{2}-\d{2})$/, '$1');
  const title = (pickLocale(day.title, locale) || '').trim();
  const lines = [];
  lines.push(`## ${date}${title ? ` — ${title}` : ''}`);
  const sections = pickLocale(day.sections, locale) || [];
  const ordered = [...sections].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const s of ordered) {
    const head = [s.shortTitle, s.title].filter(Boolean).join(' · ').trim();
    lines.push('');
    lines.push(`### ${head || 'Sección'}`);
    const wod = pmToMarkdown(s.wod);
    if (wod) lines.push('', wod);
    const notes = pmToMarkdown(s.coachNotes);
    if (notes) lines.push('', '**Notas del coach:**', '', notes);
  }
  const dayNotes = pmToMarkdown(pickLocale(day.coachNotes, locale));
  if (dayNotes) lines.push('', '**Notas del día:**', '', dayNotes);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// Build the full Markdown for a week file from its day entries.
export function renderWeekFile(week, days, { locale = DEFAULT_LOCALE, fetchedAt } = {}) {
  const sorted = [...days].sort((a, b) => (a.workoutDate || a.id).localeCompare(b.workoutDate || b.id));
  const header = [
    `# Hyprogram HP Hybrid — semana ISO ${week}`,
    '',
    'Programa HP Hybrid (Hyprogram), el entrenamiento actual del propietario. Transcripción',
    `fiel del contenido publicado para su cuenta; uso personal. Sincronizado: ${fetchedAt || ''}`.trimEnd() + '.',
    '',
    '',
  ];
  const body = sorted.map((d) => renderDayMarkdown(d, { locale })).join('\n');
  return header.join('\n') + body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// --- manifest ---------------------------------------------------------------

// Merge new per-date entries into the manifest, keeping prior entries for dates
// not touched this run. Returns a new object sorted by date.
export function mergeManifest(prev, entries) {
  const base = prev && typeof prev === 'object' ? prev : {};
  const days = { ...(base.days || {}) };
  for (const e of entries) {
    if (!e || !e.date) continue;
    days[e.date] = { ...days[e.date], ...e };
  }
  const sorted = {};
  for (const k of Object.keys(days).sort()) sorted[k] = days[k];
  return { program: PROGRAM_ID, days: sorted };
}

export function savedDates(manifest) {
  if (!manifest || !manifest.days) return [];
  return Object.entries(manifest.days)
    .filter(([, v]) => v && v.status === 'ok')
    .map(([k]) => k);
}

// Group day objects by ISO week label. Returns a Map<week, day[]>.
export function groupByWeek(days) {
  const map = new Map();
  for (const d of days) {
    const date = d.workoutDate || d.id;
    const wk = isoWeek(date);
    if (!map.has(wk)) map.set(wk, []);
    map.get(wk).push(d);
  }
  return map;
}
