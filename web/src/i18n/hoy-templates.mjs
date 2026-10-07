/* Client-side (browser, classic-script) format strings for the "Hoy /
 * Today" tab (astro-plan-web slice 5) — same rationale/constraint as
 * the other *-templates.mjs files: web/src/client/training-today.js
 * is a classic script and cannot import an ES module, so it can only
 * receive plain JSON-safe data baked by Bake.astro (I18N_HOY).
 *
 * Ported from the legacy `<script>` IIFE in
 * data/nutrition/plan-web.template.html ("today's training"). The
 * `goalLineRe` field is a REGEX SOURCE (not a compiled RegExp — must stay
 * JSON-safe), compiled client-side with `new RegExp(I18N_HOY.goalLineRe,
 * 'i')`; it flags a block line as a goal callout (`<li class="goal">`) —
 * legacy matches the FIRST WORD of the line ("Target"/"Goal" in English
 * training data, "Objetivo" in Spanish), so it is intentionally
 * locale-specific, unlike every other key here.
 *
 * `beforeFirstMsg` is a genuine improvement over the owner's live personal
 * page: their hand-edited copy dropped this third branch (only kept
 * "after last" / "rest day") when they translated the template by hand.
 * The tracked template (source of truth for generic/example copy, same
 * convention as CSS parity's source choice) keeps all three branches, so
 * this port restores it for the generic/example build. See
 * web/test/parity.test.mjs's KNOWN_DEVIATIONS for the resulting
 * personal-page deviation (which only ever surfaces on a fresh/reset
 * program with no first day yet).
 */
export const es = {
  sourceLabel: 'Fuente:',
  afterLastMsg: 'No hay sesión programada para hoy. El plan cargado llega hasta el {last}. Suelta el PDF del mes siguiente y regenera.',
  beforeFirstMsg: 'Aún no hay sesión programada. Son datos de ejemplo — sustitúyelos por tu propio programa (training-data.json) y regenera.',
  restDayMsg: 'Hoy no hay sesión programada — día de descanso.',
  goalLineRe: '^objetivo',
  // the detail sheet that opens from the programmed row of Inicio's "Actividades de hoy"
  viewTitle: 'Entreno de hoy',
};

export const en = {
  sourceLabel: 'Source:',
  afterLastMsg: 'No session scheduled for today. The loaded plan runs to {last}. Drop next month\'s PDF and regenerate.',
  beforeFirstMsg: 'No session scheduled yet. This is sample data — replace it with your own program (training-data.json), then regenerate.',
  restDayMsg: 'No session scheduled today — rest day.',
  goalLineRe: '^(target|goal)',
  // the detail sheet that opens from the programmed row of Inicio's "Today's activities"
  viewTitle: 'Today\'s session',
};
