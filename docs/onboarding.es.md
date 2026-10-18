> [English](onboarding.md) · **Español**

# Entrevista inicial de un usuario nuevo (primera ejecución)

> `CLAUDE.md` conserva solo la comprobación de primera ejecución que apunta aquí. Sigue este flujo cuando `profile/about-me.md` NO existe (solo está la plantilla `.example`):
> el clon es nuevo y el usuario todavía no ha hecho la entrevista inicial. NO intentes un análisis con datos
> vacíos.

La instalación (el servidor desde las imágenes, el clon del coach y su conexión con el servidor, la exportación de
Apple Health, el Atajo, Strava) es la skill `/setup` (`.claude/skills/setup/SKILL.md`), el punto de entrada en un
clon nuevo; cuando el clon del coach está listo, pasa el testigo a este flujo. Este archivo solo cubre la
entrevista de coaching.

**Dos formas de empezar.** Con Claude Code, la entrevista de abajo. Sin él, el propio asistente de la página local
(el servidor; `docs/profile.md` → In-page onboarding, en inglés): un flujo a pantalla completa, una pregunta por
pantalla, que recoge sexo, fecha de nacimiento, altura, peso, actividad, los deportes que practica la persona
(duración de la sesión y veces por semana) y el objetivo, pasa la misma comprobación de seguridad y calcula los
objetivos diarios por tipo de día (`lib/nutrition/energy.mjs`); los guarda junto con los deportes en el servicio de
ingesta y la generación los usa (`loop-data/profile/onboarding.json`): los deportes fijan el ejercicio de cada tipo
de día, qué carreras y nados cuentan como días largos y los nombres que la página muestra para los tipos de día
(`docs/nutrition.md`, en inglés). La página funciona por completo de las dos formas; lo que necesita Claude Code es
el coaching: los informes, los subagentes coach, un agente que registra la comida o planifica las sesiones por ti.
Cuando alguien que empezó con el asistente de la página hace después esta entrevista, lee primero
`loop-data/profile/onboarding.json` (incluidos sus `sports`) y no vuelvas a preguntar lo que ya contiene.

Cuando falta `profile/about-me.md`, tu trabajo es CONSTRUIR el perfil del usuario con él, conversando; no le hagas
rellenar un formulario solo. Reproduce la entrevista inicial de un coach de verdad:

1. **Explica brevemente** lo que vas a hacer: "Antes de poder hacer de coach con datos reales, necesito saber
   quién eres y tomar un punto de partida. Te haré unas preguntas y después escribiré tu perfil por ti. Tus
   respuestas se quedan en local: estos archivos están en `.gitignore`."
2. **Entrevista, no vuelques.** Recorre las secciones de `profile/about-me.example.md` (Basics, Lifestyle, Goal,
   Training, Health context, Nutrition habits, Gear). Pregunta **un tema cada vez**, en pequeños bloques, pide más
   detalle cuando una respuesta sea vaga y sáltate lo que no tenga que ver con su objetivo. No pegues nunca la
   plantilla entera para que la complete.
3. **Escribe el perfil.** A medida que se completan las secciones, escribe las respuestas reales en
   `profile/about-me.md` (créalo; está en `.gitignore`), quitando las indicaciones de la plantilla. NO inventes
   valores; si algo se desconoce, escribe "unknown" o déjalo para más adelante en lugar de adivinarlo.
4. **Toma el punto de partida.** Recorre `profile/baseline.example.md` hacia `profile/baseline.md`. Con servidor,
   el extracto ya está en el clon después de `npm run sync`: saca el peso, la FC en reposo, el VO2máx y la grasa
   corporal de sus CSV en lugar de preguntarlos (si aún no hay exportación → va a la carpeta `files/import/` del
   SERVIDOR y después Sincronizar). Sin servidor, si ya hay un `export.xml` de Apple Health, ofrece ejecutar
   `node data/apple-health/extract.mjs` y saca los mismos números de los CSV en caché en lugar de preguntarlos.
   Marca cada número declarado por la persona o estimado como tal, y anota de qué dispositivo o app sale (la
   grasa corporal por bioimpedancia solo sirve como tendencia, ±3–5 %).
5. **Configura los coaches.** Recorre `profile/coaches.example.md` hacia `profile/coaches.md` (en `.gitignore`):
   idioma de respuesta, país / jurisdicción (límites de los suplementos, base de datos de alimentos) y después,
   por coach (ciclismo, HYROX / híbrido, nutrición, y `training-coach` para cualquier otro deporte que practique:
   su clave **Sports**), las fuentes de conocimiento que quiere (nombre, carpeta dentro de `knowledge/`, cómo
   citarla, vínculos comerciales), su material (con el PDF del manual si lo tiene: con servidor, en la carpeta
   `files/manuals/` del SERVIDOR, que la siguiente sincronización copia en el clon; un archivo puesto solo en el
   clon se conserva pero nunca se publica; sin servidor, en `loop-data/files/manuals/`) y dónde está su programa
   actual. Incluye solo fuentes que ya existan en `knowledge/` o que vaya a incorporar ahora (`knowledge/README.md`);
   no le sugieras ni te inventes nunca creadores. Si aún no hay nada que añadir → escribe solo `## Common`:
   los coaches responden entonces a partir de la base de evidencia y de los datos del usuario, e indican que no
   hay ninguna fuente configurada.
6. **Indícale dónde van sus datos.** Con servidor, sus datos ya están en el clon después de `npm run sync` (README
   → Instalación → Coach; la exportación de Salud va a la carpeta `files/import/` del servidor). Sin servidor,
   explica los pasos para dejar los datos (README → Instalación → Coach sin servidor: exportación de Apple Health →
   `loop-data/files/import/` y después `npm run import:health`; nutrición → el registro de comidas del servidor, o
   notas antiguas en una copia de `food-log.example.md` → `food-log.md`; **entrenamiento → copia
   `data/training/training-data.example.json` → `loop-data/cache/training.json`** y transcribe su programa por
   fecha a partir de lo que le dé su entrenador o su app (cuadrículas en PDF → conviértelas a PNG y léelas
   visualmente; una app de entrenamiento con inicio de sesión → que pegue o haga capturas de las sesiones),
   consulta `docs/training.md` (en inglés); después `npm run generate`; con servidor, en su lugar
   `npm run documents -- push training`, y el servidor reconstruye la página). La pestaña Inicio (Home en inglés)
   muestra entonces la sesión programada de hoy y la pestaña Entreno (Training) se rellena sola con los
   entrenamientos de Apple Health ya extraídos en el paso 4. No bloquees la entrevista inicial por esto: el perfil
   y el punto de partida bastan para empezar.
7. **Confirma y ofrece el primer análisis.** Resume lo que has recogido, pídele que corrija lo que haga falta y
   después ofrécete a hacer un primer análisis (la skill `/analysis`, `.claude/skills/analysis/SKILL.md`).

Aplica los mismos principios de respuesta (`CLAUDE.md` → Output principles) durante la entrevista inicial: basa
todo en lo que te cuente, señala lo que falta y no te inventes nada. Después de la entrevista, guarda un resumen de
la sesión (si hay una herramienta de memoria disponible) para que la siguiente sesión retome su contexto.
