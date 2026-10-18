> [English](your-plan.md) · **Español**

# Haz tuyo el plan

Cómo poner en la página tus propios objetivos de nutrición, comidas, alimentos, objetivo y programa de
entrenamiento. Todo lo que edites aquí es personal y está en `.gitignore`: nunca sale de tu máquina a través de git.

## 1. Elige cómo fijar tus objetivos de partida

Tus objetivos diarios (calorías, proteína, grasa) dependen de tu objetivo y del tipo de día. Hay dos formas de
obtenerlos:

1. **El asistente inicial de la página** (necesita la página local, Nivel 2). Hace una pregunta por pantalla:
   sexo, fecha de nacimiento, altura, peso, actividad, los deportes que practicas (duración de la sesión, veces por
   semana) y tu objetivo. Calcula tus objetivos y los guarda por ti. Consulta [Profile → In-page
   onboarding](../profile.md#in-page-onboarding-no-ai-coach-needed) (en inglés).
2. **Editar tú mismo el archivo del plan** (sección 2, más abajo), o pedírselo a Claude Code.

**Cuál manda:** cuando el asistente ha guardado sus objetivos, sustituyen a los números de `targets.byGoal` de tu
archivo del plan. El resto del archivo del plan (comidas, raciones) se sigue aplicando. Si nunca usas el asistente,
se usan los objetivos del archivo del plan.

## 2. Edita el archivo del plan de nutrición

1. Copia el ejemplo: `data/nutrition/plan-data.example.json` → `loop-data/cache/plan.json` (antes,
   `mkdir -p loop-data/cache`; `loop-data/` es la carpeta en `.gitignore` que guarda tus datos personales).
2. Abre `loop-data/cache/plan.json`. Lo más importante son dos partes.
3. ¿Usas el servicio de datos local? Guarda cada cambio en él con `npm run documents -- push plan`; si no, el
   siguiente `npm run sync` conserva tu cambio pero avisa de que todavía no está en la base de datos ([Owner documents](../data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync), en inglés).

**`targets.byGoal`**: los objetivos diarios por objetivo (`maintain`, `cut`, `bulk`) y por tipo de día:

| Tipo de día | Significado |
| --- | --- |
| `rest` | sin entrenamiento |
| `gym` | una sesión de gimnasio o de carrera, de 1 h aproximadamente |
| `bike` | una salida en bici de unas 2 h |
| `bikeLong` | una salida de más de 2,5 h |

Si hiciste la configuración con el asistente, la página muestra estos tipos de día con los nombres de tus propios
deportes. Cada casilla contiene `kcal`, `p` (proteína, g) y `f` (grasa, g); los hidratos son lo que queda:

```json
"byGoal": {
  "cut": {
    "rest":     { "kcal": 1950, "p": 140, "f": 55 },
    "gym":      { "kcal": 2350, "p": 140, "f": 55 },
    "bike":     { "kcal": 3100, "p": 140, "f": 55 },
    "bikeLong": { "kcal": 3600, "p": 140, "f": 55 }
  }
}
```

**`dayPlan`**: lo que comes: `rest` se usa en los días de descanso y `train` en todos los tipos de día de
entrenamiento. Cada comida enumera sus partes, un alimento de la base de alimentos y una cantidad en la unidad de
ese alimento:

```json
{ "name": "Breakfast", "parts": [
  { "ing": "avena",  "amt": 60,  "label": "Oats", "flex": "carb" },
  { "ing": "claras", "amt": 150, "label": "Egg whites" }
] }
```

La página ajusta las partes marcadas con `"flex": "carb"` para que el día cuadre con tu objetivo de calorías. La
sección `data` contiene de la misma forma las opciones de cada comida (desayunos, proteínas, hidratos...).

3. Cambia un número (un objetivo, un `amt`) y guarda.
4. Ejecuta `npm run check`: valida el plan y te dice qué está mal, sin generar nada.
5. Ejecuta `npm run generate`: reconstruye las tablas y la página (`web/dist/personal/index.html`).

¿Quieres la página en español? Añade `"locale": "es"` a `loop-data/cache/plan.json` y vuelve a generarla.

**No edites nunca los archivos generados** (`data/nutrition/plan-tables.md`, nada de `web/dist/`): el siguiente
`npm run generate` los sobrescribe. Cambia `loop-data/cache/plan.json` y vuelve a generar.

## 3. Alimentos

- **La base de alimentos incluida** es `data/nutrition/ingredients.json` (versionada, compartida). Cada clave `ing`
  de tu plan tiene que existir ahí. Cada alimento tiene sus macros por 100 g / ml o por unidad:

  ```json
  "gambas": { "per": 100, "unit": "g", "verified": true,
    "name": { "es": "Gamba pelada cruda (Hacendado, agua añadida)", "en": "Raw peeled prawns (Hacendado, added water)" },
    "k": 72, "p": 16, "c": 0.4, "g": 0.5 }
  ```

  `k` = kcal, `p` = proteína, `c` = hidratos, `g` = grasa. Para corregir los macros de un alimento, edítalo aquí y
  vuelve a generar.
- **Tus propios productos y recetas** viven en el registro de comidas de la página local, no en un archivo: añade un
  producto a partir de su etiqueta (o de Open Food Facts), crea una receta con tus productos y registra lo que
  comes. Los alimentos de la base también aparecen ahí como básicos ya preparados. Consulta
  [Food log](../nutrition-food-log.md) (en inglés).

## 4. Objetivo y peso objetivo

1. Abre la ficha de perfil (el botón del avatar) en la página y elige tu objetivo: mantener, bajar (definición) o
   ganar (volumen). La página cambia sus objetivos al momento.
2. En la página local también puedes fijar un peso objetivo; los dos se guardan en el servidor.
3. `npm run sync` los copia en `loop-data/profile/settings.json`, que Claude lee para sus análisis.

¿Sin servidor? Crea tú mismo `loop-data/profile/settings.json`:

```json
{ "goal": "cut", "targetWeightKg": 70 }
```

## 5. El plan de entrenamiento

1. Copia `data/training/training-data.example.json` → `loop-data/cache/training.json` (opcional: sin él, la página
   simplemente no muestra ninguna sesión programada). Con el servicio de datos local, guarda cada cambio con
   `npm run documents -- push training` ([Owner documents](../data-pipeline.md#owner-documents-scriptssync-documentsmjs-first-step-of-npm-run-sync), en inglés).
2. Añade una entrada por fecha (`YYYY-MM-DD`). `kind` es `gym`, `run` o `bike`; `durationMin` es opcional
   (minutos); `focus` es una etiqueta corta; `blocks` contiene la sesión:

   ```json
   "days": {
     "2026-01-05": {
       "kind": "gym",
       "focus": "Squat + metcon",
       "blocks": [ { "label": "A", "title": "BACK SQUAT EVERY 3' × 5", "lines": ["3 reps @ RPE7"] } ]
     }
   }
   ```

3. Ejecuta `npm run check` y después `npm run generate`.

Qué hace la página con él: muestra la sesión programada de hoy y la usa para elegir el tipo de día de tus objetivos
de nutrición. Una sesión de bici fija el día según su duración (75 min o más = `bike`, 150 min o más =
`bikeLong`); un entrenamiento que registres de verdad puede subirlo. Una fecha sin entrada es un día de descanso.

¿Tienes el PDF de un entrenador o las sesiones de una app? Claude Code puede transcribirlas (ver más abajo).

## 6. Con Claude Code

Abre `claude` en la carpeta del repositorio y pídelo sin más:

- "Baja a 1900 las calorías de mis días de descanso en definición y vuelve a generar."
- "Transcribe esta semana de `loop-data/files/documents/training/my-program.pdf` a loop-data/cache/training.json."
- "Registra 200 g de pechuga de pollo en la comida": la skill `/food-log` lo registra en el registro de comidas de
  la página local.
- "Añade este producto a partir de la etiqueta" (con una foto): también `/food-log`.

## Cómo está hecho

Documentación técnica (en inglés):

- [Nutrition plan pipeline](../nutrition.md)
- [Training](../training.md)
- [Food log, products, recipes](../nutrition-food-log.md)
