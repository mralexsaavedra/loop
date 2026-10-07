/* Nutrición intake rings — baked view-model. The most recent LOGGED day of dietary-daily.csv (a food
 * app writing nutrition to Apple Health, via extract.js or the Shortcut diet_* keys) plus the plan's
 * training-day total, the fallback target when Nutrición's own target (HCNutri.targetFor) is absent.
 * The client (web/src/client/intake.js) decides freshness against the viewer's clock, so nothing here
 * depends on the build date and builds stay byte-identical. On the LAN page the client ignores
 * `latest` and reads the page's food log instead (one source there).
 *
 * Data honesty: a ring only ever fills from REAL intake. No logged day -> latest is null and the
 * page shows an empty state; a macro missing on the logged day -> that ring shows no fill. */
import { readDietary } from '../health/read.mjs';

// Intake older than this many days is not "today's picture" any more -> empty state (the client
// applies it against the viewer's clock; the ring fraction is computed there too).
export const INTAKE_FRESH_DAYS = 3;
// On the LAN page the rings wait for the food API boot request (GET /api/food/products) so they never
// flash the Apple Health day before the food log; past this many ms without an answer (a fetch hanging
// in a sandboxed artifact) they render the Apple Health day anyway, and a late answer still switches.
export const INTAKE_BOOT_GRACE_MS = 2500;

const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** rows from readDietary ([{date, value:kcal, p, c, g}]) -> the newest day with kcal > 0. */
export function latestIntake(rows) {
  const logged = (rows || []).filter((r) => r && r.value > 0);
  if (!logged.length) return null;
  const last = logged[logged.length - 1];
  return { date: last.date, k: r0(last.value), p: r1(last.p), c: r0(last.c), g: r0(last.g) };
}

const roundTarget = (t) => ({ k: r0(t.k), p: r0(t.p), c: r0(t.c), g: r0(t.g) });

/** extractDir (or null) + plan day totals {train:{k,p,c,g}, …} -> JSON-safe block (only train is baked). */
export function buildIntake(extractDir, targets) {
  return {
    latest: latestIntake(readDietary(extractDir)),
    target: { train: roundTarget(targets.train) },
    freshDays: INTAKE_FRESH_DAYS,
    bootGraceMs: INTAKE_BOOT_GRACE_MS,
  };
}
