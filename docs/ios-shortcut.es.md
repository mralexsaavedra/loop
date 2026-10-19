> [English](ios-shortcut.md) · **Español**

# Atajo de iOS: enviar los datos de Apple Health al panel

Un Atajo personal de iOS lee las muestras recientes de Apple Health y las envía con POST, como un único objeto
JSON, a tu propio servidor LOOP (su servicio de datos, `loop-server`; `loop-ingest` en modo host). La siguiente
sincronización del servidor las incorpora a los CSV del extracto, así que la página se mantiene al día entre
exportaciones completas de Apple Health.

Los nombres de la interfaz de iOS aparecen en español tal como los muestra iOS (el Atajo ya hecho usa la interfaz
en español); los que esta guía no tiene confirmados en español se dejan en cursiva con su nombre de la interfaz en
inglés. Los tipos de métrica de *Buscar muestras médicas* (*Heart Rate Variability*, *Weight*…) aparecen en inglés
aunque el iPhone esté en español, así que la guía los nombra en inglés.

## Camino rápido

1. Ten el servidor LOOP en marcha ([`README.es.md` → Instalación → Servidor](../README.es.md#servidor--la-página-el-registro-de-comidas-y-la-sincronización-del-iphone-docker-sin-clonar);
   modo host: [`services/loop-web/README.md` → Install](../services/loop-web/README.md#install-host), en inglés).
2. Importa el Atajo ya hecho (más abajo) y apúntalo a tu servidor, o créalo tú mismo (*Crear el Atajo*).
3. Añade una automatización personal que lo ejecute al abrir una app que uses todos los días.
4. Nada más: el último paso del Atajo pide al servidor que reconstruya la página (también se reconstruye cada
   hora). Un clon del coach recibe los datos nuevos con `npm run sync`.

Las filas de la exportación siempre ganan: las filas del Atajo solo rellenan las fechas que tu último `export.xml`
no cubre.

## Adónde envía el móvil los datos

Elige una. Las dos pasan por loop-web, que solo reenvía al servicio de ingesta las dos rutas que necesita el Atajo
(`POST /ingest/health-auto-export` y `POST /api/sync`).

| Opción | URL en el Atajo | Funciona | Necesitas |
| --- | --- | --- | --- |
| **A. Solo con la wifi de casa (empieza por aquí)** | `http://<server-ip>:8090` | Cuando el móvil está en la wifi de casa | Nada más: el servidor tal como está instalado |
| **B. Desde cualquier sitio** | `https://<your-host>` | Siempre | Un dominio y un túnel HTTPS o un proxy inverso delante de loop-web ([`services/loop-web/README.md` → Exposing behind an SSO tunnel](../services/loop-web/README.md#exposing-behind-an-sso-tunnel), en inglés) |

**La opción A es suficiente para la mayoría.** Cada envío cubre los últimos 1–30 días (consulta *Ventana* en la
tabla de claves), así que un día fuera de casa se rellena la siguiente vez que la automatización se ejecuta en
casa. La contrapartida: el token viaja sin cifrar por tu propia wifi (HTTP simple). Úsala solo en una red de
confianza, y pasa a la opción B si quieres sincronizar fuera de casa. Averigua la IP del servidor con
`hostname -I` en el servidor, y dale una IP fija en tu router para que el Atajo siga funcionando.

## Instalar el Atajo ya hecho

En lugar de crearlo desde cero, importa la copia del autor:
**[Salud → servidor (enlace de iCloud)](https://www.icloud.com/shortcuts/ceb66eea36fc434a9d2f910421dd18aa)**.
Tiene configuradas todas las claves de la tabla de abajo (interfaz en español, nombre de automatización
`atajo-salud`). Después de importarlo, edita esto antes de la primera ejecución:

1. **Paso 4** (*Obtener contenido de URL*, el POST):
   - URL: sustituye `https://TU-SERVIDOR` por tu dirección de la tabla de arriba, manteniendo la ruta:
     `http://192.168.1.50:8090/ingest/health-auto-export` (opción A) o
     `https://<your-host>/ingest/health-auto-export` (opción B).
   - Cabecera `Authorization`: sustituye `TU_TOKEN` en `Bearer TU_TOKEN` por tu `INGEST_TOKEN`
     (`grep '^INGEST_TOKEN=' .env` en la carpeta del servidor, en modo host `services/loop-ingest/.env`; cópialo en
     tu propia pantalla).
2. **Paso 5** (la actualización): la misma dirección, ruta `/api/sync`.
3. **Los filtros *Origen es*** nombran los dispositivos del autor; pon los tuyos:
   - 8 búsquedas filtradas por el reloj (*Apple Watch de …*): `steps_watch`, `active_energy`,
     `active_energy_hourly`, `basal_energy`, `exercise_watch`, `distance_watch`, `flights_watch`, `hr_t`/`hr_v`;
   - 1 búsqueda filtrada por el iPhone (*iPhone de …*): `steps_phone`.

   Un filtro que se quede en un dispositivo que no tienes no devuelve nada, así que esa clave llega vacía (sin
   error).

**¿Sin Apple Watch?** La VFC, la frecuencia cardiaca en reposo, las fases del sueño, la temperatura de la muñeca,
la frecuencia respiratoria y las muestras de frecuencia cardiaca salen todas del reloj, así que la recuperación, el
sueño y el estrés se quedan vacíos. Conserva las claves del iPhone y de la báscula (`steps_phone`, `weight`,
`bodyfat`, `leanmass`, `waist`) y borra las búsquedas filtradas por el reloj; otros wearables que escriben en Apple
Health solo funcionan si apuntas los filtros a ellos.

**¿Otro reloj o pulsera (Xiaomi, Garmin, Amazfit, Huawei…)?** Funciona a través de Apple Health si su app escribe
allí:
1. En la app del reloj, activa la escritura en Apple Health y elige los datos (Mi Fitness: sus ajustes de datos de
   terceros → Salud; Garmin Connect, Zepp y Huawei Health tienen el mismo interruptor). Después comprueba la app en
   Salud → tu foto → *Apps*.
2. En el Atajo, apunta cada búsqueda filtrada por el reloj (*Origen es*, las 8 de arriba) a esa app en lugar de a
   *Apple Watch de …* (p. ej. *Mi Fitness*). Las claves sin filtro (`sleep`, `rhr`, `hrv`, `respiratory`,
   `walking_hr`, …) no necesitan nada: leen lo que escriba cualquiera.
3. **Quita las búsquedas de las métricas que tu dispositivo nunca escribe.** Una *Buscar muestras médicas* que no
   encuentra nada detiene todo el Atajo con "No se ha encontrado ninguna muestra", así que no se envía nada.
   Comprueba lo que escribe la app en Salud → tu foto → *Apps* → la app → *Datos*, y borra cada bloque de búsqueda
   (y su campo JSON) de un tipo que no escriba. Mi Fitness, por ejemplo, no escribe ni VFC ni frecuencia cardiaca
   en reposo: borra los bloques `hrv` y `rhr`; conserva `sleep` y las muestras de frecuencia cardiaca (`hr_t` /
   `hr_v`), y apunta esa búsqueda de frecuencia cardiaca (*Origen es*) a la app de la pulsera (p. ej. Mi Fitness)
   en lugar de a un reloj.
4. Espera menos que con un Apple Watch: los pasos, la energía, la frecuencia cardiaca y el sueño suelen llegar; la
   VFC, la temperatura de la muñeca, la frecuencia respiratoria y las fases del sueño dependen del dispositivo y de
   su app. Una pulsera que solo escribe el sueño "en cama" obtiene noches ESTIMADAS (el tiempo en cama, señalado en
   la página; solo desde la exportación de Apple Health), y una sin frecuencia cardiaca en reposo la obtiene
   calculada a partir de la frecuencia cardiaca de la noche: desde la exportación, y desde los `hr_t` / `hr_v` de
   este Atajo siempre que el Atajo no envíe `rhr`
   ([`docs/data-pipeline.md` → Resting HR](data-pipeline.md#apple-health-export-and-extract), en inglés). Sin VFC,
   la puntuación de recuperación es parcial (frecuencia cardiaca en reposo y sueño) y lo indica; el estrés se queda
   vacío o parcial.

**Ejemplo: una pulsera Xiaomi a través de Mi Fitness.** Mi Fitness escribe la frecuencia cardiaca en bloques
horarios y el sueño solo como "en cama": sin VFC, sin frecuencia cardiaca en reposo, sin VO2 máx. Partiendo del
Atajo ya hecho, una segunda instalación para una persona con Mi Fitness lo cambió así:

| Cambio | Bloques |
| --- | --- |
| Borrar (Mi Fitness nunca los escribe, así que cada uno detiene la ejecución) | VFC, frecuencia cardiaca en reposo, VO2 máx., frecuencia respiratoria, temperatura de la muñeca durante el sueño, media de frecuencia cardiaca al caminar, recuperación de la frecuencia cardiaca, tiempo de ejercicio; el contorno de cintura (sin cinta métrica registrada); los cuatro bloques de alimentación (energía, proteína, hidratos y grasa de la dieta: la comida se registra en LOOP, no en Salud); los bloques de distancia y de pisos filtrados por el Apple Watch |
| Cambiar el filtro *Origen es* de *Apple Watch de …* a **Mi Fitness** | pasos (la búsqueda filtrada por el reloj) y energía activa; la búsqueda de frecuencia cardiaca (`hr_t` / `hr_v`), para que el servidor calcule a partir de ella la frecuencia cardiaca en reposo |
| Dejar tal cual | pasos del iPhone, energía basal, peso, grasa corporal y masa magra (una báscula inteligente), frecuencia cardiaca, sueño |

Una métrica que la pulsera solo escribe de vez en cuando (Mi Fitness escribió la distancia dos veces en meses)
también es mejor borrarla: la ejecución se detiene cada día que falta.

La exportación de Apple Health (`data/apple-health/extract.mjs`) no necesita cambios: los pasos, el ejercicio y el
sueño toman el valor más alto entre las fuentes, y la energía elige una fuente por día
([`docs/data-pipeline.md` → Energy source precedence](data-pipeline.md#energy-source-precedence), en inglés).

Después añade la automatización personal (*Automatización* → *Crear automatización personal* → *App* → elige una
app que abras todos los días → *Ejecutar inmediatamente* → este Atajo): las automatizaciones no se comparten con el
Atajo.

## Requisitos previos (si lo creas tú)

| Necesitas | De dónde sale |
|----------|---------------------|
| El servidor LOOP en marcha | [`README.es.md` → Instalación → Servidor](../README.es.md#servidor--la-página-el-registro-de-comidas-y-la-sincronización-del-iphone-docker-sin-clonar) (modo host: [`services/loop-web/README.md` → Install](../services/loop-web/README.md#install-host), en inglés) |
| La dirección | *Adónde envía el móvil los datos*, arriba |
| El token bearer | `INGEST_TOKEN` en el `.env` del servidor (lo genera la instalación; modo host: `services/loop-ingest/.env`) |
| Un nombre de automatización | Cualquier etiqueta. La sincronización lee los envíos de `SHORTCUT_AUTOMATION` (por defecto `atajo-salud`), así que usa ese valor o pon tu nombre en esa variable de entorno |

No dejes que el token aparezca en capturas de pantalla ni en Atajos compartidos. Cualquiera que lo tenga puede
escribir en tu servicio de ingesta.

## Crear el Atajo

Repite los pasos 1 a 3 para cada clave que quieras (consulta la tabla de claves). Los pasos 4 y 5 se ejecutan una
sola vez, al final.

1. **Buscar muestras médicas** donde *Tipo* es la métrica (p. ej. *Heart Rate Variability*).
   - *Fecha de inicio está entre los/as últimos/as* N días (consulta "Ventana" en la tabla).
   - Claves marcadas con **Agrupar por día**: pon *Agrupar por* en *Día*.
   - Claves marcadas con **filtrar por origen**: añade *Origen es* el dispositivo (consulta los problemas
     frecuentes).
2. **Repetir con cada ítem en** *Muestras médicas* y, dentro, una acción **Texto** con una línea en el
   formato de la clave, construida con las propiedades de la muestra:
   - *Fecha de inicio*, con formato **ISO 8601** con hora (p. ej. `2030-01-02T08:00:00+01:00`).
   - *Valor* (el número, no *Nombre*).
   - *Origen* solo en las claves que llevan un tercer campo.
   - Solo el sueño: *End Date* (ISO 8601) y el *Valor* de la muestra (la fase, p. ej. `Core`).
3. Después de **Terminar repetición**, **Combinar texto** (*Repeat Results*) con **Saltos de línea**. Esa cadena es el
   valor de la clave.
4. **Obtener contenido de URL**:
   - URL: `<your address>/ingest/health-auto-export` (`http://<server-ip>:8090` o `https://<your-host>`, consulta *Adónde envía el móvil los datos*)
   - Método: `POST`
   - Cabeceras: `Authorization` = `Bearer <INGEST_TOKEN>`, `Automation-Name` = `atajo-salud`
     (o tu `SHORTCUT_AUTOMATION`)
   - Cuerpo de la solicitud: **JSON**, un campo *Texto* por clave, con el texto combinado del paso 3.

El servicio responde `202` con el id de la fila guardada. Un `401` significa que el token no coincide.

5. **Obtener contenido de URL**, justo después del paso 4:
   - URL: `<your address>/api/sync`
   - Método: `POST`
   - Sin cabeceras ni cuerpo.

   Esto solo **lanza una actualización**: el servicio de ingesta trae Strava y el equipo reconstruye la página del
   plan (consulta `services/loop-web/README.md`), así que la página muestra lo que acabas de enviar en uno o dos
   minutos en lugar de en la siguiente ejecución horaria. No envía ni devuelve datos de salud (solo un número de
   secuencia), no necesita token y nunca se niega: una llamada dentro del minuto siguiente a la última
   actualización deja en cola UNA actualización más al final de ese minuto (`"coalesced": true, "deferred": true`),
   así que los datos que acabas de enviar nunca se saltan. Omite este paso si no usas `services/loop-web`.

   Los dos pasos pasan por loop-web (`/ingest/health-auto-export` y `/api/sync`); el propio servicio de ingesta
   nunca se expone (consulta `services/loop-ingest/README.md`, modelo de exposición).

### A través de loop-web (sin exponer la ingesta)

Las dos opciones de arriba ya pasan por loop-web. Para la opción B (entrada pública detrás de un túnel con SSO),
apunta los dos pasos al host de loop-web:

- paso 4: `https://<your-host>/ingest/health-auto-export` (las mismas cabeceras; loop-web reenvía
  `Authorization` y `Automation-Name`, y la ingesta sigue comprobando el token)
- paso 5: `https://<your-host>/api/sync` (no `/sync`)

Detrás de un proxy con SSO, desactiva la autenticación exactamente para esas dos rutas (`/ingest/*` y `/api/sync`);
todo lo demás (la página, el registro de comidas) sigue detrás del inicio de sesión. La regla de `/api/sync` debe
ser una coincidencia EXACTA de ruta, no un prefijo. Tras configurarlo, comprueba desde fuera de la red local que
`https://<your-host>/ingest/%2e%2e/status.json` y `https://<your-host>/ingest/../status.json`
(`curl --path-as-is`) NO devuelven el archivo (`400` o la redirección del SSO): loop-web rechaza los segmentos de
punto y las barras codificadas en la ruta sin procesar. `INGEST_TOKEN` también protege `/export/*`, así que
mantenlo en al menos 32 bytes aleatorios y fuera de las capturas de pantalla. De las rutas de ingesta, loop-web
solo reenvía `POST /ingest/health-auto-export` (cualquier otra ruta `/ingest/*` da 404) y nunca `/export/*`. No
expongas nunca el puerto de ingesta a internet (solo escucha en la red local para que loop-web pueda llegar a él).
Configuración: `services/loop-web/README.md`, "Exposing behind an SSO tunnel" (en inglés).

Ejemplo de cuerpo (se muestran dos líneas por clave):

```json
{
  "hrv":         "2030-01-02T08:00:00+01:00;42.1\n2030-01-02T14:10:00+01:00;47.8",
  "bodyfat":     "2030-01-02T07:00:00+01:00;18.4;My Scale",
  "steps_watch": "2030-01-01T00:00:00+01:00;9120\n2030-01-02T00:00:00+01:00;4310",
  "diet_kcal":   "2030-01-01T00:00:00+01:00;2240\n2030-01-02T00:00:00+01:00;1180",
  "sleep":       "2030-01-01T23:30:00+01:00;2030-01-02T01:00:00+01:00;Core"
}
```

## Claves de los datos enviados

Todas las claves son opcionales: envía solo lo que registres. Formatos: **punto** = `ISO;value[;source]`,
**total diario** = `ISO;value` (una línea por día), **total horario** = `ISO;value` (una línea por hora de reloj),
**muestras** = `ISO;value` (una línea por muestra en bruto, sin agrupar), **sueño** = `ISO-start;ISO-end;stage`.
Se aceptan comas decimales (`42,1`).

| Clave | Tipo de Salud (interfaz en inglés) | Formato | Agrupar por día | Source / Origen | Ventana | Escribe |
|-----|--------------------------|--------|:------------:|-----------------|--------|--------|
| `hrv` | Heart Rate Variability | punto | no | no | 7 días | `hrv.csv` |
| `rhr` | Resting Heart Rate | punto | no | no | 7 días | `rhr.csv` |
| `vo2max` | Cardio Fitness (VO₂ max) | punto | no | no | 30 días | `vo2max.csv` |
| `weight` | Weight | punto | no | 3.er campo opcional (la báscula) | 30 días | `weight.csv` |
| `bodyfat` | Body Fat Percentage | punto | no | **sí**, 3.er campo (la báscula) | 30 días | `bodyfat.csv` |
| `leanmass` | Lean Body Mass | punto | no | **sí**, 3.er campo (la báscula) | 30 días | `leanmass.csv` |
| `waist` | Waist Circumference; envíala en centímetros | punto | no | no | 90 días | `waist.csv` |
| `wrist_temp` | Sleeping Wrist Temperature | punto | no | no | 7 días | `wristTemp.csv` |
| `hr_recovery` | Cardio Recovery | punto | no | no | 7 días | `hr-recovery.csv` |
| `steps_watch` | Steps, *Origen es* tu reloj | total diario | **sí** | **filtrar** por origen | 8 días | `steps-daily.csv` |
| `steps_phone` | Steps, *Origen es* tu iPhone | total diario | **sí** | **filtrar** por origen | 8 días | `steps-daily.csv` |
| `active_energy` | Active Energy (iOS 26: *Active Calories*), *Origen es* tu reloj | total diario | **sí** | **filtrar** por origen | 8 días | `active-energy-daily.csv` |
| `active_energy_hourly` | Active Energy, *Origen es* tu reloj | total horario | no: **agrupar por hora** | **filtrar** por origen | 3 días | `active-energy-hourly.csv` |
| `basal_energy` | Resting Energy (iOS 26: *Resting Calories*), *Origen es* tu reloj | total diario | **sí** | **filtrar** por origen | 8 días | `basal-energy-daily.csv` |
| `exercise_watch` | Exercise Minutes (Apple Exercise Time), *Origen es* tu reloj | total diario (minutos) | **sí** | **filtrar** por origen | 8 días | `exercise-minutes-daily.csv` |
| `distance_watch` | Walking + Running Distance, *Origen es* tu reloj | total diario (km) | **sí** | **filtrar** por origen | 8 días | `distance-daily.csv` |
| `flights_watch` | Flights Climbed, *Origen es* tu reloj | total diario | **sí** | **filtrar** por origen | 8 días | `flights-daily.csv` |
| `respiratory` | Respiratory Rate | total diario (media) | **sí** | no | 8 días | `respiratory-daily.csv` |
| `walking_hr` | Walking Heart Rate Average | total diario (media) | **sí** | no | 8 días | `walking-hr-daily.csv` |
| `diet_kcal` | Dietary Energy | total diario | **sí** | no | 8 días | `dietary-daily.csv` (kcal) |
| `diet_protein` | Protein | total diario | **sí** | no | 8 días | `dietary-daily.csv` (protein_g) |
| `diet_carbs` | Carbohydrates | total diario | **sí** | no | 8 días | `dietary-daily.csv` (carbs_g) |
| `diet_fat` | Total Fat | total diario | **sí** | no | 8 días | `dietary-daily.csv` (fat_g) |
| `sleep` | Sleep (Sleep Analysis); conserva TODAS las fases en la búsqueda, incluidas Awake e In Bed (In Bed sale del iPhone) | sueño | no | no | 3 días | `sleep-daily.csv` |
| `hr_t` | Heart Rate, *Origen es* tu reloj (una pulsera: su app, p. ej. Mi Fitness) | muestras: las fechas de inicio (ISO 8601), una por línea | no: **sin agrupar** | **filtrar** por origen | 1 día | `hr-hourly.csv` |
| `hr_v` | la misma búsqueda | muestras: los valores (lpm), en el mismo orden de líneas que `hr_t` | no: **sin agrupar** | **filtrar** por origen | 1 día | `hr-hourly.csv` |
| `hr_samples` | la misma búsqueda (alternativa antigua, con bucle, a `hr_t` + `hr_v`) | muestras (`ISO;bpm`) | no: **sin agrupar** | **filtrar** por origen | 1 día | `hr-hourly.csv` |

Qué hace la sincronización con los datos: las filas de la exportación ganan y las filas del Atajo rellenan las
demás fechas; los totales diarios descartan el día más antiguo de cada envío (que es parcial) y gana el envío más
reciente; los pasos se quedan con el máximo entre el reloj y el móvil; un peso con hora exactamente a medianoche y
sin una muestra de grasa corporal cerca se descarta como entrada fantasma; las muestras de frecuencia cardiaca solo
llegan al CSV como agregados por hora. Todas las reglas, por forma de clave:
[`docs/data-pipeline.md` → Shortcut merge into the extract](data-pipeline.md#shortcut-merge-into-the-extract) (en inglés).

### Crear `active_energy_hourly`

Duplica tu búsqueda de `active_energy` y cambia solo la agrupación:

1. **Buscar muestras médicas**: *Tipo* Active Energy (iOS 26: *Active Calories*), *Origen es* tu reloj (el mismo
   filtro que `active_energy`), *Fecha de inicio está entre los/as últimos/as* **3 días**, *Agrupar por* **Hora** (no Día).
2. **Repetir con cada** → **Texto** `<Start Date ISO 8601>;<Value>` y después **Combinar texto** con saltos de
   línea, como cualquier otra clave.
3. Añade al cuerpo del POST un campo JSON `active_energy_hourly` con ese texto.

3 días × 24 horas son como mucho unas 72 líneas, así que apenas aumenta el tamaño del envío. Después de añadirlo,
ejecuta una vez `npm run sync -- --full` (o solo la parte del Atajo, `npm run sync:shortcut -- --full`; consulta
Comprobación).

### Crear `hr_t` y `hr_v` (muestras de frecuencia cardiaca)

Un día son unos cientos de muestras, y miles en un día de entrenamiento (el reloj toma una muestra cada pocos
segundos mientras registra uno), así que crea esta clave **sin bucle**: dos listas sacadas directamente del
resultado de la búsqueda, que la sincronización empareja por número de línea.

1. **Buscar muestras médicas**: *Tipo* **Heart Rate**, *Origen es* tu reloj (una pulsera: su app, p. ej.
   **Mi Fitness**), *Fecha de inicio está entre los/as últimos/as* **1 día**, **sin** *Agrupar por* (muestras en bruto).
2. **Texto** con la variable mágica **Muestras médicas**; tócala y elige la propiedad **Fecha de inicio**,
   *Formato de fecha* **ISO 8601**. Después **Combinar texto** con **Saltos de línea**. Añade ese texto al cuerpo
   del POST como el campo JSON `hr_t`.
3. **Texto** con la variable mágica **Muestras médicas** › **Valor**, y después **Combinar texto** con **Saltos
   de línea**. Añádelo como el campo JSON `hr_v`. Una unidad tras el número (`72 count/min`, `72 lpm`) no es
   problema.

Las dos listas salen de la misma búsqueda, así que siempre tienen la misma longitud y el mismo orden. La receta
antigua (**Repetir con cada** → **Texto** `<Start Date ISO 8601>;<Value>` → **Combinar texto** → campo
`hr_samples`) se sigue aceptando, pero hace una vuelta del bucle por muestra y es muy lenta los días de
entrenamiento. Un día de entrenamiento de unas 5.000 muestras son aproximadamente 150 KB de `hr_t` más 25 KB de
`hr_v`, muy por debajo de los 8 MB que acepta loop-web en esa ruta (el `MAX_BODY_BYTES` de la propia ingesta
también es de 8 MB por defecto). La ventana de 1 día se solapa a propósito entre ejecuciones: la sincronización
elimina duplicados por marca de tiempo (se conservan los varios registros de una pulsera con la misma hora), así
que nada se cuenta dos veces y una ejecución perdida no deja huecos siempre que la siguiente llegue en menos de un
día. Después de añadirla, ejecuta una vez `npm run sync -- --full`.

### Crear `exercise_watch`, `distance_watch` y `flights_watch`

Tres búsquedas, cada una una copia de tu búsqueda de `steps_watch` con otro tipo:

1. **Buscar muestras médicas**: *Tipo* **Exercise Minutes**, **Walking + Running Distance** o **Flights
   Climbed**; *Origen es* tu reloj; *Fecha de inicio está entre los/as últimos/as* **8 días**; *Agrupar por* **Día**.
2. **Repetir con cada** → **Texto** `<Start Date ISO 8601>;<Value>` y después **Combinar texto** con saltos de
   línea.
3. Añade al cuerpo del POST los campos JSON `exercise_watch`, `distance_watch` y `flights_watch`. Deja la unidad de
   distancia en kilómetros en la app Salud (o envía el valor con `m` / `mi`).

Después ejecuta una vez `npm run sync -- --full`.

## Problemas frecuentes

| Síntoma | Causa y solución |
|---------|---------------|
| La energía en reposo o activa sale demasiado alta un día (p. ej. 3.600 kcal en reposo) | Una búsqueda agrupada por día suma todas las fuentes, mientras que la app Salud muestra una fuente por periodo. Filtra las búsquedas de `basal_energy` y `active_energy` por tu reloj (*Origen es*). El siguiente envío reescribe los días afectados. |
| Los pasos parecen duplicados | Una búsqueda de *Steps* agrupada por día suma iPhone + reloj. Usa dos búsquedas filtradas por origen, enviadas como `steps_watch` y `steps_phone`. La antigua clave combinada `steps` se ignora a propósito. |
| Una búsqueda con dos filtros *Origen es* no devuelve nada | Varios filtros en una búsqueda se combinan con **Y**, nunca con O. Una búsqueda por dispositivo. |
| La columna del valor contiene texto como `18,4 %` o `70 kg` | Usaste el *Nombre* de la muestra, que es el valor con formato. Usa *Valor* para el número; *Origen* es el dispositivo o la app. |
| No aparece el tipo `vo2max` en la lista | Salud lo llama *Capacidad aeróbica* (*Cardio Fitness* en inglés). |
| Falta una clave en los datos enviados | Normal: una consulta sin resultados produce un texto vacío, y las claves vacías se omiten. |
| El Atajo se detiene con "No se ha encontrado ninguna muestra" | Una *Buscar muestras médicas* de un tipo que tu dispositivo nunca escribe no encontró nada, y la acción siguiente detiene la ejecución, así que no se envía nada. Borra ese bloque de búsqueda y su campo JSON (con un reloj o pulsera que no sea un Apple Watch: normalmente la VFC y la frecuencia cardiaca en reposo; consulta [Otro reloj o pulsera](#instalar-el-atajo-ya-hecho) y [Solución de problemas](#solución-de-problemas)). |
| La automatización se ejecuta pero no envía nada | Los datos de Salud están bloqueados mientras el móvil está bloqueado, así que un disparador por hora del día por la noche no encuentra muestras. Actívala al **abrir una app** que uses a diario (con *Ejecutar inmediatamente*), que solo se dispara con el móvil desbloqueado. |
| Días antiguos cambian después de una sincronización | Es lo esperado: el envío más reciente corrige los totales diarios, y las filas de la exportación sustituyen a las del Atajo cuando un `export.xml` nuevo cubre esas fechas. |

## Solución de problemas

Errores que muestra el iPhone mientras se ejecuta el Atajo. Los textos entre comillas son los de la interfaz de iOS
en español, tal como los muestra el Atajo ya hecho; las etiquetas en inglés van entre paréntesis.

**"Puedes permitir su ejecución en Ajustes"** en *Obtener contenido de* (*Get Contents of URL*): iOS bloqueó el
envío, no el servidor (no le llega nada). Permítelo en tres sitios y vuelve a ejecutar el Atajo:

1. **Envíos grandes**: *Ajustes* → *Apps* → *Atajos* → *Avanzado* → activa **"Permitir compartir grandes cantidades
   de datos"** (Settings → Apps → Shortcuts → Advanced → Allow Sharing Large Amounts of Data). Un envío con una
   semana de muestras de frecuencia cardiaca es lo bastante grande como para necesitarlo.
2. **La dirección del servidor, para cada Atajo**: en el Atajo, toca ⓘ → *Privacidad* (Privacy) y permite la
   dirección de tu servidor (p. ej. `192.168.1.50`), o toca *Restablecer privacidad* (Reset Privacy) para que iOS
   vuelva a preguntar en la siguiente ejecución; después responde **"Permitir siempre"** (Always Allow).
3. **Acceso a Salud**: *Salud* (Health) → tu foto → *Apps* → *Atajos* (Shortcuts) → activa todas las categorías
   que lee el Atajo.

**"No se ha encontrado ninguna muestra"** (No samples found): una búsqueda de un tipo que tu dispositivo nunca
escribe no encontró nada y detuvo la ejecución, así que no se envió nada. Borra ese bloque y su campo JSON
([Otro reloj o pulsera](#instalar-el-atajo-ya-hecho), con el ejemplo de Mi Fitness).

**El envío responde `401`** (el servidor registra `"event":"unauthorized"` con el motivo `invalid`): la cabecera
`Authorization` lleva el token de otra instalación, o una errata. Vuelve a copiar `INGEST_TOKEN` del `.env` de ese
servidor y mantén la forma `Bearer <token>`. En un equipo con dos instalaciones, cada una tiene su propio token y
su propio puerto.

## Comprobación

En el servidor, `lastShortcutAt` cambia tras cada ejecución, y el punto de frescura de la página muestra "Atajo"
con unos minutos de antigüedad:

```bash
curl -s localhost:8088/sync/status
```

En un clon del coach de un servidor LOOP (las imágenes Docker), `npm run sync` imprime `Client mode: ...` y la
línea `Mirror: ...`: la propia actualización del servidor procesó los envíos, así que las filas nuevas aparecen en
la página del servidor y en el `/sync/status` de arriba, y el espejo copia el extracto actualizado en el clon.

En modo host (desarrollo / heredado) o en un clon sin servidor:

```bash
npm run sync        # prints rows added per key; exits non-zero if the service is unreachable
npm run generate    # rebuilds the page (host mode / local only)
```

`loop-data/extract/_meta.json` → `shortcutSync.owned` enumera, por CSV, cada fecha que escribió la sincronización.
`npm run sync -- --full` reconstruye la caché local de muestras a partir de todos los envíos guardados.

**Después de añadir claves nuevas** (p. ej. `waist`, `diet_*`): ejecuta una vez `npm run sync -- --full`. La
sincronización incremental solo procesa los envíos más recientes que la caché, así que las claves que ya estaban en
envíos en caché solo se recogen con una reconstrucción completa. Para el desnivel de Strava, reconstruye la imagen
de ingesta (`docker compose up -d --build loop-ingest`) antes de `npm run sync:strava`; la sincronización avisa
cuando ninguna actividad trae desnivel.

## Siguiente paso

Cuando los datos ya fluyan, abre la pestaña Salud: la cintura, los anillos de ingesta y las señales de recuperación
se rellenan en cuanto llegan sus claves. Las definiciones de las métricas están en `docs/health-tab.md` (en
inglés).
