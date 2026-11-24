/**
 * In-memory limiters (nothing persisted: a restart simply starts fresh).
 *
 * - createWindowLimiter: fixed window per key (the per-client write limit of the food routes). The
 *   key map is bounded: when it is full, expired windows are dropped first, then the oldest key.
 * - createTokenBucket: one shared bucket that refills continuously (the Open Food Facts rate limits:
 *   search <= 10/min, product <= 100/min).
 */
/** @param {{ limit: number, windowMs: number, now?: () => number, maxKeys?: number }} opts */
export function createWindowLimiter ({ limit, windowMs, now = Date.now, maxKeys = 1000 }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map()
  /** @param {number} t */
  function prune (t) {
    for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k)
    // the map is not empty here (size >= maxKeys >= 1), so the first key exists
    while (windows.size >= maxKeys) windows.delete(/** @type {string} */ (windows.keys().next().value))
  }
  return {
    /** true = allowed (and counted), false = over the limit for this window
     * @param {string} key */
    take (key) {
      const t = now()
      let w = windows.get(key)
      if (!w || t - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) prune(t)
        w = { start: t, count: 0 }
        windows.set(key, w)
      }
      if (w.count >= limit) return false
      w.count++
      return true
    }
  }
}

/** @param {{ capacity: number, perMs: number, now?: () => number }} opts */
export function createTokenBucket ({ capacity, perMs, now = Date.now }) {
  let tokens = capacity
  let last = now()
  return {
    take () {
      const t = now()
      tokens = Math.min(capacity, tokens + ((t - last) * capacity) / perMs)
      last = t
      if (tokens < 1) return false
      tokens -= 1
      return true
    }
  }
}
