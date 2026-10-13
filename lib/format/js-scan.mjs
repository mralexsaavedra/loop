/* A small, string-aware JavaScript lexer for STATIC SCANS (build and test time only): it tells code from
 * comments and literals so a regex over the result only sees code. Not a parser; the output is for
 * matching, never for running.
 *
 *   stripComments(src)           comments → one space (their newlines kept); strings, templates and
 *                                regex literals untouched
 *   stripCommentsAndStrings(src) also empties every literal: 'abc' → '', "abc" → "", /abc/g → / /g, and a
 *                                template keeps only its `${…}` expressions (which are code, scanned as such)
 *
 * Users: lib/format/numbers.mjs classicGlobal (which renamed constants a function body references) and
 * the web/src/client registerView static scan.
 *
 * Regex literals use the usual heuristic: a `/` starts a regex when the previous token cannot end an
 * expression (start of input, an operator or punctuator other than `)` `]` `}`, or a keyword such as
 * `return` / `typeof`); after an identifier, a number, `)`, `]`, `}` or a literal it is a division.
 * Known limits (none occur in this repo's sources): `if (x) /re/.test(y)` and `x++ / 2` are misread. */

const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const IDENT = /[\w$]/;

function scan(src, blank) {
  let out = '';
  let i = 0;
  let prev = ''; // the last significant code character ('' at the start)
  let word = ''; // the identifier / keyword / number that ends at prev, if any
  let gap = false; // whitespace since prev (so `return x` is two words)
  const templates = []; // one open-brace counter per `${` we are inside

  // template text from i (just after '`' or the `}` closing a `${…}`): to the closing '`' or the next `${`
  function templateText() {
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { out += (blank ? '' : src.slice(start, i)) + '`'; i++; prev = '`'; word = ''; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += (blank ? '' : src.slice(start, i)) + '${';
        i += 2;
        templates.push(0);
        prev = '{'; word = '';
        return;
      }
      i++;
    }
    out += blank ? '' : src.slice(start); // unterminated: the rest is template text
  }

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { // line comment: up to (not including) the newline
      const e = src.indexOf('\n', i);
      out += ' ';
      i = e < 0 ? src.length : e;
      gap = true;
      continue;
    }
    if (c === '/' && d === '*') { // block comment: a token separator, keeping its line breaks
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      out += ' ' + src.slice(i, end).replace(/[^\n]/g, '');
      i = end;
      gap = true;
      continue;
    }
    if (c === '\'' || c === '"') { // string: to the matching quote (or the line end if unterminated)
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const end = Math.min(j, src.length);
      out += c + (blank ? '' : src.slice(i + 1, end)) + (src[end] === c ? c : '');
      i = src[end] === c ? end + 1 : end;
      prev = c; word = '';
      continue;
    }
    if (c === '`') {
      out += '`';
      i++;
      templateText();
      continue;
    }
    if (c === '/' && (prev === '' || REGEX_AFTER.has(prev) || (word && REGEX_KEYWORDS.has(word)))) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      if (src[j] === '/') { // a regex literal (and its flags)
        let k = j + 1;
        while (k < src.length && /[a-z]/i.test(src[k])) k++;
        out += blank ? '/ /' + src.slice(j + 1, k) : src.slice(i, k);
        i = k;
        prev = ')'; word = ''; // a regex ends an expression: a following `/` divides
        continue;
      }
      // no closing slash on this line: not a regex after all, fall through as an operator
    }
    if (templates.length) {
      if (c === '{') templates[templates.length - 1]++;
      else if (c === '}') {
        if (templates[templates.length - 1] === 0) { // closes `${…}`: back to template text
          templates.pop();
          out += '}';
          i++;
          templateText();
          continue;
        }
        templates[templates.length - 1]--;
      }
    }
    out += c;
    i++;
    if (/\s/.test(c)) { gap = true; continue; }
    word = IDENT.test(c) ? (IDENT.test(prev) && !gap ? word : '') + c : '';
    prev = c;
    gap = false;
  }
  return out;
}

/** `src` with every comment replaced by one space (line breaks kept); literals untouched. */
export function stripComments(src) {
  return scan(String(src), false);
}

/** `src` with comments removed and every string, template text and regex literal emptied: only code is left. */
export function stripCommentsAndStrings(src) {
  return scan(String(src), true);
}
