/* Client-side (browser, classic-script) format strings for the "Salud /
 * Health" tab (astro-plan-web slice 6) — same rationale/constraint as
 * hoy-templates.mjs / dash-templates.mjs: web/src/client/health.js is a
 * classic script and cannot import an ES module, so it can only receive
 * plain JSON-safe data baked by Bake.astro (I18N_HEALTH). No functions or
 * RegExp allowed here — every dynamic fragment is a `{placeholder}` string
 * substituted client-side via the shared `format(tpl, vars)` helper (see
 * health.js), including two-level nesting for the notes that have optional
 * clauses (e.g. `sourcesClause`/`sourceClause` built from a sub-template,
 * then spliced into the note's `main` template) — this preserves the exact
 * conditional-concatenation structure of the legacy `<script>` IIFE while
 * staying JSON-safe.
 *
 * Ported from the legacy `<script>` IIFE in
 * data/nutrition/plan-web.template.html ("health"). Decimal-comma display
 * (`nf()` in health.js) and the `es-ES`/`en-GB` date locale are handled in
 * health.js itself from the shared `LOCALE` global — same pattern as
 * training-dash.js's `hc()`.
 *
 * `runningNote` ends with a GENERIC closing line ("Improving pace at the same effort is the
 * signal to watch.") on purpose: it holds for any runner whatever their goal. A goal-specific
 * sentence (a target race, a pace to hit) is personal copy and belongs in the owner's
 * plan-data.json `page` block, never in this tracked file.
 */
export const es = {
  emptyMsg: 'Aún no hay datos de salud. Suelta tu export de Apple Health en <code>data/apple-health/</code>, corre <code>extract.js</code> y regenera.',
  title: 'Salud',
  // ⓘ of the Salud header and of each section: aria-label of the toggle button
  infoTpl: 'Sobre {section}',
  rowsHelp: 'Cada fila: el último valor a la derecha; debajo, en pequeño, tu media de 30 días (o el cambio Δ en las medidas sueltas) y ▲▼ frente a ella — verde azulado si va en la buena dirección, naranja si no, gris sin dirección buena o dentro de ±2 %. Un total de hoy va en curso y no se compara. Toca una fila para ver su historial (S · M · 6M · 1A).',
  fitnessNoteHtml: '<b>↑ VO₂máx y ↓ FC al caminar</b> son las direcciones buenas. VO₂máx: Δ desde la primera lectura. FC al caminar: frente a su media de 30 días.',
  sleepNoteHtml: 'Anoche frente a tu media de 30 noches. Además de la media importa la <b>consistencia</b>: el % de noches que llegan al objetivo, la variación noche a noche (±h) y la regularidad de horarios (mediana ± minutos).',
  deltaAriaTpl: 'cambio {value}',
  dirs: { up: 'por encima', down: 'por debajo', flat: 'similar' },
  introMsg: 'Cuerpo, actividad y recuperación de tu último export de Apple Health.',
  agoDaysTpl: 'hace {d} días',
  agoMonthTpl: 'hace {m} mes',
  agoMonthsTpl: 'hace {m} meses',
  agoYearsTpl: 'hace {y} años',
  sections: {
    body: 'Composición corporal',
    activity: 'Actividad',
    energy: 'Energía',
    running: 'Carrera',
    cycling: 'Ciclismo',
    recovery: 'Recuperación',
    fitness: 'Forma física',
    sleep: 'Sueño',
    load: 'Carga vs recuperación',
  },
  // Entreno's share of this renderer (#health-train: running, cycling, load vs recovery)
  trainEmptyMsg: 'Aún no hay carreras, salidas en bici ni carga. Aparecen con los entrenos del reloj o desde Strava (<code>npm run sync:strava</code>).',
  bodyCompPointsTpl: '{n} lecturas en los últimos {days} días',
  trend: {
    weight: { title: 'Peso', unit: 'kg', deltaUnit: ' kg' },
    bodyfat: { title: 'Grasa corporal', unit: '%', deltaUnit: ' pp' },
    lean: { title: 'Masa magra', unit: 'kg', deltaUnit: ' kg' },
    steps: { title: 'Pasos', unit: 'pasos', avgUnit: '/día', deltaUnit: '' },
    exercise: { title: 'Min. de ejercicio', unit: 'min', avgUnit: ' min/día', deltaUnit: '' },
    distance: { title: 'Distancia', unit: 'km', avgUnit: ' km/día', deltaUnit: '' },
    flights: { title: 'Pisos subidos', unit: 'pisos', avgUnit: '/día', deltaUnit: '' },
    expenditure: { title: 'Gasto diario', unit: 'kcal', avgUnit: ' kcal' },
    rhr: { title: 'FC en reposo', unit: 'ppm', deltaUnit: ' ppm' },
    hrv: { title: 'VFC', unit: 'ms', deltaUnit: ' ms' },
    vo2max: { title: 'VO₂máx', unit: 'ml/kg/min', deltaUnit: '' },
    walkingHr: { title: 'FC al caminar', unit: 'ppm', deltaUnit: ' ppm' },
    respiratory: { title: 'Frecuencia respiratoria', unit: 'rpm', deltaUnit: '' },
    wristTemp: { title: 'Temp. de muñeca (sueño)', unit: '°C' },
    sleep: { title: 'Sueño', unit: 'h' },
  },
  avg30Tpl: 'media 30 días {value}',
  avgNightsTpl: 'media 30 noches {value}',
  soFar: 'hoy, en curso',
  staleNote: 'sin datos recientes',
  bodyNote: {
    main: '<b>Cómo leer esto.</b> El peso mezcla básculas/apps{sourcesClause}, así que la tendencia es una <b>media móvil de 7 días</b>; el número grande es tu última lectura{sourceClause}. Δ es respecto a hace ~30 días. La grasa corporal y la masa magra son bioimpedancia (<b>±3-5%</b>) y solo comparables <b>dentro de una misma báscula</b>{bfSourceClause}; su Δ es desde la primera lectura en esa báscula.',
    sourcesClause: ' ({n} fuentes)',
    sourceClause: ' ({src})',
  },
  waist: {
    title: 'Cintura',
    titleTpl: 'Cintura · {date}',
    unit: 'cm',
    deltaUnit: ' cm',
    noteTpl: '<b>Cintura</b>: {n} medidas con cinta desde el {first}; Δ = última vs primera. Mídela a la altura del ombligo, de pie, al final de una espiración normal, cada 2-4 semanas.',
    emptyHtml: '<b>Aún no hay medidas de cintura.</b> Regístrala en Salud (Medidas corporales → Perímetro de cintura) y añade la clave <code>waist</code> a tu Atajo — ver <code>docs/ios-shortcut.md</code>.',
  },
  activityNoteHtml: '<b>Pasos = NEAT</b>, tu mayor palanca de gasto fuera del entreno. El valor es el último día (el de hoy va en curso hasta medianoche); debajo, la media de 30 días; el historial muestra la media móvil de 7 días. Se descartan días casi sin pasos/distancia (dispositivo no llevado) y se toma el <b>máximo por dispositivo</b> para no duplicar iPhone + reloj.',
  energyBalanceNote: {
    main: 'Balance entre {from}–{to} ({days} días registrados). Negativo = déficit. Es <b>histórico</b> — basado en la última ventana con ingesta registrada.{macroClause}',
    macroClause: ' El split de macros es la media de esos días.',
  },
  energyExpenditureNote: {
    main: '<b>Solo gasto.</b> Energía activa + basal del Apple Watch: el número grande es el último día, la línea la media móvil de 7 días (últimos {tdeeDays} días) — baja los días que no llevaste el reloj. <b>La ingesta no se puede puntuar:</b> se registró en muy pocos días recientes{lastIntakeClause} para calcular un déficit o un split de macros real. Para objetivos probados, mira el histórico del nutricionista en <code>data/nutritionist</code>.',
    lastIntakeClause: ' (último el {date}, {ago})',
  },
  energyRide: {
    latest: 'incluye la salida medida con potenciómetro',
    uncovered: 'salida con potenciómetro sin corregir: faltan datos por horas del reloj',
    uncoveredDays: '<b>Sin corregir:</b> {n} de los últimos 30 días tienen una salida con potenciómetro que no se pudo corregir porque faltan los datos por horas del reloj (clave <code>active_energy_hourly</code> del Atajo); queda el valor del reloj, probablemente corto.',
    days: '<b>Salidas con potenciómetro:</b> {n} de los últimos 30 días usan la energía de la salida medida por potencia (kJ de Strava ≈ kcal) en vez de la del reloj durante esas horas, porque el reloj no la registró y se queda corto. Solo si sube el día, nunca lo baja.',
  },
  energyCards: {
    intakeAvgLbl: 'ingesta media',
    tdeeAvgLbl: 'gasto medio',
    deficitLbl: 'déficit/día',
    surplusLbl: 'superávit/día',
    proteinLbl: 'proteína',
    carbsLbl: 'carbohidratos',
    fatLbl: 'grasa',
  },
  runningTable: { dateH: 'Fecha', distH: 'Dist', timeH: 'Tiempo', paceH: 'Ritmo', hrH: 'FC media', reH: 'Esf.', elevH: 'Desn.', powerH: 'Pot.', gctH: 'TCS', oscH: 'Osc.', strideH: 'Zancada' },
  runningNote: 'Tus <b>{count}</b> carreras (más recientes arriba), del reloj y de Strava; los fragmentos del mismo día cuentan como una. Ritmo = tiempo ÷ distancia. Esfuerzo relativo (Esf.) y desnivel solo llegan de Strava; potencia, tiempo de contacto con el suelo (TCS), oscilación vertical y zancada solo de las métricas de carrera del reloj (export de Apple Health) — un guion es un dato que la fuente no registró, nunca un cero. <b>No es una tendencia</b>; mejorar el ritmo al mismo esfuerzo es la señal a vigilar.',
  runningEmptyHtml: '<b>Aún no hay carreras.</b> Aparecen desde los entrenos de carrera del reloj o desde Strava (<code>npm run sync:strava</code>).',
  cyclingTable: { dateH: 'Fecha', distH: 'Dist', timeH: 'Tiempo', elevH: 'Desn.', hrH: 'FC media', reH: 'Esf.', kjH: 'Trabajo' },
  cyclingNote: 'Tus <b>{count}</b> salidas en bici (más recientes arriba). Tiempo = en movimiento (Strava) o duración del entreno (reloj); desnivel positivo, esfuerzo relativo (Esf.) y trabajo en kJ solo llegan de Strava — un guion es un dato que la fuente no registró, nunca un cero. Igual que en carrera: no es una tendencia; compara esfuerzo y FC en rutas parecidas.',
  cyclingEmptyHtml: '<b>Aún no hay salidas en bici.</b> Aparecen desde los entrenos de ciclismo del reloj o desde Strava (<code>npm run sync:strava</code>).',
  sleepCards: {
    nightsTargetLbl: 'noches ≥ {target} h',
    sdLbl: 'variación noche a noche',
    bedtimeLbl: 'hora de acostarse',
    wakeLbl: 'hora de despertar',
  },
  recoveryNoteHtml: '<b>↓ FC en reposo, ↑ VFC, ↑ VO₂máx y ↓ FC al caminar</b> son las direcciones buenas. La frecuencia respiratoria y la temperatura de muñeca (solo durante el sueño) sirven como señal de recuperación/enfermedad — mira el cambio, no el valor absoluto. En sueño, además de la media importan la <b>consistencia</b> (±h y la regularidad de horarios en minutos): dormir parecido cada noche recupera mejor que promediar 7 h con noches de 5 y 9.',
  loadSec: { heading: 'Carga cardiovascular semanal', hint: 'Índice = minutos × pulso medio ÷ 100 · solo sesiones con pulso (gimnasio, carrera y bici) · últimas {weeks} semanas completas.', barTitleTpl: '{date}: carga {load}' },
  loadCards: { hrvHighLbl: 'VFC · semanas de + carga', hrvLowLbl: 'VFC · semanas suaves', rhrHighLbl: 'FC reposo · + carga', rhrLowLbl: 'FC reposo · suaves', easyTpl: 'semanas suaves {value}' },
  loadNoteHtml: '<b>La vista que Strava no puede darte:</b> tu carga cruzada con tu recuperación. <b>VFC más baja y/o FC en reposo más alta en las semanas de más carga</b> es lo esperable — tu cuerpo acusa el estímulo. Lo que vigilas es que <b>rebote</b> en las semanas suaves; si no rebota, estás acumulando fatiga. Ojo: la FC refleja el trabajo cardiovascular: dentro de una sesión de gimnasio pesa más el <b>metcon</b> que las series pesadas (por eso es «carga cardiovascular», no total), son pocas semanas y esto es <b>asociación, no causa</b>.',
};

export const en = {
  emptyMsg: 'No health data yet. Drop your Apple Health export into <code>data/apple-health/</code>, run <code>extract.js</code>, then regenerate.',
  title: 'Health',
  // ⓘ of the Salud header and of each section: aria-label of the toggle button
  infoTpl: 'About {section}',
  rowsHelp: 'Each row: the latest value on the right; under it, small, your 30-day average (or the change Δ for sparse measurements) and ▲▼ against it — teal when it moves the good way, orange when not, grey without a good direction or within ±2%. Today’s running total is partial and not compared. Tap a row for its history (W · M · 6M · 1Y).',
  fitnessNoteHtml: '<b>↑ VO₂max and ↓ walking HR</b> are the good directions. VO₂max: Δ since the first reading. Walking HR: vs its 30-day average.',
  sleepNoteHtml: 'Last night vs your 30-night average. Beyond the average, <b>consistency</b> matters: the % of nights that reach the target, the night-to-night spread (±h) and how regular the schedule is (median ± minutes).',
  deltaAriaTpl: 'change {value}',
  dirs: { up: 'above', down: 'below', flat: 'about the same' },
  introMsg: 'Body, activity &amp; recovery from your latest Apple Health export.',
  agoDaysTpl: '{d} days ago',
  agoMonthTpl: '{m} month ago',
  agoMonthsTpl: '{m} months ago',
  agoYearsTpl: '{y} yr ago',
  sections: {
    body: 'Body composition',
    activity: 'Activity',
    energy: 'Energy',
    running: 'Running',
    cycling: 'Cycling',
    recovery: 'Recovery',
    fitness: 'Fitness',
    sleep: 'Sleep',
    load: 'Load vs recovery',
  },
  // Entreno's share of this renderer (#health-train: running, cycling, load vs recovery)
  trainEmptyMsg: 'No runs, rides or load data yet. They appear with Watch workouts or from Strava (<code>npm run sync:strava</code>).',
  bodyCompPointsTpl: '{n} readings in the last {days} days',
  trend: {
    weight: { title: 'Weight', unit: 'kg', deltaUnit: ' kg' },
    bodyfat: { title: 'Body fat', unit: '%', deltaUnit: ' pp' },
    lean: { title: 'Lean mass', unit: 'kg', deltaUnit: ' kg' },
    steps: { title: 'Steps', unit: 'steps', avgUnit: '/day', deltaUnit: '' },
    exercise: { title: 'Exercise minutes', unit: 'min', avgUnit: ' min/day', deltaUnit: '' },
    distance: { title: 'Distance', unit: 'km', avgUnit: ' km/day', deltaUnit: '' },
    flights: { title: 'Flights climbed', unit: 'flights', avgUnit: '/day', deltaUnit: '' },
    expenditure: { title: 'Daily expenditure', unit: 'kcal', avgUnit: ' kcal' },
    rhr: { title: 'Resting HR', unit: 'bpm', deltaUnit: ' bpm' },
    hrv: { title: 'HRV', unit: 'ms', deltaUnit: ' ms' },
    vo2max: { title: 'VO₂max', unit: 'ml/kg/min', deltaUnit: '' },
    walkingHr: { title: 'Walking HR', unit: 'bpm', deltaUnit: ' bpm' },
    respiratory: { title: 'Respiratory rate', unit: 'brpm', deltaUnit: '' },
    wristTemp: { title: 'Wrist temp (sleep)', unit: '°C' },
    sleep: { title: 'Sleep', unit: 'h' },
  },
  avg30Tpl: '30-day avg {value}',
  avgNightsTpl: '30-night avg {value}',
  soFar: 'today, so far',
  staleNote: 'no recent data',
  bodyNote: {
    main: '<b>How to read this.</b> Weight mixes scales/apps{sourcesClause}, so the trend is a <b>7-day rolling average</b>; the headline is your latest reading{sourceClause}. Δ is vs ~30 days ago. Body fat and lean mass are bioimpedance (<b>±3-5%</b>) and only comparable <b>within one scale</b>{bfSourceClause}; their Δ is since the first reading on that scale.',
    sourcesClause: ' ({n} sources)',
    sourceClause: ' ({src})',
  },
  waist: {
    title: 'Waist',
    titleTpl: 'Waist · {date}',
    unit: 'cm',
    deltaUnit: ' cm',
    noteTpl: '<b>Waist</b>: {n} tape measurements since {first}; Δ = latest vs first. Measure at navel height, standing, at the end of a normal breath out, every 2-4 weeks.',
    emptyHtml: '<b>No waist measurements yet.</b> Log it in Health (Body Measurements → Waist Circumference) and add the <code>waist</code> key to your Shortcut — see <code>docs/ios-shortcut.md</code>.',
  },
  activityNoteHtml: '<b>Steps = NEAT</b>, your biggest energy lever outside training. The value is the latest day (today’s is partial until midnight); under it, the 30-day average; the history view charts the 7-day rolling average. Near-zero step/distance days are dropped (device not carried) and the <b>max per device</b> is used so iPhone + watch aren’t double-counted.',
  energyBalanceNote: {
    main: 'Balance over {from}–{to} ({days} logged days). Negative = deficit. This is <b>historical</b> — based on the last window where intake was logged.{macroClause}',
    macroClause: ' The macro split is the average of those days.',
  },
  energyExpenditureNote: {
    main: '<b>Expenditure only.</b> Active + resting energy from the Apple Watch: the big number is the latest day, the line the 7-day rolling average (last {tdeeDays} days) — it runs low on days the watch wasn’t worn. <b>Intake can’t be scored:</b> it was logged on too few recent days{lastIntakeClause} to compute a real deficit or macro split. For proven targets, see the nutritionist history in <code>data/nutritionist</code>.',
    lastIntakeClause: ' (last on {date}, {ago})',
  },
  energyRide: {
    latest: 'includes the ride measured by the power meter',
    uncovered: 'power-meter ride not corrected: the watch\'s hourly data is missing',
    uncoveredDays: '<b>Not corrected:</b> {n} of the last 30 days have a power-meter ride that could not be corrected because the watch\'s hourly data is missing (the Shortcut\'s <code>active_energy_hourly</code> key); the watch value stays, probably short.',
    days: '<b>Power-meter rides:</b> {n} of the last 30 days use the ride energy measured by power (Strava kJ ≈ kcal) instead of the watch during those hours, because the watch did not record the ride and under-counts it. Only when it raises the day, never lowers it.',
  },
  energyCards: {
    intakeAvgLbl: 'avg intake',
    tdeeAvgLbl: 'avg burn',
    deficitLbl: 'deficit/day',
    surplusLbl: 'surplus/day',
    proteinLbl: 'protein',
    carbsLbl: 'carbs',
    fatLbl: 'fat',
  },
  runningTable: { dateH: 'Date', distH: 'Dist', timeH: 'Time', paceH: 'Pace', hrH: 'Avg HR', reH: 'Effort', elevH: 'Elev.', powerH: 'Power', gctH: 'GCT', oscH: 'Osc.', strideH: 'Stride' },
  runningNote: 'Your <b>{count}</b> runs (most recent first), from the watch and from Strava; same-day fragments count as one. Pace = time ÷ distance. Relative effort and elevation come from Strava only; power, ground-contact time (GCT), vertical oscillation and stride only from the watch’s running metrics (Apple Health export) — a dash is a value the source did not record, never a zero. <b>Not a trend</b>; improving pace at the same effort is the signal to watch.',
  runningEmptyHtml: '<b>No runs yet.</b> They appear from the watch’s running workouts or from Strava (<code>npm run sync:strava</code>).',
  cyclingTable: { dateH: 'Date', distH: 'Dist', timeH: 'Time', elevH: 'Elev.', hrH: 'Avg HR', reH: 'Effort', kjH: 'Work' },
  cyclingNote: 'Your <b>{count}</b> rides (most recent first). Time = moving time (Strava) or workout duration (watch); elevation gain, relative effort and work in kJ come from Strava only — a dash is a value the source did not record, never a zero. As with running, this is not a trend; compare effort and HR on similar routes.',
  cyclingEmptyHtml: '<b>No rides yet.</b> They appear from the watch’s cycling workouts or from Strava (<code>npm run sync:strava</code>).',
  sleepCards: {
    nightsTargetLbl: 'nights ≥ {target} h',
    sdLbl: 'night-to-night spread',
    bedtimeLbl: 'bedtime',
    wakeLbl: 'wake time',
  },
  recoveryNoteHtml: '<b>↓ resting HR, ↑ HRV, ↑ VO₂max and ↓ walking HR</b> are the good directions. Respiratory rate and wrist temperature (sleep only) are recovery/illness signals — watch the change, not the absolute value. For sleep, beyond the average the <b>consistency</b> matters (±h and schedule regularity in minutes): sleeping a similar amount each night recovers better than averaging 7 h across 5- and 9-hour nights.',
  loadSec: { heading: 'Weekly cardiovascular load', hint: 'Index = minutes × mean HR ÷ 100 · only sessions with heart rate (gym, run and bike) · last {weeks} complete weeks.', barTitleTpl: '{date}: load {load}' },
  loadCards: { hrvHighLbl: 'HRV · higher-load weeks', hrvLowLbl: 'HRV · easy weeks', rhrHighLbl: 'resting HR · higher-load', rhrLowLbl: 'resting HR · easy', easyTpl: 'easy weeks {value}' },
  loadNoteHtml: '<b>The view Strava can’t give you:</b> your load crossed with your recovery. <b>Lower HRV and/or higher resting HR in higher-load weeks</b> is expected — your body registers the stimulus. What you watch for is that it <b>rebounds</b> in easy weeks; if it doesn’t, you’re accumulating fatigue. Caveats: HR reflects cardiovascular work: within a gym session it credits the <b>metcon</b> more than the heavy sets (so this is CARDIOVASCULAR load, not total), it’s only a few weeks, and this is <b>association, not causation</b>.',
};
