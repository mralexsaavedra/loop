/* Client-side (browser, classic-script) format strings for Entreno's "Intensity (HR)" block
 * (web/src/client/training-dash.js — what is left of the former "Entrenos / Workouts" dashboard; its
 * volume and modality split live in the Activity card, activity-templates.mjs) — same rationale as
 * hoy-templates.mjs.
 *
 * `note2Html` is TRUSTED markup (same trust boundary as
 * es.mjs/en.mjs's `...Html`-suffixed generic dict entries — tracked,
 * non-personal copy, never user input) — see design's Trusted markup row.
 * The notes stay generic on purpose: a plan-specific aside (which sessions the owner's
 * program contains) is personal customization and belongs in plan-data.json's `page.notes`,
 * never in this tracked file.
 */
export const es = {
  modalityLabels: { strength: 'Fuerza', hiit: 'Gimnasio', run: 'Carrera', bike: 'Ciclismo', other: 'Otro cardio' },
  intensityHeading: 'Intensidad (FC)',
  infoLbl: 'Sobre {section}',
  rowAria: '{name}: FC media {value} ppm',
  peakTpl: 'pico {value}',
  intensityHint: 'FC media por modalidad, ponderada por minutos · {withHr}/{total} sesiones con pulso · últimas {weeks} semanas.',
  bpmLabel: 'ppm',
  asOfLine: 'Datos hasta el {date} (Apple Health + Strava).',
  note2Html: '<b>Ojo con la fuerza.</b> La FC mide esfuerzo CARDIOVASCULAR, no muscular: tu fuerza marca pulso bajo aunque la carga sea alta, así que aquí sale abajo. Sirve para leer carrera y gimnasio, no para juzgar la fuerza.',
};

export const en = {
  modalityLabels: { strength: 'Strength', hiit: 'Gym', run: 'Running', bike: 'Cycling', other: 'Other cardio' },
  intensityHeading: 'Intensity (HR)',
  infoLbl: 'About {section}',
  rowAria: '{name}: mean HR {value} bpm',
  peakTpl: 'peak {value}',
  intensityHint: 'Mean HR per modality, minute-weighted · {withHr}/{total} sessions with HR · last {weeks} weeks.',
  bpmLabel: 'bpm',
  asOfLine: 'Data through {date} (Apple Health + Strava).',
  note2Html: '<b>Mind the strength caveat.</b> HR measures CARDIOVASCULAR effort, not muscular: strength runs a low pulse even under heavy load, so it lands at the bottom here. Use it to read running and gym work, not to judge strength.',
};
