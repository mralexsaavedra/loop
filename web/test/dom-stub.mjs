/* Minimal DOM stub for running the classic (non-module) client scripts
 * (web/src/client/*.js) inside `node:vm`, without a real browser or a
 * jsdom dependency. Only implements the handful of DOM surface those
 * scripts actually call: getElementById auto-elements with
 * innerHTML/value/textContent/addEventListener, createElement escaping,
 * querySelectorAll, a fixed Date.
 *
 * Usage:
 *   const doc = new StubDocument();
 *   const el = doc.el('t-dia', { classes: ['tabnav-btn'], attrs: { 'data-tab': 'dia' } });
 *   const ctx = vm.createContext({ document: doc, window: {}, setTimeout, console });
 *   vm.runInContext(source, ctx);
 */

/** What a selector is matched against: a StubElement, or a node a test registered with registerCustom.
 * @typedef {{ tag: string, attrs: Record<string, string>, classes: Set<string>, parent?: StubNode | null }} StubNode */
/** StubElement / StubDocument.el options.
 * @typedef {{ tag?: string, attrs?: Record<string, string>, classes?: string[], hidden?: boolean, open?: boolean,
 *   textContent?: string, parent?: StubNode | null }} StubElementOpts */

/** @param {StubNode} el @param {string} sel @returns {boolean} */
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
 * the browser behavior the client scripts' `esc()` helper
 * relies on (`document.createElement('div'); d.textContent=s; return
 * d.innerHTML;`) — see web/src/client/training-today.ts.
 * @param {unknown} s @returns {string} */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class StubElement {
  /** @param {string} tag @param {StubElementOpts} [opts] */
  constructor(tag, opts = {}) {
    this.tag = tag;
    this.attrs = { ...(opts.attrs || {}) };
    this.classes = new Set(opts.classes || []);
    /** @type {Record<string, string>} */
    this.dataset = {};
    for (const [k, v] of Object.entries(this.attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, /** @type {string} */ c) => c.toUpperCase());
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
    // `configurable: true` lets a test override either property later (a
    // <select> stub redefines them).
    /** The text, as the DOM's property (an accessor defined below). @type {string} */
    this.textContent;
    /** The markup, as the DOM's property (an accessor defined below). @type {string} */
    this.innerHTML;
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
    /** @type {StubNode | null} */
    this.parent = opts.parent || null;
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this._scrolledIntoView = false;
    this.classList = {
      add: (/** @type {string} */ c) => this.classes.add(c),
      remove: (/** @type {string} */ c) => this.classes.delete(c),
      toggle: (/** @type {string} */ c, /** @type {boolean | undefined} */ force) => (force === undefined ? (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c)) : force ? this.classes.add(c) : this.classes.delete(c)),
      contains: (/** @type {string} */ c) => this.classes.has(c),
    };
  }
  /** @param {string} name @param {unknown} value */
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, /** @type {string} */ c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
  }
  /** @param {string} name @returns {string | null} */
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  /** @param {string} evt @param {Function} fn */
  addEventListener(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
  }
  /** @param {string} evt */
  dispatch(evt) {
    (this._listeners[evt] || []).forEach((fn) => fn.call(this));
  }
  /** Real-DOM alias of `parent`, so client code can walk ancestors the browser way. */
  /** @param {string} name */
  removeAttribute(name) {
    delete this.attrs[name];
  }
  get parentElement() {
    return this.parent;
  }
  /** Real-DOM tag name (upper case), for code that checks what kind of element it is. */
  get tagName() {
    return this.tag.toUpperCase();
  }
  /** @param {string} sel @returns {StubNode | null} */
  closest(sel) {
    /** @type {StubNode | null | undefined} */
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
    /** @type {StubNode[]} */
    this.all = [];
    /** @type {Map<string, StubNode>} */
    this._byId = new Map();
  }
  /** Register (and return) a new element usable by getElementById/querySelectorAll. */
  /** @param {string | null | undefined} id @param {StubElementOpts} [opts] @returns {StubElement} */
  el(id, opts = {}) {
    const attrs = { ...(opts.attrs || {}), ...(id ? { id } : {}) };
    const node = new StubElement(opts.tag || 'div', { ...opts, attrs });
    if (id) this._byId.set(id, node);
    this.all.push(node);
    return node;
  }
  /** @param {string} id @returns {StubNode | null} */
  getElementById(id) {
    return this._byId.get(id) || null;
  }
  /** @param {string} sel @returns {StubNode[]} */
  querySelectorAll(sel) {
    return this.all.filter((el) => matchesSelector(el, sel));
  }
  /** @param {string} tag @returns {StubElement} */
  createElement(tag) {
    return new StubElement(tag);
  }
  /** Registers a caller-supplied node object (not a StubElement) so
   * getElementById/querySelectorAll can find it — for tests that need DOM
   * surface StubElement doesn't implement (e.g. `<select>`'s `.options`/
   * `.selectedIndex`), without changing StubElement's shape for every
   * other test that doesn't need it.
   * @template {StubNode} T @param {string} id @param {T} node @returns {T} */
  registerCustom(id, node) {
    this._byId.set(id, node);
    this.all.push(node);
    return node;
  }
}
