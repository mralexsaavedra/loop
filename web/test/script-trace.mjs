/* Load-order evidence for the client script manifest (web/src/client/manifest.mjs), shared by
 * web/test/script-manifest.test.mjs:
 *
 * - declaredGlobals(src): the page globals a classic script DECLARES at top level (`var X`,
 *   `function X`), read from V8 itself: global declarations are instantiated before the first
 *   statement runs, so `throw 0;` + src in an empty context leaves exactly those names behind.
 * - windowWrites(src): every `window.X = …` assignment anywhere in the file (lazy ones included).
 * - traceLoad(bakes, entries, hash): runs the built page's bake scripts, then every client script in
 *   manifest order inside one vm (a permissive DOM stub: any property is a callable no-op, LAN fetches
 *   never answer, timers never fire) and records, per script, the globals READ while that script runs
 *   synchronously (its load time), wherever the code doing the read lives. Each script is wrapped in
 *   `with (scope)`, whose `has` trap sees every free identifier; `window` is a Proxy over the global.
 *   Handlers, timers and fetch answers run after every script, so they never constrain the order.
 *   The trace follows the data the example bakes; a deep-link hash takes the load-time open path.
 */
import vm from 'node:vm';

export function declaredGlobals(src) {
  const ctx = vm.createContext({});
  const base = new Set(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)));
  try { vm.runInContext('throw 0;\n' + src, ctx); } catch { /* the point: nothing runs */ }
  return Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)).filter((k) => !base.has(k));
}

export function windowWrites(src) {
  return [...new Set([...src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]))];
}

function anything() {
  const fn = function () { return anything(); };
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return anything();
    },
    set: () => true,
    has: () => true,
    apply: () => anything(),
    construct: () => anything(),
  });
}

/** bakes: the page's inline sources before the first client script; entries: [{file, src}] in order.
 * Returns { baked: [names], scripts: {file: {reads: [names], wrote: [names], error}} }. */
export function traceLoad(bakes, entries, hash = '') {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  const g = vm.runInContext('globalThis', ctx);
  const base = new Set(Object.getOwnPropertyNames(g));
  for (const src of bakes) vm.runInContext(src, ctx);
  const baked = Object.getOwnPropertyNames(g).filter((k) => !base.has(k));
  const noop = () => {};
  Object.assign(g, {
    document: anything(), navigator: anything(), history: anything(), localStorage: anything(), sessionStorage: anything(),
    matchMedia: anything(), getComputedStyle: anything(), location: { protocol: 'file:', hash, search: '', pathname: '/', href: 'file:///' + hash },
    setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop, requestAnimationFrame: noop, scrollTo: noop,
    addEventListener: noop, removeEventListener: noop, fetch: () => new Promise(noop), innerWidth: 400,
    IntersectionObserver: anything(), ResizeObserver: anything(), MutationObserver: anything(),
  });
  let reads = null, own = null, wrote = null;
  const note = (k) => { if (reads && typeof k === 'string' && !own.has(k)) reads.add(k); };
  g.window = g.self = new Proxy(g, {
    get(t, k) { note(k); return Reflect.get(t, k); },
    has(t, k) { note(k); return Reflect.has(t, k); },
    set(t, k, v) { if (wrote && typeof k === 'string') { wrote.add(k); own.add(k); } return Reflect.set(t, k, v); },
  });
  g.__hcScope = new Proxy({}, { has(t, k) { if (typeof k === 'string' && k in g) note(k); return false; } });
  const scripts = {};
  for (const { file, src } of entries) {
    own = new Set(declaredGlobals(src));
    reads = new Set();
    wrote = new Set();
    let error = null;
    try { vm.runInContext('with (__hcScope) {\n' + src + '\n}', ctx, { filename: file }); } catch (e) { error = String((e && e.message) || e); }
    scripts[file] = { reads: [...reads], wrote: [...wrote], error };
  }
  reads = own = wrote = null;
  return { baked, scripts };
}
