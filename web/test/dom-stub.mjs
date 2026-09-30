/* Minimal DOM stub for running the classic (non-module) client scripts
 * (web/src/client/*.js) inside `node:vm`, without a real browser or a
 * jsdom dependency. Only implements the handful of DOM surface those
 * scripts actually call — see design's Testing Strategy: "run legacy IIFEs
 * and Astro scripts in vm with stub DOM (getElementById auto-elements with
 * innerHTML/value/textContent/addEventListener, createElement escaping,
 * querySelectorAll, fixed Date)".
 *
 * Usage:
 *   const doc = new StubDocument();
 *   const el = doc.el('t-dia', { classes: ['tabnav-btn'], attrs: { 'data-tab': 'dia' } });
 *   const ctx = vm.createContext({ document: doc, window: {}, setTimeout, console });
 *   vm.runInContext(source, ctx);
 */

function matchesSelector(el, sel) {
  sel = sel.trim();
  if (sel.startsWith('.')) return el.classes.has(sel.slice(1));
  if (sel.startsWith('#')) return el.attrs.id === sel.slice(1);
  const attrMatch = sel.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
  if (attrMatch) {
    const [, name, val] = attrMatch;
    if (!(name in el.attrs)) return false;
    return val === undefined ? true : el.attrs[name] === val;
  }
  // bare tag or compound selector (e.g. '.tab-panel[data-tab]') — split and AND together
  if (sel.includes('.') || sel.includes('[')) {
    const parts = sel.match(/\.[\w-]+|\[[^\]]+\]/g) || [];
    return parts.every((p) => matchesSelector(el, p));
  }
  return el.tag === sel;
}

/** Matches real DOM `div.textContent = s; div.innerHTML` serialization:
 * `&`, `<`, `>` are escaped; quotes are NOT (browsers only escape quotes
 * when serializing an ATTRIBUTE value, never inside a text node). This is
 * the browser behavior the legacy/Astro client scripts' `esc()` helper
 * relies on (`document.createElement('div'); d.textContent=s; return
 * d.innerHTML;`) — see web/src/client/training-today.js. */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class StubElement {
  constructor(tag, opts = {}) {
    this.tag = tag;
    this.attrs = { ...(opts.attrs || {}) };
    this.classes = new Set(opts.classes || []);
    this.dataset = {};
    for (const [k, v] of Object.entries(this.attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = v;
      }
    }
    this.hidden = !!opts.hidden;
    this.open = !!opts.open;
    this._text = '';
    this._html = '';
    // Independent accessors (not a shared backing field) so setting
    // innerHTML directly never retroactively populates textContent, and
    // vice versa — but setting textContent DOES recompute innerHTML's
    // escaped form, matching the browser's actual text-node serialization.
    // `configurable: true` lets a test override either property later
    // (used by the now-retired parity.test.mjs's runBuiltScripts() <select>
    // override during the astro-plan-web migration; kept for any future
    // test that needs the same escape hatch).
    Object.defineProperty(this, 'textContent', {
      configurable: true,
      enumerable: true,
      get: () => this._text,
      set: (v) => {
        this._text = v == null ? '' : String(v);
        this._html = escapeHtml(this._text);
      },
    });
    Object.defineProperty(this, 'innerHTML', {
      configurable: true,
      enumerable: true,
      get: () => this._html,
      set: (v) => { this._html = v == null ? '' : String(v); },
    });
    this.textContent = opts.textContent || '';
    this.style = {};
    this.parent = opts.parent || null;
    this._listeners = {};
    this._scrolledIntoView = false;
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      toggle: (c, force) => (force === undefined ? (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c)) : force ? this.classes.add(c) : this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
    };
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  addEventListener(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
  }
  dispatch(evt) {
    (this._listeners[evt] || []).forEach((fn) => fn.call(this));
  }
  /** Real-DOM alias of `parent`, so client code can walk ancestors the browser way. */
  removeAttribute(name) {
    delete this.attrs[name];
  }
  get parentElement() {
    return this.parent;
  }
  closest(sel) {
    let el = this;
    while (el) {
      if (matchesSelector(el, sel)) return el;
      el = el.parent;
    }
    return null;
  }
  scrollIntoView() {
    this._scrolledIntoView = true;
  }
}

export class StubDocument {
  constructor() {
    this.all = [];
    this._byId = new Map();
  }
  /** Register (and return) a new element usable by getElementById/querySelectorAll. */
  el(id, opts = {}) {
    const attrs = { ...(opts.attrs || {}), ...(id ? { id } : {}) };
    const node = new StubElement(opts.tag || 'div', { ...opts, attrs });
    if (id) this._byId.set(id, node);
    this.all.push(node);
    return node;
  }
  getElementById(id) {
    return this._byId.get(id) || null;
  }
  querySelectorAll(sel) {
    return this.all.filter((el) => matchesSelector(el, sel));
  }
  createElement(tag) {
    return new StubElement(tag);
  }
  /** Registers a caller-supplied node object (not a StubElement) so
   * getElementById/querySelectorAll can find it — for tests that need DOM
   * surface StubElement doesn't implement (e.g. `<select>`'s `.options`/
   * `.selectedIndex`), without changing StubElement's shape for every
   * other test that doesn't need it. */
  registerCustom(id, node) {
    this._byId.set(id, node);
    this.all.push(node);
    return node;
  }
}
