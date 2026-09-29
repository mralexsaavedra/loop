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
}
