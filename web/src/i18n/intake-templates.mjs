/* Client-side (classic-script) copy for the Nutrición intake rings (web/src/client/intake.js),
 * baked as I18N_INTAKE by components/Bake.astro. JSON-safe only: `{placeholder}` strings,
 * substituted client-side. `...Html` entries are trusted, tracked, generic markup. */
export const es = {
  heading: 'Ingesta registrada',
  asOfTpl: '{date}',
  todayLbl: 'Hoy, en curso',
  targetLbl: { train: 'Objetivo día de entreno', rest: 'Objetivo día de descanso' },
  ofTpl: 'de {target} {unit}',
  rings: { k: 'Energía', p: 'Proteína', c: 'Carbohidratos', g: 'Grasa' },
  units: { k: 'kcal', p: 'g', c: 'g', g: 'g' },
  missing: 'sin dato',
  noteHtml: 'Lo que tu app de comida escribió en Salud para ese día, frente al total del plan del tipo de día elegido arriba. Un día a medio registrar se ve incompleto: es el registro, no necesariamente lo que comiste.',
  emptyHtml: '<b>No hay ingesta reciente.</b> Los anillos aparecen cuando hay comida registrada en los últimos {days} días. Registra lo que comes en una app que escriba nutrición en Apple Health y añade las claves <code>diet_kcal</code>, <code>diet_protein</code>, <code>diet_carbs</code> y <code>diet_fat</code> a tu Atajo — ver <code>docs/ios-shortcut.md</code>.',
  lastTpl: ' Último día registrado: {date}.',
};

export const en = {
  heading: 'Logged intake',
  asOfTpl: '{date}',
  todayLbl: 'Today, so far',
  targetLbl: { train: 'Training-day target', rest: 'Rest-day target' },
  ofTpl: 'of {target} {unit}',
  rings: { k: 'Energy', p: 'Protein', c: 'Carbs', g: 'Fat' },
  units: { k: 'kcal', p: 'g', c: 'g', g: 'g' },
  missing: 'no data',
  noteHtml: 'What your food app wrote to Health for that day, against the plan total for the day type picked above. A half-logged day looks short: it is the log, not necessarily what you ate.',
  emptyHtml: '<b>No recent intake.</b> The rings appear when food was logged within the last {days} days. Log what you eat in an app that writes nutrition to Apple Health and add the <code>diet_kcal</code>, <code>diet_protein</code>, <code>diet_carbs</code> and <code>diet_fat</code> keys to your Shortcut — see <code>docs/ios-shortcut.md</code>.',
  lastTpl: ' Last logged day: {date}.',
};
