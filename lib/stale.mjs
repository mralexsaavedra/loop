/* Viewer-clock staleness, shared by every client renderer (Inicio dials / monitor / timeline,
 * Entreno calendar): data whose date is more than STALE_DAYS before the VIEWER's today is greyed and
 * gets no advice or status. The build bakes no "now", so the client applies it; this is the one
 * source of the number, baked for the page as HC_CONST (layouts/Plan.astro) and read through
 * window.HC (web/src/client/util.js). */
export const STALE_DAYS = 3;

/** The page-level constants baked as `var HC_CONST = …` before web/src/client/util.js. */
export function hcConst() {
  return { staleDays: STALE_DAYS };
}
