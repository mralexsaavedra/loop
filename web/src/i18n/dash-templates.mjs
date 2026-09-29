/* Client-side (browser, classic-script) format strings for the "Entrenos /
 * Workouts" dashboard tab (astro-plan-web slice 5) — same rationale as
 * hoy-templates.mjs. Ported from the legacy `<script>` IIFE in
 * data/nutrition/plan-web.template.html ("training dashboard").
 *
 * `note1Html`/`note2Html` are TRUSTED markup (same trust boundary as
 * es.mjs/en.mjs's `...Html`-suffixed generic dict entries — tracked,
 * non-personal copy, never user input) — see design's Trusted markup row.
 * The owner's live personal page adds one plan-specific parenthetical to
 * note1 ("tu plan lleva pista + tirada larga") that is intentionally NOT
 * reproduced here: it is personal customization, not generic copy, and
 * belongs in plan-data.json's `page.notes` if the owner wants it back —
 * see web/test/parity.test.mjs's KNOWN_DEVIATIONS.
 */
export const es = {
  modalityLabels: { strength: 'Fuerza', hiit: 'HIIT / funcional', run: 'Carrera', bike: 'Ciclismo', other: 'Otro cardio' },
  emptyMsg: 'Aún no hay datos de entrenos. Suelta tu export de Apple Health en <code>data/apple-health/</code>, corre <code>extract.js</code> y regenera.',
  daysPerWeekLbl: 'días / semana',
  perWeekLbl: 'por semana',
  sessions4wkLbl: 'sesiones · 4 sem',
  volHeading: 'Volumen semanal',
  volHint: 'Minutos por semana · últimas {weeks} semanas.',
  modHeading: 'Reparto por modalidad',
  modHint: 'Por minutos · últimas {weeks} semanas.',
  intensityHeading: 'Intensidad (frecuencia cardíaca)',
  intensityHint: 'FC media por modalidad, ponderada por minutos · {withHr}/{total} sesiones con pulso · últimas {weeks} semanas.',
  bpmLabel: 'ppm',
  peakLabel: 'pico',
  asOfLine: 'Datos hasta el {date} (Apple Health + Strava).',
  note1Html: '<div class="dash-note"><b>Cómo leer esto.</b> Estas etiquetas las pone el Apple Watch solo. El <b>HIIT domina porque el reloj marca como «HIIT» casi todo el gimnasio con pulso alto — incluido el bloque de FUERZA de tu plan</b> (sentadilla, clean, press…). Tu fuerza real es mayor que la barra «Fuerza»: solo cuenta cuando la registras aparte (p. ej. Hevy). La <b>carrera está infra-registrada</b>. Volumen y frecuencia (arriba) sí son fiables — la frecuencia cuenta <b>días distintos</b>. Las calorías no se muestran: vienen vacías en los exports recientes.</div>',
  note2Html: '<div class="dash-note"><b>Ojo con la fuerza.</b> La FC mide esfuerzo CARDIOVASCULAR, no muscular: tu fuerza marca pulso bajo aunque la carga sea alta, así que aquí sale abajo. Sirve para leer carrera y HIIT, no para juzgar la fuerza.</div>',
};

export const en = {
  modalityLabels: { strength: 'Strength', hiit: 'HIIT / functional', run: 'Running', bike: 'Cycling', other: 'Other cardio' },
  emptyMsg: 'No workout data yet. Drop your Apple Health export into <code>data/apple-health/</code>, run <code>extract.js</code>, then regenerate.',
  daysPerWeekLbl: 'days / week',
  perWeekLbl: 'per week',
  sessions4wkLbl: 'sessions · 4 wk',
  volHeading: 'Weekly volume',
  volHint: 'Minutes per week · last {weeks} weeks.',
  modHeading: 'Modality split',
  modHint: 'By minutes · last {weeks} weeks.',
  intensityHeading: 'Intensity (heart rate)',
  intensityHint: 'Mean HR per modality, minute-weighted · {withHr}/{total} sessions with HR · last {weeks} weeks.',
  bpmLabel: 'bpm',
  peakLabel: 'peak',
  asOfLine: 'Data through {date} (Apple Health + Strava).',
  note1Html: '<div class="dash-note"><b>How to read this.</b> These labels come from the Apple Watch itself. <b>HIIT dominates because the watch tags almost any high-heart-rate gym work as “HIIT” — including your program’s STRENGTH block</b> (squat, clean, press…). Your real strength volume is higher than the “Strength” bar: it only counts when logged separately (e.g. Hevy). <b>Running is under-logged</b>. Volume and frequency (above) are reliable — frequency counts <b>distinct days</b>. Workout calories are omitted: recent exports leave them blank.</div>',
  note2Html: '<div class="dash-note"><b>Mind the strength caveat.</b> HR measures CARDIOVASCULAR effort, not muscular: strength runs a low pulse even under heavy load, so it lands at the bottom here. Use it to read running and HIIT, not to judge strength.</div>',
};
