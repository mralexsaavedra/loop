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
 * sentence (a target race, a pace to hit) is personal copy and belongs in the user's
 * plan-data.json `page` block, never in this tracked file.
 */
export const es = {
  emptyMsg: 'Aún no hay datos de salud. Suelta tu export de Apple Health en <code>data/apple-health/</code>, corre <code>extract.js</code> y regenera.',
  title: 'Salud',
  // ⓘ of the Salud header and of each section: aria-label of the toggle button
  infoTpl: 'Sobre {section}',
  rowsHelp: 'Cada fila: el último valor a la derecha; debajo, en pequeño, tu media de 30 días (o el cambio Δ en las medidas sueltas) y ▲▼ frente a ella — verde azulado si va en la buena dirección, naranja si no, gris sin dirección buena o dentro de ±2%. Un total de hoy va en curso y no se compara. Toca una fila para ver su historial (S · M · 6M · 1A).',
  fitnessNoteHtml: '<b>↑ VO₂máx y ↓ FC al caminar</b> son las direcciones buenas. VO₂máx: Δ desde la primera lectura. FC al caminar: frente a su media de 30 días.',
  // Fitness: the fitness-age block (client/health.js, SCORES.fitnessAge from lib/score/fitness-age.mjs)
  fitnessAge: {
    label: 'Edad física',
    chrono: 'Edad cronológica',
    trend: 'Edad física, {days} días',
    unit: 'años',
    younger: { one: '1 año más joven', other: '{n} años más joven' },
    older: { one: '1 año mayor', other: '{n} años mayor' },
    atLeastYounger: 'Al menos {n} años más joven',
    atLeastOlder: 'Al menos {n} años mayor',
    same: 'Igual que tu edad',
    basisTpl: 'VO₂máx {vo2} ml/kg/min · {date} · {src}',
    ariaTpl: 'Edad física {fa}, edad cronológica {ca}: {diff}',
    noSex: 'Edad física: añade "sex": "male" o "female" a profile/profile.json para elegir la curva de referencia.',
    noBirth: 'Edad física: añade tu fecha de nacimiento (birthdate) a profile/profile.json para compararla con tu edad.',
    noVo2: 'Edad física: aún no hay ninguna lectura de VO₂máx en el export.',
    noteHtml: '<b>Edad física</b> = la edad cuya VO₂máx <b>media</b> en una población sana de referencia es igual a tu última lectura. Referencia: Loe H, Rognmo Ø, Saltin B, Wisløff U (2013), «Aerobic Capacity Reference Data in 3816 Healthy Men and Women 20–90 Years», <i>PLoS ONE</i> 8(5): e64319, tabla 2 (doi:10.1371/journal.pone.0064319): estudio HUNT3 Fitness (Noruega), VO₂máx medida en cinta, media por sexo y grupo de 10 años (n = 53–526), interpolada entre los centros de grupo (25 … 65; 75 para 70+). Fuera de ese rango se muestra «&lt; 25» o «&gt; 75». Es una comparación con la <b>media</b>, no con la mediana: dentro de cada grupo de edad la dispersión es grande. Contexto: el concepto de edad física de Nes et al. (2014), <i>Med Sci Sports Exerc</i> 46(6): 1159–65 (doi:10.1249/MSS.0000000000000219). Tu VO₂máx es una <b>estimación del reloj</b>, no una prueba de laboratorio; esto es una comparación orientativa, no una medida médica.',
  },
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
  // Salud's Energía: expenditure only (the balance lives in Nutrición → Balance)
  energyTdeeNote: '<b>Solo gasto.</b> Energía activa + basal del Apple Watch: el valor es el último día y debajo la media de 30 días (últimos {tdeeDays} días) — baja los días que no llevaste el reloj. La ingesta, el déficit y el split de macros están en Nutrición → Balance.',
  // Nutrición → Balance when too few recent days carry intake
  balanceNoIntakeNote: {
    main: '<b>La ingesta no se puede puntuar:</b> se registró en muy pocos días recientes{lastIntakeClause} para calcular un déficit o un split de macros real. Para objetivos probados, mira el histórico del nutricionista en <code>data/nutritionist</code>.',
    lastIntakeClause: ' (último el {date}, {ago})',
  },
  energyRide: {
    latest: 'incluye la salida medida con potenciómetro',
    uncovered: 'salida con potenciómetro sin corregir: faltan datos por horas del reloj',
    uncoveredDays: '<b>Sin corregir:</b> {n} de los últimos 30 días tienen una salida con potenciómetro que no se pudo corregir porque faltan los datos por horas del reloj (clave <code>active_energy_hourly</code> del Atajo); queda el valor del reloj, probablemente corto.',
    days: '<b>Salidas con potenciómetro:</b> {n} de los últimos 30 días usan la energía de la salida medida por potencia (kJ de Strava ≈ kcal) en vez de la del reloj durante esas horas, porque el reloj no la registró y se queda corto. Solo si sube el día, nunca lo baja.',
  },
  // Nutrición → Balance (client/health.js renderBalance, host #nutri-balance)
  balance: {
    heading: 'Balance',
    winTpl: '{from} – {to} · {days} días registrados',
    intakeLbl: 'Ingesta media',
    burnLbl: 'Gasto medio',
    deficitLbl: 'Déficit / día',
    surplusLbl: 'Superávit / día',
    splitLbl: 'Split de macros',
    splitItem: '{name} {g} g, {pct}%',
    proteinLbl: 'Proteína',
    carbsLbl: 'Carbohidratos',
    fatLbl: 'Grasa',
    empty: 'Aún no hay ingesta registrada suficiente para un balance.',
  },
  runningTable: { dateH: 'Fecha', distH: 'Dist', timeH: 'Tiempo', paceH: 'Ritmo', hrH: 'FC media', reH: 'Esf.', elevH: 'Desn.', powerH: 'Pot.', gctH: 'TCS', oscH: 'Osc.', strideH: 'Zancada' },
  runningNote: 'Tus <b>{count}</b> carreras (más recientes arriba), del reloj y de Strava; los fragmentos del mismo día cuentan como una. Ritmo = tiempo ÷ distancia. Esfuerzo relativo (Esf.) y desnivel solo llegan de Strava; potencia, tiempo de contacto con el suelo (TCS), oscilación vertical y zancada solo de las métricas de carrera del reloj (export de Apple Health) — un guion es un dato que la fuente no registró, nunca un cero. <b>No es una tendencia</b>; mejorar el ritmo al mismo esfuerzo es la señal a vigilar.',
  runningEmptyHtml: '<b>Aún no hay carreras.</b> Aparecen desde los entrenos de carrera del reloj o desde Strava (<code>npm run sync:strava</code>).',
  cyclingTable: { dateH: 'Fecha', distH: 'Dist', timeH: 'Tiempo', elevH: 'Desn.', hrH: 'FC media', reH: 'Esf.', kjH: 'Trabajo' },
  cyclingNote: 'Tus <b>{count}</b> salidas en bici (más recientes arriba). Tiempo = en movimiento (Strava) o duración del entreno (reloj); desnivel positivo, esfuerzo relativo (Esf.) y trabajo en kJ solo llegan de Strava — un guion es un dato que la fuente no registró, nunca un cero. Igual que en carrera: no es una tendencia; compara esfuerzo y FC en rutas parecidas.',
  cyclingEmptyHtml: '<b>Aún no hay salidas en bici.</b> Aparecen desde los entrenos de ciclismo del reloj o desde Strava (<code>npm run sync:strava</code>).',
  sleepCards: {
    nightsTargetLbl: 'noches ≥ {target}',
    sdLbl: 'variación noche a noche',
    bedtimeLbl: 'hora de acostarse',
    wakeLbl: 'hora de despertar',
    stages: { rem: 'sueño REM', deep: 'sueño profundo', core: 'sueño ligero', awake: 'despierto', eff: 'eficiencia del sueño' },
  },
  sleepStagesNoteHtml: '<b>Fases</b> (última noche con fases, del reloj): horas y % del tiempo dormido, frente a la media de las noches con fases de los últimos 30 días. <b>Eficiencia</b> = horas dormidas ÷ tiempo en la cama × 100 (en la cama = del primer al último momento dormido, ampliado con el registro ‘En cama’ del iPhone).',
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
  // Fitness: the fitness-age block (client/health.js, SCORES.fitnessAge from lib/score/fitness-age.mjs)
  fitnessAge: {
    label: 'Fitness age',
    chrono: 'Chronological age',
    trend: 'Fitness age, {days} days',
    unit: 'years',
    younger: { one: '1 year younger', other: '{n} years younger' },
    older: { one: '1 year older', other: '{n} years older' },
    atLeastYounger: 'At least {n} years younger',
    atLeastOlder: 'At least {n} years older',
    same: 'Same as your age',
    basisTpl: 'VO₂max {vo2} ml/kg/min · {date} · {src}',
    ariaTpl: 'Fitness age {fa}, chronological age {ca}: {diff}',
    noSex: 'Fitness age: add "sex": "male" or "female" to profile/profile.json to pick the reference curve.',
    noBirth: 'Fitness age: add your birthdate to profile/profile.json to compare it with your age.',
    noVo2: 'Fitness age: there is no VO₂max reading in the export yet.',
    noteHtml: '<b>Fitness age</b> = the age whose <b>average</b> VO₂max in a healthy reference population equals your latest reading. Reference: Loe H, Rognmo Ø, Saltin B, Wisløff U (2013), “Aerobic Capacity Reference Data in 3816 Healthy Men and Women 20–90 Years”, <i>PLoS ONE</i> 8(5): e64319, Table 2 (doi:10.1371/journal.pone.0064319): the HUNT3 Fitness Study (Norway), treadmill-measured VO₂max, mean per sex and 10-year age group (n = 53–526), interpolated between the group midpoints (25 … 65; 75 for 70+). Outside that range it shows “&lt; 25” or “&gt; 75”. It compares with the <b>mean</b>, not the median: the spread within each age group is wide. Background: the fitness-age concept of Nes et al. (2014), <i>Med Sci Sports Exerc</i> 46(6): 1159–65 (doi:10.1249/MSS.0000000000000219). Your VO₂max is a <b>smartwatch estimate</b>, not a lab test; this is a motivational comparison, not a medical measure.',
  },
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
  // Salud's Energy: expenditure only (the balance lives in Nutrition → Balance)
  energyTdeeNote: '<b>Expenditure only.</b> Active + resting energy from the Apple Watch: the value is the latest day, under it the 30-day average (last {tdeeDays} days) — it runs low on days the watch wasn’t worn. Intake, the deficit and the macro split are in Nutrition → Balance.',
  // Nutrition → Balance when too few recent days carry intake
  balanceNoIntakeNote: {
    main: '<b>Intake can’t be scored:</b> it was logged on too few recent days{lastIntakeClause} to compute a real deficit or macro split. For proven targets, see the nutritionist history in <code>data/nutritionist</code>.',
    lastIntakeClause: ' (last on {date}, {ago})',
  },
  energyRide: {
    latest: 'includes the ride measured by the power meter',
    uncovered: 'power-meter ride not corrected: the watch\'s hourly data is missing',
    uncoveredDays: '<b>Not corrected:</b> {n} of the last 30 days have a power-meter ride that could not be corrected because the watch\'s hourly data is missing (the Shortcut\'s <code>active_energy_hourly</code> key); the watch value stays, probably short.',
    days: '<b>Power-meter rides:</b> {n} of the last 30 days use the ride energy measured by power (Strava kJ ≈ kcal) instead of the watch during those hours, because the watch did not record the ride and under-counts it. Only when it raises the day, never lowers it.',
  },
  // Nutrition → Balance (client/health.js renderBalance, host #nutri-balance)
  balance: {
    heading: 'Balance',
    winTpl: '{from} – {to} · {days} days logged',
    intakeLbl: 'Avg intake',
    burnLbl: 'Avg burn',
    deficitLbl: 'Deficit / day',
    surplusLbl: 'Surplus / day',
    splitLbl: 'Macro split',
    splitItem: '{name} {g} g, {pct}%',
    proteinLbl: 'Protein',
    carbsLbl: 'Carbs',
    fatLbl: 'Fat',
    empty: 'Not enough intake logged yet for a balance.',
  },
  runningTable: { dateH: 'Date', distH: 'Dist', timeH: 'Time', paceH: 'Pace', hrH: 'Avg HR', reH: 'Effort', elevH: 'Elev.', powerH: 'Power', gctH: 'GCT', oscH: 'Osc.', strideH: 'Stride' },
  runningNote: 'Your <b>{count}</b> runs (most recent first), from the watch and from Strava; same-day fragments count as one. Pace = time ÷ distance. Relative effort and elevation come from Strava only; power, ground-contact time (GCT), vertical oscillation and stride only from the watch’s running metrics (Apple Health export) — a dash is a value the source did not record, never a zero. <b>Not a trend</b>; improving pace at the same effort is the signal to watch.',
  runningEmptyHtml: '<b>No runs yet.</b> They appear from the watch’s running workouts or from Strava (<code>npm run sync:strava</code>).',
  cyclingTable: { dateH: 'Date', distH: 'Dist', timeH: 'Time', elevH: 'Elev.', hrH: 'Avg HR', reH: 'Effort', kjH: 'Work' },
  cyclingNote: 'Your <b>{count}</b> rides (most recent first). Time = moving time (Strava) or workout duration (watch); elevation gain, relative effort and work in kJ come from Strava only — a dash is a value the source did not record, never a zero. As with running, this is not a trend; compare effort and HR on similar routes.',
  cyclingEmptyHtml: '<b>No rides yet.</b> They appear from the watch’s cycling workouts or from Strava (<code>npm run sync:strava</code>).',
  sleepCards: {
    nightsTargetLbl: 'nights ≥ {target}',
    sdLbl: 'night-to-night spread',
    bedtimeLbl: 'bedtime',
    wakeLbl: 'wake time',
    stages: { rem: 'REM sleep', deep: 'deep sleep', core: 'core sleep', awake: 'awake', eff: 'sleep efficiency' },
  },
  sleepStagesNoteHtml: '<b>Stages</b> (the newest night with stages, from the watch): hours and % of the time asleep, vs the mean of the nights with stages over the last 30 days. <b>Efficiency</b> = hours asleep ÷ time in bed × 100 (in bed = first to last asleep moment, widened by an iPhone ‘In bed’ record).',
  recoveryNoteHtml: '<b>↓ resting HR, ↑ HRV, ↑ VO₂max and ↓ walking HR</b> are the good directions. Respiratory rate and wrist temperature (sleep only) are recovery/illness signals — watch the change, not the absolute value. For sleep, beyond the average the <b>consistency</b> matters (±h and schedule regularity in minutes): sleeping a similar amount each night recovers better than averaging 7 h across 5- and 9-hour nights.',
  loadSec: { heading: 'Weekly cardiovascular load', hint: 'Index = minutes × mean HR ÷ 100 · only sessions with heart rate (gym, run and bike) · last {weeks} complete weeks.', barTitleTpl: '{date}: load {load}' },
  loadCards: { hrvHighLbl: 'HRV · higher-load weeks', hrvLowLbl: 'HRV · easy weeks', rhrHighLbl: 'resting HR · higher-load', rhrLowLbl: 'resting HR · easy', easyTpl: 'easy weeks {value}' },
  loadNoteHtml: '<b>The view Strava can’t give you:</b> your load crossed with your recovery. <b>Lower HRV and/or higher resting HR in higher-load weeks</b> is expected — your body registers the stimulus. What you watch for is that it <b>rebounds</b> in easy weeks; if it doesn’t, you’re accumulating fatigue. Caveats: HR reflects cardiovascular work: within a gym session it credits the <b>metcon</b> more than the heavy sets (so this is CARDIOVASCULAR load, not total), it’s only a few weeks, and this is <b>association, not causation</b>.',
};
