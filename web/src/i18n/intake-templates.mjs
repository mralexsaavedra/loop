/* Client-side (classic-script) copy for the Nutrición intake rings (web/src/client/intake.js),
 * baked as I18N_INTAKE by components/Bake.astro. JSON-safe only: `{placeholder}` strings,
 * substituted client-side. `...Html` entries are trusted, tracked, generic markup. */
export const es = {
  heading: 'Ingesta registrada',
  asOfTpl: '{date}',
  todayLbl: 'Hoy, en curso',
  targetLbl: { train: 'Objetivo día de entreno', rest: 'Objetivo día de descanso' },
  rideFuel: '+ {k} kcal en la bici',
  ofTpl: 'de {target} {unit}',
  rings: { k: 'Energía', p: 'Proteína', c: 'Carbohidratos', g: 'Grasa' },
  units: { k: 'kcal', p: 'g', c: 'g', g: 'g' },
  missing: 'sin dato',
  noteHtml: 'Lo que tu app de comida escribió en Salud para ese día, frente al objetivo de hoy (objetivo y tipo de día elegidos arriba). Un día a medio registrar se ve incompleto: es el registro, no necesariamente lo que comiste.',
  // no intake ever logged: one line in the Registro fold summary (tabs/Registro.astro)
  noneHtml: 'Sin comida registrada: los anillos de ingesta aparecen si una app de comida escribe en Apple Health.',
};

export const en = {
  heading: 'Logged intake',
  asOfTpl: '{date}',
  todayLbl: 'Today, so far',
  targetLbl: { train: 'Training-day target', rest: 'Rest-day target' },
  rideFuel: '+ {k} kcal on the bike',
  ofTpl: 'of {target} {unit}',
  rings: { k: 'Energy', p: 'Protein', c: 'Carbs', g: 'Fat' },
  units: { k: 'kcal', p: 'g', c: 'g', g: 'g' },
  missing: 'no data',
  noteHtml: 'What your food app wrote to Health for that day, against the target for today (the goal and day type picked above). A half-logged day looks short: it is the log, not necessarily what you ate.',
  // no intake ever logged: one line in the Registro fold summary (tabs/Registro.astro)
  noneHtml: 'No food logged: the intake rings appear once a food app writes to Apple Health.',
};
