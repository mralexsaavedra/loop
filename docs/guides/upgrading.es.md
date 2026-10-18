> [English](upgrading.md) · **Español**

# Actualizar tu instalación

Cómo poner al día una instalación y cómo hacer antes una copia de seguridad de tus datos. Un **servidor** instalado
desde las imágenes (`docker-compose.yml` + `.env` en una carpeta propia, [`README.es.md` → Instalación](../../README.es.md#instalación))
se actualiza descargando las imágenes nuevas; un **clon del coach**, descargando el código; y una instalación
antigua en **modo host** (los servicios se ejecutan desde un clon, [más abajo](#actualizar-una-instalación-en-modo-host-desarrollo--heredada)),
descargando y reconstruyendo. Una segunda instalación se actualiza igual, en su propia carpeta o clon.

## Antes de empezar: copia de seguridad de la base de datos

Tu registro de comidas, tus recetas, el diario, los ajustes, los documentos y el historial de Strava viven en la
base de datos. Una copia tarda unos segundos; en un servidor, desde la carpeta que contiene `docker-compose.yml`:

```sh
umask 077
mkdir -p backups
cp .env "backups/env-$(date +%F)"
docker compose exec -T loop-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/loop-db-$(date +%F).sql"
```

`umask 077` hace que solo tú puedas leer las copias (contienen tus datos de salud y tus secretos). Guarda la copia
de `.env` junto al volcado: el Atajo de iOS sigue enviando el mismo `INGEST_TOKEN`, y un volumen de base de datos
existente solo acepta la `POSTGRES_PASSWORD` con la que se creó, así que una restauración vuelve a poner primero ese
`.env`.

Para restaurar una copia en una base de datos vacía (una instalación nueva, o después de `docker compose down -v`):
arranca solo la base de datos y espera a que acepte conexiones (`--wait`), carga la copia y después arranca el
resto. Pega el bloque entero: el `&&` al final de cada línea lo detiene en el primer error, así que el resto nunca
arranca sobre una base de datos vacía o cargada a medias (una base de datos que no está vacía rechaza la copia con
`relation ... already exists`, y no cambia nada):

```sh
docker compose up -d --wait loop-db &&
docker compose exec -T loop-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/loop-db-YYYY-MM-DD.sql > /dev/null &&
docker compose up -d
```

Guarda también el zip de la exportación de Apple Health en `files/import/`: es la fuente de tu historial de Salud.

En una instalación en modo host, la misma copia es `docker exec loop-db pg_dump -U health health > "backups/loop-db-$(date +%F).sql"`
en el clon (para restaurarla en una base de datos vacía:
`docker exec -i loop-db psql -q -v ON_ERROR_STOP=1 -U health -d health < backups/loop-db-YYYY-MM-DD.sql`); en una
segunda instalación el contenedor lleva su nombre (`loop-db-second` para `HC_INSTANCE=second`).

## Actualizar el servidor

1. **Lee las notas de la versión** nueva en [`CHANGELOG.md`](../../CHANGELOG.md) (en inglés): indican cuándo una
   versión necesita algo más que los pasos de abajo (una variable nueva en `.env`, un archivo compose nuevo).
2. **Haz la copia de seguridad** (arriba).
3. **Elige la versión**: pon en `HC_VERSION` de `.env` la nueva versión (p. ej. `HC_VERSION=1.0.1`). Si las notas
   dicen que el archivo compose ha cambiado, descarga el `docker-compose.yml` de esa versión encima del tuyo (la
   línea `curl -fsSLO` del README con la nueva versión en la URL); conserva tu `.env`.
4. **Descarga y reinicia**:

   ```sh
   docker compose pull && docker compose up -d
   ```

   El servicio de datos aplica al arrancar las migraciones nuevas de la base de datos, y la página se reconstruye
   unos segundos después.

## Actualizar un clon del coach

```sh
git pull && npm ci
npm run sync
```

El clon sigue siendo un cliente del servidor: no hay nada más que reiniciar.

## Comprobación

- `docker compose ps`: todos los contenedores `healthy`.
- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/healthz` imprime `200` (usa tu `INGEST_PORT` /
  `INGEST_BIND` si los cambiaste; sin `-o /dev/null -w ...` imprime el cuerpo JSON, `{"ok":true,...}`).
- `http://<server-ip>:8090/status.json` muestra la nueva versión como `commit` y ningún `error` (modo host:
  `services/loop-web/site/status.json`, el commit de git).
- La página se abre y su línea de frescura está en verde.

Si algo no va bien, consulta la [solución de problemas](troubleshooting.es.md).

## Actualizar una instalación en modo host (desarrollo / heredada)

Ejecuta todo desde la raíz del clon.

1. **Descarga el código nuevo.** La página solo se publica desde `main`, así que quédate en esa rama:

   ```sh
   git checkout main && git pull
   ```

2. **Dependencias.** `npm ci` (la actualización horaria también lo hace por su cuenta cuando cambia el lockfile).
   ¿Vienes de antes de la raíz de datos `loop-data/`? Mueve ahora tus archivos personales, antes de la siguiente
   sincronización ([nota de la versión, más abajo](#tus-archivos-personales-pasan-a-loop-data)): `npm run migrate:data-root`.

3. **El servicio de datos.** Reconstrúyelo desde tu clon; al arrancar aplica las migraciones nuevas de la base de
   datos (su imagen ya no se publica, así que siempre con `--build`):

   ```sh
   (cd services/loop-ingest && docker compose up -d --build)
   ```

   Si vienes de antes de la red `loop-net`, añade `--force-recreate` una vez
   ([nota de la versión, más abajo](#loop-web-llega-al-servicio-de-datos-a-través-de-loop-net)).

4. **El servicio de la página.** Vuelve a crearlo para que recoja una configuración de nginx o un archivo compose
   que hayan cambiado:

   ```sh
   (cd services/loop-web && docker compose up -d --force-recreate)
   ```

   `--force-recreate` aplica tanto un `docker-compose.yml` modificado (como el endurecimiento del contenedor de más
   abajo) como un `nginx.conf.template` modificado, que se monta desde el equipo y solo se procesa al arrancar el
   contenedor: un simple `up -d` no toca el contenedor cuando solo ha cambiado la plantilla. Después,
   `docker compose ps` debería mostrar `healthy` en todos los contenedores.

5. **Reconstruye la página ahora** en lugar de esperar a la ejecución horaria: pulsa **Sincronizar** en la página,
   o ejecuta a mano `services/loop-web/refresh.sh`.

¿Usas la página sin ningún servidor (coach, solo local)? Los pasos 1–2 y después `npm run generate`.

## Notas de versión para instalaciones existentes

Las notas siguientes se refieren a las instalaciones en modo host (los servicios se ejecutan desde un clon).

### Tus archivos personales pasan a `loop-data/`

Todos los archivos personales de un clon viven ahora en una sola carpeta en `.gitignore`, la raíz de datos
`loop-data/` (`HC_DATA_DIR` la mueve): el extracto de Apple Health (`loop-data/extract/`), la exportación del
registro de comidas (`loop-data/foodlog/`), las instantáneas del perfil (`loop-data/profile/`), las copias de los
documentos de perfil, plan y entrenamiento (`loop-data/cache/{profile,plan,training}.json`), la exportación de
Salud (`loop-data/files/import/`), los manuales de los dispositivos (`loop-data/files/manuals/`) y los PDF del
entrenador (`loop-data/files/documents/`). Las rutas antiguas ya no se leen. Justo después de `git pull`, ANTES de
la siguiente sincronización (una sincronización escribe en `loop-data/`, y un archivo allí que difiera del antiguo
detiene el traslado):

1. `npm run migrate:data-root -- --dry-run` imprime cuántos archivos se moverían (no se escribe nada).
2. `npm run migrate:data-root` escribe un tarball de copia de seguridad `backups/data-root-before-<UTC stamp>.tar`,
   copia cada archivo, verifica cada copia por sha256 y solo entonces borra los antiguos. Un conflicto (un destino
   con otro contenido) lo detiene antes de escribir nada, indicando cada archivo: quédate con una versión y vuelve
   a ejecutarlo. Una segunda ejecución dice que no hay nada que mover.
3. Pulsa **Sincronizar** (o `services/loop-web/refresh.sh`): la página se genera a partir de `loop-data/`.

A partir de ahora, edita tus documentos en su nuevo sitio (`loop-data/cache/plan.json` y después
`npm run documents -- push plan`). Un archivo de documento que siga en su ruta antigua hace que `npm run sync` y la
generación impriman un `WARNING:` (los cambios ahí se ignoran). Una segunda instalación hace lo mismo en su propio
clon.

### loop-web llega al servicio de datos a través de `loop-net`

El nginx de loop-web ahora reenvía al servicio de datos a través de la red Docker del stack de ingesta (`loop-net`,
o `loop-net-<instance>` con `HC_INSTANCE`) en lugar del puerto publicado del equipo, así que
`INGEST_BIND=127.0.0.1` funciona y es el endurecimiento recomendado ([Network and bind address](../lan-services.md#network-and-bind-address), en inglés).
El orden importa, porque es el stack de ingesta el que crea la red:

1. `(cd services/loop-ingest && docker compose up -d --build --force-recreate)`: los dos contenedores se vuelven a
   crear en `loop-net` (una vez, para esta versión: un simple `up -d --build` deja `loop-db` en la red antigua ya
   eliminada y se detiene con `could not find a network matching network mode loop-ingest_default`; este comando lo
   repara).
2. `(cd services/loop-web && docker compose up -d --force-recreate)`: loop-web se une a ella.
3. Opcional: `docker network rm loop-web_default` (la red antigua de loop-web, ya sin uso; la de una segunda
   instalación es `loop-web-<instance>_default`); borra `INGEST_PORT` de `services/loop-web/.env` (ya no se lee);
   pon `INGEST_BIND=127.0.0.1` en `services/loop-ingest/.env` y ejecuta allí `docker compose up -d`.

Comprobación: `docker network inspect loop-net --format '{{range .Containers}}{{.Name}} {{end}}'` muestra `loop-db`,
`loop-ingest` y `loop-web`, y el botón Sincronizar de la página funciona. Una segunda instalación hace lo mismo en
su propio clon, con su propio `HC_INSTANCE` en los dos archivos `.env` (`loop-net-second` para `HC_INSTANCE=second`).

El servicio de datos también se niega a arrancar con una variable numérica no válida (`STRAVA_SYNC_MINUTES=0`,
`MAX_BODY_BYTES=8m`: una línea `startup_failed` que la nombra), así que revisa `docker compose logs loop-ingest` si
no arranca después del paso 1.

### La versión de robustez (registro de migraciones, endurecimiento de los contenedores)

No hay nada que cambiar en tus archivos `.env`: no hace falta ninguna variable nueva. Haz primero la copia de
seguridad (arriba) y después sigue los pasos de **Actualizar**; en detalle:

- **El paso 3** vuelve a crear `loop-db` y `loop-ingest` con el endurecimiento (sistema de archivos raíz de solo
  lectura, capacidades eliminadas, límites, rotación de logs) y crea el registro de migraciones en el primer
  arranque: el servicio vuelve a ejecutar una vez cada archivo existente de `sql/` (son idempotentes; no cambia
  ninguna fila) y lo anota en `schema_migrations`. Los logs muestran once líneas `migration_applied` en ese primer
  arranque y ninguna después. Comprobación: `docker exec loop-db psql -U health -d health -c "SELECT count(*) FROM schema_migrations"`
  responde `11`. La contraseña de la base de datos se pasa ahora al servicio como un campo propio, así que una
  `POSTGRES_PASSWORD` que contenga `@ : / ? # %` también funciona (antes detenía el servicio con `Invalid URL`).
- **El paso 4** vuelve a crear `loop-web` con el endurecimiento, su comprobación de salud y las nuevas reglas de
  nginx (límites de peticiones en `/api/*` y `/ingest/*`, la comprobación de escritura ligada a la propia dirección
  de la página). Detrás de un túnel con SSO, mantén el host público tanto en `PLAN_WEB_EXTRA_HOSTS` como en
  `FOOD_ALLOWED_HOSTS` (como antes).
- **Opcional, la unidad de actualización**: la plantilla incorpora más endurecimiento de systemd. Para usarlo,
  vuelve a instalar la unidad ([`services/loop-web/README.md`](../../services/loop-web/README.md), en inglés, paso
  8 de Install: el mismo bucle `sed ... | sudo tee`) y después `sudo systemctl daemon-reload`. La unidad instalada
  sigue funcionando si te saltas esto.
- **Opcional, el hook pre-commit de git** que impide hacer commit de datos personales:
  `git config core.hooksPath scripts/git-hooks` ([`docs/guard-hook.md`](../guard-hook.md), en inglés).

Una segunda instalación hace lo mismo en su propio clon; sus contenedores llevan el sufijo de `HC_INSTANCE`, así
que cada `docker exec` de arriba nombra `loop-db-<instance>` (p. ej. `loop-db-second`) en lugar de `loop-db`.

## Pasar desde los nombres anteriores a LOOP

Las instalaciones creadas antes del 2026-10-15 usan los nombres antiguos (`services/health-ingest`,
`services/plan-web`, los contenedores `health-db` / `health-ingest` / `plan-web`, el volumen
`health-ingest_health-db-data`, las unidades `plan-web-refresh.*`). Descargar el cambio de nombre mueve el código,
pero no tus archivos de ejecución ni tus datos, así que haz esto una vez, en orden (una segunda instalación añade
su sufijo `-<instance>` a cada nombre de contenedor, proyecto y volumen):

1. **Haz la copia de seguridad con el nombre antiguo**:
   `docker exec health-db pg_dump -U health health > "backups/health-db-$(date +%F).sql"`, y anota el número de
   filas (`docker exec health-db psql -U health -d health -c "SELECT count(*) FROM food_log"`, y lo mismo para las
   demás tablas que te importen).
2. **Detén los stacks antiguos**, conservando el volumen (nunca `-v`):
   `sudo systemctl disable --now plan-web-refresh.path`, comenta la línea de `refresh.sh` en el crontab y después
   `docker compose -p health-ingest down` y `docker compose -p plan-web down`.
3. **Descarga el código** y **mueve los archivos de ejecución** a las carpetas nuevas:
   `services/health-ingest/{.env,trigger}` -> `services/loop-ingest/`,
   `services/plan-web/{.env,site,.refresh-state}` -> `services/loop-web/` (omite lo que no exista).
4. **Copia los datos** al volumen nuevo, con nombre explícito:
   `docker volume create loop-db-data` y después
   `docker run --rm -v health-ingest_health-db-data:/from -v loop-db-data:/to alpine sh -c 'cp -a /from/. /to/'`.
5. **Arranca los stacks nuevos**: `cd services/loop-ingest && docker compose up -d --build` y después
   `cd ../loop-web && docker compose up -d`; compara el número de filas (`docker exec loop-db psql ...`).
6. **Instala las unidades renombradas** y apunta la línea del crontab a `services/loop-web/refresh.sh`
   ([`services/loop-web/README.md`](../../services/loop-web/README.md), en inglés, pasos 7-8) y después borra los
   archivos de las unidades antiguas `plan-web-refresh.*`.
7. Conserva el volumen antiguo hasta que la página, el registro de comidas y el estado de Strava se vean bien;
   después, `docker volume rm health-ingest_health-db-data`.
