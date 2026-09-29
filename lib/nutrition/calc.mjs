/* Pure extraction of the legacy Registro day-builder's recalc()/verdict
 * logic (the pre-Astro generated page's `<script>` day-builder IIFE,
 * deleted at the astro-plan-web cutover), generalized to be DATA-driven
 * instead of hardcoding extras keys
 * (cerveza/pintxo/chocolate/...) — see design's Testing Strategy
 * ("... or the calcDay fallback") and lib/nutrition/macros.mjs's
 * indulge/alcoholKeys/mealReplaceKeys.
 *
 * Generalizing fixed two real drifts found in the legacy hand-typed
 * warning triggers: the "sweet treats" warning only checked
 * chocolate+helado+dulce, silently missing `palomitas` (added to INDULGE
 * later but never added to that hardcoded list) — here ANY indulge key
 * outside alcoholKeys/mealReplaceKeys triggers it.
 *
 * No I/O, no DOM: caller (client/nutrition.js) reads the DOM into plain
 * numbers/objects, calls this, and writes the result back to the DOM.
 */
export function calcDay({
  mealTotals,
  postreK = 0,
  extraCounts = {},
  extraMacros = {},
  target,
  indulgeKeys = [],
  alcoholKeys = [],
  mealReplaceKeys = [],
  extraNames = {},
  dict,
}) {
  const tot = { ...mealTotals };
  const indulgeSet = new Set(indulgeKeys);
  let exK = 0;
  for (const [key, n] of Object.entries(extraCounts)) {
    if (!n) continue;
    const e = extraMacros[key];
    if (!e) continue;
    tot.k += n * e.k;
    tot.p += n * e.p;
    tot.c += n * e.c;
    tot.g += n * e.g;
    if (indulgeSet.has(key)) exK += n * e.k;
  }
  const rk = Math.round(tot.k);
  const rp = Math.round(tot.p);
  const rc = Math.round(tot.c);
  const rg = Math.round(tot.g);

  const verdict = [];

  if (rp >= target.p - 10) verdict.push(['ok', dict.proteinOk(rp)]);
  else if (rp >= target.p - 40) verdict.push(['warn', dict.proteinShort(rp, target.p)]);
  else verdict.push(['bad', dict.proteinVeryShort(rp, target.p)]);

  const diff = rk - target.k;
  if (diff > 200) {
    const cuts = [];
    if (exK > 0) cuts.push(dict.cutExtras(Math.round(exK)));
    if (postreK > 120) cuts.push(dict.cutDessert());
    cuts.push(dict.cutDinnerCarb());
    verdict.push(['bad', dict.overBudget(diff, cuts)]);
  } else if (diff < -300) {
    verdict.push(['warn', dict.underBudget(-diff)]);
  } else {
    verdict.push(['ok', dict.onTarget(diff)]);
  }

  if (rg > target.fatMax) verdict.push(['warn', dict.fatHigh(rg)]);

  for (const key of alcoholKeys) {
    const n = extraCounts[key] || 0;
    if (n <= 0) continue;
    const e = extraMacros[key];
    if (!e) continue;
    verdict.push(['warn', dict.alcohol(extraNames[key] || key, n, Math.round(n * e.k))]);
  }

  const treatKeys = indulgeKeys.filter((k) => !alcoholKeys.includes(k) && !mealReplaceKeys.includes(k));
  if (treatKeys.some((k) => (extraCounts[k] || 0) > 0)) verdict.push(['warn', dict.sweetTreats()]);

  for (const key of mealReplaceKeys) {
    const n = extraCounts[key] || 0;
    if (n > 0) verdict.push(['warn', dict.mealReplace(extraNames[key] || key)]);
  }

  return { totals: { k: rk, p: rp, c: rc, g: rg }, verdict };
}
