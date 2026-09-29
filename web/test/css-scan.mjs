/* Minimal, dependency-free CSS block parser + normalizer for the CSS
 * parity test (css-parity.test.mjs). Not a full CSS parser — this
 * project's stylesheets never nest a rule more than one level deep (a
 * single, non-nested @media wrapping plain selector rules), so a
 * hand-rolled parser covers everything actually used here.
 */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeSelector(sel) {
  return sel
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/::/g, ':') // CSS2 (`:before`) and CSS3 (`::before`) pseudo-element syntax are equivalent
    .replace(/\s*,\s*/g, ', '); // `a,b` and `a,\n  b` are the same selector list
}

function normalizeMedia(media) {
  if (!media) return null;
  return media.replace(/\s+/g, '').toLowerCase();
}

// Cosmetic-only normalization: collapse whitespace, put exactly one space
// after each comma, one space before `!important`, canonicalize decimal
// numbers (`.14` → `0.14`, `0.10` → `0.1`) via parseFloat, lowercase. Two
// declarations that only differ by this kind of formatting are considered
// equivalent.
export function normalizeValue(value) {
  let v = value.replace(/\s+/g, ' ').trim();
  v = v.replace(/\s*,\s*/g, ', ');
  v = v.replace(/\s*!\s*important/gi, ' !important');
  v = v.replace(/-?(?:\d+\.\d+|\.\d+)/g, (n) => String(parseFloat(n)));
  return v.toLowerCase();
}

function parseDeclarations(block) {
  const decls = [];
  for (const raw of block.split(';')) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const idx = chunk.indexOf(':');
    if (idx === -1) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    const value = normalizeValue(chunk.slice(idx + 1));
    decls.push([prop, value]);
  }
  return decls;
}

function parseRuleBlocks(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].trim();
    if (!selector) continue;
    rules.push({ selector: normalizeSelector(selector), decls: parseDeclarations(m[2]) });
  }
  return rules;
}

/**
 * Parses CSS text into a flat list of `{ media, selector, decls }` entries.
 * `media` is the normalized @media condition text, or `null` for top-level
 * rules. `decls` is an array of `[prop, normalizedValue]` pairs. Handles a
 * single level of @media nesting (this project never nests further).
 */
export function parseCssRules(cssText) {
  const css = stripComments(cssText);
  const entries = [];
  const mediaRe = /@media([^{]*)\{/g;
  let m;
  const topLevelChunks = [];
  let lastIndex = 0;

  while ((m = mediaRe.exec(css))) {
    topLevelChunks.push(css.slice(lastIndex, m.index));
    let depth = 1;
    let i = mediaRe.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const inner = css.slice(mediaRe.lastIndex, i - 1);
    const media = normalizeMedia(m[1]);
    for (const rule of parseRuleBlocks(inner)) {
      entries.push({ media, selector: rule.selector, decls: rule.decls });
    }
    mediaRe.lastIndex = i;
    lastIndex = i;
  }
  topLevelChunks.push(css.slice(lastIndex));

  for (const chunk of topLevelChunks) {
    for (const rule of parseRuleBlocks(chunk)) {
      entries.push({ media: null, selector: rule.selector, decls: rule.decls });
    }
  }

  return entries;
}

/**
 * Flattens parsed rules into a Map keyed by `${media}|||${selector}|||${prop}`
 * → normalized value. A later occurrence of the same key overwrites an
 * earlier one (mirrors the CSS cascade for a repeated identical selector),
 * which is the right behavior for a "is this declaration present" check.
 */
export function ruleDeclarationMap(rules) {
  const map = new Map();
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) {
      map.set(`${rule.media || ''}|||${rule.selector}|||${prop}`, value);
    }
  }
  return map;
}
