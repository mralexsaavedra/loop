/* Server-side nutrition settings (LAN page only): the goal (maintain / cut / bulk) and the target
 * weight, stored by the ingest service (GET / PUT /api/food/settings, sql/007_settings.sql) so the phone
 * and the Mac agree. Classic script (is:inline), inlined after food-*.js (it reuses window.HCFood.api: the
 * same X-HC-Food header, JSON body, timeout and coarse error codes as the food log) and before
 * progress.js / profile.js, which read it.
 *
 * Decided at VIEW time: without an answer (the claude.ai artifact, file://, the example build, an
 * ingest without the settings table) HCSettings.ready() stays false and the page behaves exactly as
 * before — the goal lives in localStorage only and there is no target-weight field.
 * With an answer the SERVER copy is the source of truth: its goal is applied through HCNutri.applyGoal
 * (which also refreshes hc.nutri.goal, the offline cache) — unless this viewer has a PENDING goal
 * (HCNutri.pendingGoal: picked here, not yet confirmed by a PUT), which wins and is pushed until a PUT
 * succeeds (retried on the next load and whenever the page becomes visible again); a server without a
 * goal gets this viewer's stored one once (the one-time migration from localStorage). The GET is
 * retried with backoff on offline / timeout / 5xx (RETRY_DELAYS_MS), never on 404 / 503 (no settings
 * on this server). Saves are partial PUTs; listeners (onChange) get the state
 * after every load / save, with the last save's status for the profile sheet's status lines.
 * Limits (target weight 35–250 kg) come baked from lib/nutrition/foodlog.mjs FOOD_LIMITS (FOOD_CONST). */
(function () {
  var K = typeof FOOD_CONST === 'undefined' || !FOOD_CONST ? null : FOOD_CONST;
  var LIM = K && K.limits ? K.limits : {};
  var S = { ok: false, goal: null, target: null, last: null };
  var listeners = [];
  var seq = 0;
  var RETRY_DELAYS_MS = [1000, 3000]; // GET /settings: 3 tries in all
  var loading = false;

  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function nutri() {
    var n = window.HCNutri;
    return n && typeof n.state === 'function' ? n : null;
  }
  function client() {
    var F = window.HCFood;
    return F && typeof F.api === 'function' ? F.api : null;
  }
  function goals() {
    return (K && K.goals) || [];
  }
  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(state()); } catch (e) { /* one listener never stops the others */ }
    });
  }
  function pending() {
    var n = nutri();
    try { return n && typeof n.pendingGoal === 'function' ? n.pendingGoal() : null; } catch (e) { return null; }
  }
  function state() {
    return { ok: S.ok, goal: S.goal, target: S.target, pending: pending(), last: S.last ? { what: S.last.what, status: S.last.status, code: S.last.code } : null };
  }
  function take(settings) {
    var x = settings || {};
    S.goal = goals().indexOf(x.goal) >= 0 ? x.goal : null;
    S.target = fin(x.targetWeightKg) ? x.targetWeightKg : null;
  }

  /** Partial PUT; resolves the stored settings, rejects {code}. An older answer never overwrites a newer one. */
  function put(body, what) {
    var api = client();
    if (!S.ok || !api) return Promise.reject({ code: 'offline' });
    var mine = ++seq;
    S.last = { what: what, status: 'saving', code: null };
    notify();
    return api('PUT', '/settings', body).then(function (d) {
      if (mine === seq) {
        take(d && d.settings);
        var n = nutri();
        if (what === 'goal' && n && typeof n.clearPending === 'function' && S.goal) n.clearPending(S.goal);
        S.last = { what: what, status: 'saved', code: null };
        notify();
      }
      return state();
    }, function (err) {
      if (mine === seq) {
        S.last = { what: what, status: 'error', code: (err && err.code) || 'generic' };
        notify();
      }
      throw err;
    });
  }

  function saveGoal(g) {
    if (goals().indexOf(g) < 0) return Promise.reject({ code: 'invalid' });
    return put({ goal: g }, 'goal');
  }
  /** kg (a number within the limits) or null (clears it). */
  function saveTarget(kg) {
    if (kg !== null && !(fin(kg) && kg >= LIM.targetWeightMin && kg <= LIM.targetWeightMax)) return Promise.reject({ code: 'invalid' });
    return put({ targetWeightKg: kg === null ? null : Math.round(kg * 10) / 10 }, 'target');
  }
  /** The field's text -> {value: kg | null (empty = no target)} or {error: 'number' | 'range'}. A decimal
   * comma and a trailing "kg" are fine (HCFood.parseNum, the food forms' one parser). */
  function parseTarget(text) {
    var F = window.HCFood;
    var v = F && typeof F.parseNum === 'function' ? F.parseNum(text, ['kg']) : NaN;
    if (v === null) return { value: null };
    if (!fin(v)) return { error: 'number' };
    if (v < LIM.targetWeightMin || v > LIM.targetWeightMax) return { error: 'range' };
    return { value: Math.round(v * 10) / 10 };
  }

  // offline / timed out (status 0) or a server error is worth another try; 404 / 503 (no settings here)
  // and any other refusal are final
  function retryable(err) {
    var st = err && typeof err.status === 'number' ? err.status : 0;
    return st === 0 || (st >= 500 && st !== 503);
  }
  function load(attempt) {
    var api = client();
    var n = attempt || 0;
    if (!api || (loading && !n)) return;
    loading = true;
    api('GET', '/settings').then(function (d) {
      loading = false;
      S.ok = true;
      take(d && d.settings);
      var m = nutri();
      var now = m ? m.state().goal : null;
      var mine = pending();
      if (mine) {
        // picked here and never confirmed: it wins over the server until a PUT succeeds
        saveGoal(mine).catch(function () {});
      } else if (S.goal) {
        if (m && now !== S.goal && typeof m.applyGoal === 'function') m.applyGoal(S.goal);
      } else {
        // one-time migration: a server without a goal gets the one this viewer stored
        var stored = m && typeof m.storedGoal === 'function' ? m.storedGoal() : null;
        if (stored) saveGoal(stored).catch(function () {});
      }
      notify();
    }, function (err) {
      if (retryable(err) && n < RETRY_DELAYS_MS.length) {
        setTimeout(function () { load(n + 1); }, RETRY_DELAYS_MS[n]);
        return;
      }
      loading = false; // no settings API here: the page keeps its local goal and shows no target field
    });
  }
  // back on the page: a server never reached is tried again, a pending goal is pushed again
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (!S.ok) { load(); return; }
      var mine = pending();
      if (mine && !(S.last && S.last.status === 'saving')) saveGoal(mine).catch(function () {});
    });
  }

  window.HCSettings = {
    ready: function () { return S.ok; },
    goal: function () { return S.goal; },
    targetWeight: function () { return S.target; },
    limits: function () { return { min: LIM.targetWeightMin, max: LIM.targetWeightMax }; },
    saveGoal: saveGoal,
    saveTarget: saveTarget,
    parseTarget: parseTarget,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    state: state,
  };
  try { load(); } catch (e) { /* stays not ready */ }
})();
