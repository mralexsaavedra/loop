/* Client-side (classic-script) copy for Entreno's 30-day activity calendar and cumulative training
 * time (web/src/client/training-activity.js), baked as I18N_ACTIVITY by tabs/TrainingDetail.astro.
 * JSON-safe only: `{placeholder}` strings, substituted client-side. Modality labels follow the
 * dashboard's (the Watch's `hiit` bucket is shown as Gym). */
export const es = {
  // the Entreno header (tabs/TrainingDetail.astro, built server-side): centred title + an ⓘ with the
  // tab intro and the data caveats that apply to every block
  head: {
    title: 'Entreno',
    info: 'Sobre Entreno',
    intro: 'Tu carga por modalidad, tu actividad, tus sesiones de carrera y bici y cómo responde tu recuperación, desde el reloj y Strava.',
    help: 'Cada tarjeta: el número, una etiqueta y ▲▼ frente a lo habitual; toca para ver su historial. Las notas de cada bloque están tras su ⓘ.',
    caveat: 'Duración, no kcal; días distintos, no registros (el reloj divide una sesión). Las modalidades son las etiquetas automáticas del reloj. Descriptivo, no es consejo médico.',
  },
  calHeading: 'Últimos 30 días',
  calHint: '{days} días con entreno de 30 · el color es el tiempo total del día',
  calAria: 'Calendario de actividad de los últimos 30 días',
  levels: ['Nada', '< 30 min', '30–59 min', '60–89 min', '90+ min'],
  weekdays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  cellTitle: '{date}: {time}',
  cellRest: '{date}: sin entreno',
  cumHeading: 'Tiempo de entreno acumulado',
  cumHint: 'Últimos 30 días frente a los 30 anteriores, día a día.',
  cumAria: 'Tiempo acumulado: {cur} en los últimos 30 días, {prev} en los 30 anteriores',
  cur: 'Últimos 30 días',
  prev: '30 anteriores',
  dayTitle: 'Día {n}: {cur} · antes {prev}',
  staleNote: 'Datos de hace {days} días: las ventanas terminan el {date}.',
  empty: 'Aún no hay entrenos. Aparecen con los entrenos del reloj o desde Strava (<code>npm run sync:strava</code>).',
  modalityLabels: { strength: 'Fuerza', hiit: 'Gimnasio', run: 'Carrera', bike: 'Bici', other: 'Otro' },
  units: { h: 'h', min: 'min' },
  note: 'Días distintos, no registros (el reloj divide una sesión); duración, no kcal. Las modalidades son las etiquetas automáticas del reloj.',
};

export const en = {
  head: {
    title: 'Training',
    info: 'About Training',
    intro: 'Your load per modality, your activity, your runs and rides, and how your recovery responds, from the watch and Strava.',
    help: 'Each card: the number, a label and ▲▼ against your usual; tap it for its history. Each block\'s notes sit behind its ⓘ.',
    caveat: 'Duration, not kcal; distinct days, not records (the watch splits a session). Modalities are the watch\'s auto-labels. Descriptive, not medical advice.',
  },
  calHeading: 'Last 30 days',
  calHint: '{days} training days out of 30 · colour = total time that day',
  calAria: 'Activity calendar for the last 30 days',
  levels: ['None', '< 30 min', '30–59 min', '60–89 min', '90+ min'],
  weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  cellTitle: '{date}: {time}',
  cellRest: '{date}: no training',
  cumHeading: 'Cumulative training time',
  cumHint: 'Last 30 days against the previous 30, day by day.',
  cumAria: 'Cumulative time: {cur} in the last 30 days, {prev} in the previous 30',
  cur: 'Last 30 days',
  prev: 'Previous 30',
  dayTitle: 'Day {n}: {cur} · before {prev}',
  staleNote: 'Data is {days} days old: the windows end on {date}.',
  empty: 'No workouts yet. They appear with Watch workouts or from Strava (<code>npm run sync:strava</code>).',
  modalityLabels: { strength: 'Strength', hiit: 'Gym', run: 'Run', bike: 'Bike', other: 'Other' },
  units: { h: 'h', min: 'min' },
  note: 'Distinct days, not records (the watch splits a session); duration, not kcal. Modalities are the watch’s auto-labels.',
};
