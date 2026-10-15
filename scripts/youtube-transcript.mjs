// Pure helpers for scripts/ingest-youtube.mjs: WebVTT -> clean timestamped
// paragraphs, file naming, subtitle-track choice and manifest merge. No I/O, so
// the test suite drives them with synthetic fixtures.

const TS_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{1,3})$/;
const ARROW = '-->';
const SENTENCE_END = /[.?!…]["')»]*$/;

/** Paragraph pacing: a break after a sentence end once SOFT_S have passed, a hard break at HARD_S. */
const PARAGRAPH_SOFT_S = 30;
const PARAGRAPH_HARD_S = 60;
/** How many recently emitted lines a rolling auto-caption cue is compared against. */
const RECENT_LINES = 2;

const VALID_TABS = ['videos', 'streams'];

function tsSeconds(ts) {
  const m = TS_RE.exec(ts.trim());
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  const millis = (Number(h || 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + Number(ms.padEnd(3, '0'));
  return millis / 1000;
}

/** Parse a WebVTT document into cues `{start (seconds), lines (raw text)}`. */
export function parseVtt(text) {
  // Line-based, not blank-line-based: YouTube cues can carry an empty first text
  // row, which would split a cue from its text.
  const rows = String(text).replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let cur = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.includes(ARROW)) {
      const start = tsSeconds(row.split(ARROW)[0]);
      cur = start === null ? null : { start, lines: [] };
      if (cur) cues.push(cur);
    } else if (rows[i + 1] !== undefined && rows[i + 1].includes(ARROW)) {
      continue; // a cue identifier
    } else if (cur && row.trim() !== '') {
      cur.lines.push(row);
    }
  }
  return cues;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function cleanLine(raw) {
  return raw
    .replace(/<[^>]*>/g, '') // <c>, <i>, inline <00:00:01.000> word timings
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\[[^\]]*\]/g, '') // [Música], [Aplausos]
    .replace(/^\s*>>\s*/, '') // speaker-change marker
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cues -> transcript lines `{start, text}`: tags stripped, entities decoded, sound
 * tags dropped, and the rolling-caption repeats of auto subtitles removed (each auto
 * cue restates the previous line before adding the new one).
 */
export function cleanCues(cues) {
  const out = [];
  const recent = [];
  for (const cue of cues) {
    const fresh = [];
    for (const raw of cue.lines) {
      const line = cleanLine(raw);
      if (!line || recent.includes(line) || fresh.includes(line)) continue;
      fresh.push(line);
    }
    if (!fresh.length) continue;
    out.push({ start: cue.start, text: fresh.join(' ') });
    recent.push(...fresh);
    recent.splice(0, Math.max(0, recent.length - RECENT_LINES));
  }
  return out;
}

/** Group lines into paragraphs of roughly 30-60 s, each keeping its first line's start. */
export function toParagraphs(lines, { soft = PARAGRAPH_SOFT_S, hard = PARAGRAPH_HARD_S } = {}) {
  const paras = [];
  let cur = null;
  const close = () => {
    if (cur) paras.push({ start: cur.start, text: cur.parts.join(' ') });
    cur = null;
  };
  for (const { start, text } of lines) {
    if (cur && start - cur.start >= hard) close();
    if (!cur) cur = { start, parts: [] };
    cur.parts.push(text);
    if (start - cur.start >= soft && SENTENCE_END.test(text)) close();
  }
  close();
  return paras;
}

const pad = (n) => String(n).padStart(2, '0');

/** Seconds -> "mm:ss", or "h:mm:ss" from one hour. */
export function fmtTs(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = pad(Math.floor((s % 3600) / 60));
  const ss = pad(s % 60);
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** yt-dlp's upload_date "YYYYMMDD" -> "YYYY-MM-DD", else null. */
export function isoDate(uploadDate) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(uploadDate ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "<YYYY-MM-DD>-<id>.md" ("undated-<id>.md" without a date); the id keeps only [A-Za-z0-9_-]. */
export function transcriptFileName(date, id) {
  return `${date || 'undated'}-${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.md`;
}

export function videoUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function timestampUrl(id, seconds) {
  return `${videoUrl(id)}&t=${Math.max(0, Math.floor(seconds))}s`;
}

const hasVtt = (formats, { original = false } = {}) =>
  Array.isArray(formats) &&
  formats.some((f) => f && f.ext === 'vtt' && !(original && /[?&]tlang=/.test(String(f.url || ''))));

/**
 * Choose the subtitle track from a yt-dlp info JSON: a manual track in `lang`
 * (exact key first, then a regional variant), else the ORIGINAL auto captions
 * (`<lang>-orig`, else `<lang>` when it is not a machine translation). Null = none.
 */
export function pickSubtitle(info, lang) {
  const manual = (info && info.subtitles) || {};
  const manualKeys = [lang, ...Object.keys(manual).filter((k) => k.startsWith(`${lang}-`)).sort()];
  for (const key of manualKeys) if (hasVtt(manual[key])) return { kind: 'manual', key };
  const auto = (info && info.automatic_captions) || {};
  if (hasVtt(auto[`${lang}-orig`])) return { kind: 'auto', key: `${lang}-orig` };
  if (hasVtt(auto[lang], { original: true })) return { kind: 'auto', key: lang };
  return null;
}

/** Return a new manifest with `videos[id] = entry`; `head` (source, channel) is (re)applied. */
export function mergeManifest(manifest, id, entry, head) {
  const base = manifest && typeof manifest === 'object' ? manifest : {};
  return { ...base, ...head, videos: { ...(base.videos || {}), [id]: entry } };
}

/** Listing entries not yet in the manifest, first occurrence only, at most `limit`. */
export function pendingIds(listing, manifest, limit = Infinity) {
  const done = new Set(Object.keys((manifest && manifest.videos) || {}));
  const out = [];
  for (const v of listing) {
    if (out.length >= limit) break;
    if (done.has(v.id)) continue;
    done.add(v.id);
    out.push(v);
  }
  return out;
}

/** Markdown transcript: header (title, url, date, duration, subtitle kind) then `[mm:ss]` paragraphs. */
export function renderTranscript({ id, title, date, duration, subs }, paragraphs) {
  const subsLine = subs === 'auto' ? 'auto (automatic captions: verify numbers in the video)' : subs;
  const lines = [
    `# ${title}`, '',
    `- URL: ${videoUrl(id)}`,
    `- Date: ${date || 'unknown'}`,
    `- Duration: ${Number.isFinite(duration) ? fmtTs(duration) : 'unknown'}`,
    `- Subtitles: ${subsLine}`,
    '',
  ];
  for (const p of paragraphs) lines.push(`[${fmtTs(p.start)}] ${p.text}`, '');
  return lines.join('\n');
}

export function wordCount(paragraphs) {
  return paragraphs.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
}

/** CLI flags of ingest-youtube.mjs. Throws with a usage-style message on bad input. */
export function parseArgs(argv) {
  const opts = { channel: null, out: null, tabs: [...VALID_TABS], limit: Infinity, lang: 'es' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const need = () => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      i++;
      return value;
    };
    switch (flag) {
      case '--channel': opts.channel = need().replace(/\/+$/, ''); break;
      case '--out': opts.out = need(); break;
      case '--tabs': {
        const tabs = need().split(',').map((t) => t.trim()).filter(Boolean);
        if (!tabs.length || tabs.some((t) => !VALID_TABS.includes(t))) {
          throw new Error(`--tabs must be a comma list of ${VALID_TABS.join(', ')}`);
        }
        opts.tabs = tabs;
        break;
      }
      case '--limit': {
        const n = Number(need());
        if (!Number.isInteger(n) || n < 1) throw new Error('--limit must be a positive integer');
        opts.limit = n;
        break;
      }
      case '--lang': {
        const lang = need();
        if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$/.test(lang)) throw new Error('--lang must be a language code like es');
        opts.lang = lang;
        break;
      }
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!opts.channel) throw new Error('--channel <url> is required');
  if (!opts.out) throw new Error('--out <dir> is required');
  return opts;
}
