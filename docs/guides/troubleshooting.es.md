> [English](troubleshooting.md) · **Español**

# Solución de problemas

Soluciones a los problemas habituales al usar el servidor LOOP en casa. Cada sección indica un síntoma, qué
**comprobar** (1–3 sitios o comandos) y la **solución**. Los comandos dan por hecho un servidor instalado desde las
imágenes ([`README.es.md` → Instalación](../../README.es.md#instalación)), ejecutados en la carpeta que contiene su
`docker-compose.yml`, con los puertos por defecto (página 8090, servicio de datos 8088). Una instalación antigua en
modo host (los servicios se ejecutan desde un clon en `/path/to/loop`) es distinta donde lo indica una línea
**Modo host**.

## La página muestra datos antiguos, o una fuente está en ámbar / rojo

**Comprobar**

- Toca el punto de la barra superior: muestra la antigüedad de cada fuente ("Atajo", "Strava", "Página"). Ámbar
  significa más de 24 h, rojo más de 72 h.
- `curl -s http://<server-ip>:8090/status.json`: `publishedAt` y `commit` son la última generación correcta; un
  campo `error` significa que la última ejecución se detuvo antes de tiempo (siguiente sección). Modo host:
  `cat /path/to/loop/services/loop-web/site/status.json`.
- `docker compose exec loop-server cat /data/extract/_meta.json`: `exportLastDate` es un día parcial;
  `shortcutSync.owned` enumera las fechas que escribió el Atajo (en un clon del coach o en modo host:
  `loop-data/extract/_meta.json`).

**Solución**

- Pulsa **Sincronizar** en la página, o espera a la reconstrucción horaria.
- Si solo "Atajo" está antiguo, el móvil no ha enviado nada: consulta "El Atajo se ejecuta pero no llega nada".
- Si solo "Strava" está antiguo, consulta "Strava sigue vacío".
- En un clon del coach, `npm run sync` trae los datos más recientes del servidor (modo host o solo local:
  `npm run sync` y después `npm run generate`).

## El botón Sincronizar no hace nada o muestra "No se pudo actualizar"

**Comprobar**

- `curl -s http://<server-ip>:8090/api/sync/status`: `lastTriggerError` indica qué falló en el servicio de datos.
- El código `error` de `status.json` (arriba): `build`, `sanity` o `lock` (el modo host añade `branch` e
  `install`).
- `docker compose logs -f loop-server` mientras pulsas Sincronizar (la salida de la generación). Modo host:
  `journalctl -u loop-web-refresh.service -f` (la salida de `refresh.sh`).

**Solución**

- `build` / `sanity`: el log indica el paso que falló. Una generación fallida mantiene en línea la última página
  correcta.
- `lock`: otra actualización seguía en marcha; vuelve a pulsar Sincronizar dentro de un minuto.
- No hay botón Sincronizar ni punto de frescura: la página no puede llegar a `/api/sync/status` (abierta como
  archivo, la versión de ejemplo, o el servicio de datos está caído). Es lo esperado fuera de la página local.
- **Modo host:**
  - `branch`: solo se publica `main`. Compruébalo con `git -C /path/to/loop rev-parse --abbrev-ref HEAD` y vuelve a
    `main`; haz el trabajo de nuevas funciones en un git worktree aparte.
  - `trigger_write`: el directorio disparador debe pertenecer al usuario del contenedor:
    `sudo chown 1000:1000 /path/to/loop/services/loop-ingest/trigger`.
  - No pasa nada en absoluto: la unidad path de systemd falta o está detenida.
    `sudo systemctl enable --now loop-web-refresh.path` (pasos de instalación en el README de loop-web, paso 8).
  - `install` / `build`: ejecuta a mano `/path/to/loop/services/loop-web/refresh.sh` y lee el error.

## La exportación de Apple Health en `files/import/` no se importa

**Comprobar**

- `docker compose exec loop-server cat /data/import-state.json`: `file`, `importedAt` y `exportLastDate` de la
  última importación; un `lastError` con su `code` cuando falló el archivo más reciente.
- `docker compose logs loop-server | grep import:health`: una línea por intento.

**Solución**

- No hay archivo de estado y aparece `no import folder` en el log: el zip no está en la carpeta de archivos que lee
  el servidor (`HC_FILES_LOCATION` en `.env`, por defecto `./files`, es decir, `files/import/` junto a
  `docker-compose.yml`). Pulsa **Sincronizar** después de copiarlo (o espera a la ejecución horaria).
- `corrupt`, `truncated` o `no-export`: el zip estaba dañado o todavía se estaba copiando; vuelve a exportarlo desde
  el iPhone y cópialo de nuevo (se reintenta en la siguiente ejecución).
- `too-large`: la exportación supera `HC_IMPORT_MAX_BYTES` (10 GiB por defecto); súbelo en `.env` y después
  `docker compose up -d`. Si una primera importación se queda sin tiempo, sube `HC_IMPORT_TIMEOUT` (segundos) de la
  misma forma.
- Un zip que el contenedor no puede leer (copiado con modo `600` por otro usuario; el servidor se ejecuta como el
  usuario `node` de la imagen, uid 1000): `chmod 644 files/import/<the zip>` y después pulsa **Sincronizar**.
- Para volver a importar el mismo zip: `docker compose exec loop-server npm run import:health -- --force`.

## El Atajo se ejecuta pero no llega nada

**Comprobar**

- La URL del Atajo: `http://<server-ip>:8090/ingest/health-auto-export` (o
  `https://<your-host>/ingest/health-auto-export` detrás de un túnel). Cualquier otra ruta `/ingest/*` da 404.
- La respuesta: `202` significa guardado; `401` significa que el token no coincide (el servicio registra cada uno
  como `"event":"unauthorized"` con un contador `count`, nunca el token); `400` con `"code":"nul_character"`
  significa que los datos contienen un carácter `\u0000`, que la base de datos no puede guardar.
- `curl -s localhost:8088/sync/status`: `lastShortcutAt` debería cambiar después de cada ejecución.
- Un error en el propio iPhone ("Puedes permitir su ejecución en Ajustes", "No se ha encontrado ninguna
  muestra"): [`docs/ios-shortcut.es.md` → Solución de problemas](../ios-shortcut.es.md#solución-de-problemas).

**Solución**

- `401`: la cabecera `Authorization` debe ser `Bearer <INGEST_TOKEN>`; en el servidor,
  `grep '^INGEST_TOKEN=' .env` y cópialo en tu propia pantalla (modo host: `services/loop-ingest/.env`).
- Las claves llegan vacías: comprueba que los filtros *Origen es* (*Source is*) nombran **tus** dispositivos, una
  búsqueda por dispositivo (dos filtros en una búsqueda se combinan con Y y no devuelven nada).
- Falta un tipo en la lista: iOS 26 renombró algunos (en la interfaz en inglés, Active Energy → *Active Calories*,
  Resting Energy → *Resting Calories*); el VO2 máx. es *Capacidad aeróbica* (*Cardio Fitness* en inglés).
- Las ejecuciones de noche no envían nada: los datos de Salud están bloqueados mientras el móvil está bloqueado.
  Haz que la automatización se active al abrir una app que uses a diario.
- Datos muy grandes: loop-web y el servicio aceptan hasta 8 MB en esa ruta. Acorta la ventana de frecuencia
  cardiaca (1 día).
- Las claves nuevas nunca aparecen (modo host o un clon solo local): ejecuta una vez `npm run sync -- --full`.

## Strava sigue vacío

**Comprobar**

- `curl -s localhost:8088/sync/status`: `stravaConfigured` debe ser `true`; `lastStravaOkAt` debería tener una
  hora; `lastStravaError` muestra un código (`strava_auth`, `strava_network`, `strava_other`,
  `strava_token_save`).
- `curl -s localhost:8088/healthz`: `degraded: true` significa que la última descarga correcta tiene más de 6 h o
  que nunca ha habido ninguna.

**Solución**

- `stravaConfigured: false`: rellena `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` y `STRAVA_REFRESH_TOKEN` en `.env`
  y después `docker compose up -d` (modo host: `services/loop-ingest/.env`, `docker compose up -d` en esa carpeta).
- `strava_auth`, o `401` / `invalid_grant` al canjear el código: el código ya se usó o caducó. Vuelve a autorizar
  con `scope=read,activity:read_all,profile:read_all` y canjea el código nuevo enseguida:
  `docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print`, después pon la línea
  impresa en `.env` y `docker compose up -d` (modo host: `node scripts/strava-auth.js` en `services/loop-ingest`).
  Deja marcados todos los permisos en la pantalla de consentimiento; sin `profile:read_all`, las bicis y las
  zapatillas se quedan vacías.
- Después pulsa **Sincronizar** (en un clon del coach: `npm run sync`).
- Un historial largo se completa en varias ejecuciones: la primera descarga guarda cada página de 100 actividades
  según llega, y cuando el límite de peticiones de Strava (`rateLimited: true` en `docker compose logs loop-server`)
  la detiene, la siguiente ejecución (cada `STRAVA_SYNC_MINUTES`) continúa desde la actividad guardada más reciente.

## El registro de comidas o la ficha "+" no llegan al servidor

**Comprobar**

- ¿Estás en la red de casa, abriendo la página desde loop-web (`http://<server-ip>:8090`)? El registro de comidas
  solo funciona en la red local, no desde el archivo local.
- `curl -s -H 'X-HC-Food: 1' localhost:8090/api/food/products`: debería mostrar productos. Sin la cabecera
  responde `403`.
- `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <the name you use>' localhost:8090/`: `421` significa que ese
  nombre de host no está permitido.

**Solución**

- Las direcciones IP funcionan sin configurar nada. Para abrir la página por nombre (`plan.lan` o el host de un
  túnel), añade el nombre tanto a `PLAN_WEB_EXTRA_HOSTS` como a `FOOD_ALLOWED_HOSTS` en `.env` y después
  `docker compose up -d` (modo host: el primero en `services/loop-web/.env`, el segundo en
  `services/loop-ingest/.env`, y `docker compose up -d` en las dos carpetas).

## Un clon del coach no recibe los datos del servidor

**Comprobar**

- `npm run sync` imprime `Client mode: ...` y una línea `Mirror: ...` cuando llega a un servidor de las imágenes.
- Una línea `ERROR: ... (HTTP 401)`: el `INGEST_TOKEN` del clon no es el del servidor.
- Un error de conexión: el clon no puede llegar a `INGEST_URL`.

**Solución**

- `401`: pon en `INGEST_TOKEN` el valor del `.env` del servidor.
- Desde otro ordenador, el puerto de datos tiene que estar en la red local: `INGEST_BIND` en el `.env` del servidor
  es `127.0.0.1` (solo la propia máquina) por defecto; ponle la IP local del servidor y ejecuta allí
  `docker compose up -d` ([Network and bind address](../lan-services.md#network-and-bind-address), en inglés), o
  ejecuta el coach en el propio servidor con `INGEST_URL=http://127.0.0.1:8088`.
- Más casos (un manifiesto vacío, demasiadas eliminaciones): [`docs/data-pipeline.md` → Coach as a client](../data-pipeline.md#coach-as-a-client-of-a-loop-server) (en inglés).

## La generación falla en un clon recién creado

**Comprobar**

- La línea de error: `build-web: <file> not found.` indica la entrada que falta.
- `node -v`: hace falta v22.12 o posterior.

**Solución**

- Copia las plantillas (antes, `mkdir -p loop-data/cache`; `loop-data/` es la raíz de datos en `.gitignore`):
  `data/nutrition/plan-data.example.json` → `loop-data/cache/plan.json` (opcionalmente
  `data/training/training-data.example.json` → `loop-data/cache/training.json` y `profile/profile.example.json`
  → `loop-data/cache/profile.json`) y después `npm ci && npm run generate`.
- ¿Solo quieres echar un vistazo? `npm run build:example` genera la página de demostración con datos sintéticos,
  sin archivos personales.

## Una segunda instalación muestra los datos de la otra persona, o el puerto equivocado

**Comprobar**

- `docker ps`: cada instalación necesita sus propios contenedores (`loop-server-second`, `loop-web-second`, …).
- `HC_INSTANCE`, `INGEST_PORT` y `PLAN_WEB_PORT` en el `.env` de esa instalación.
- `docker network ls --filter name=loop-net`: una red por instalación.

**Solución**

- Da a la segunda instalación su propia carpeta, su nombre y sus puertos en su `.env` (por ejemplo
  `HC_INSTANCE=second`, `INGEST_PORT=8089`, `PLAN_WEB_PORT=8091`) y después ejecuta allí `docker compose up -d`
  ([`docs/lan-services.md` → A second install](../lan-services.md#a-second-install), en inglés).
- **Modo host:** el mismo `HC_INSTANCE` en los dos archivos `.env` del clon (`services/loop-ingest/.env` con
  `INGEST_PORT`, `services/loop-web/.env` con `PLAN_WEB_PORT`; da nombre a la red `loop-net-<name>` a través de la
  que la página reenvía), `docker compose up -d` en las dos carpetas, primero la de ingesta; `npm run sync` y
  `refresh.sh` leen `INGEST_PORT` del `.env` de ingesta del propio clon. Renombra las unidades de systemd de esa
  instalación (`loop-web-refresh-second.path` / `.service`) para que no sustituyan a las de la primera, y escalona
  los minutos del cron en un equipo pequeño.

## Los contenedores están caídos, no están sanos o están desactualizados tras una actualización

**Comprobar**

- `docker compose ps` (modo host: en `services/loop-ingest` y en `services/loop-web`).
- `curl -s localhost:8088/healthz`: `200` cuando la base de datos responde; `degraded: true` solo afecta a Strava
  (ver arriba).

**Solución**

- Desactualizados: [`upgrading.es.md`](upgrading.es.md) (`docker compose pull && docker compose up -d`, después de
  una copia de seguridad).
- `loop-web` no arranca: espera a que `loop-server` esté sano; `docker compose logs loop-server` dice por qué no lo
  está.
- Un contenedor que no arranca: `docker compose logs <container>`. El servicio de datos se niega a arrancar con un
  `INGEST_TOKEN` de menos de 32 caracteres, con `invalid <NAME>=...` cuando una variable numérica
  (`STRAVA_SYNC_MINUTES`, `MAX_BODY_BYTES`, `PORT`) tiene algo que no es un número simple dentro de rango, y con
  `migration <file> was changed after it was applied` cuando se editó un archivo de `services/loop-ingest/sql/`
  después de ejecutarse (solo en un clon): restáuralo (`git checkout -- services/loop-ingest/sql/<file>`) y pon el
  cambio en una migración nueva ([`services/loop-ingest/README.md` → Database migrations](../../services/loop-ingest/README.md#database-migrations), en inglés).
- `docker compose up` se detiene con `set INGEST_PORT in docker/.env`: añade `INGEST_PORT=8088` (o tu puerto) a
  `.env`; es obligatorio, para que el puerto nunca quede al azar (modo host:
  `set INGEST_PORT in services/loop-ingest/.env`).
- loop-web se reinicia una y otra vez con `bind() to 0.0.0.0:80 failed (13: Permission denied)` (un Docker anterior
  a la 20.10): añade `NET_BIND_SERVICE` al `cap_add` de loop-web en `docker-compose.yml`. Otro
  `Permission denied` o `Read-only file system` en los logs de un contenedor: notifícalo con esa línea del log.
- **Docker ignora ufw** (y firewalld): un puerto publicado es accesible desde todas las redes a las que está
  conectado el equipo, diga lo que diga el cortafuegos. En un equipo con dirección pública (un VPS, una máquina
  expuesta por el router), mantén `INGEST_BIND=127.0.0.1` y pon en `PLAN_WEB_BIND` la IP local en `.env`, y después
  `docker compose up -d` ([`docs/lan-services.md` → Network and bind address](../lan-services.md#network-and-bind-address), en inglés).
- La página o la API responden `429`: el límite de peticiones de nginx en las rutas reenviadas (es generoso;
  consulta [`services/loop-web/README.md`](../../services/loop-web/README.md) → Rate limits, en inglés); la causa
  habitual es un script que llama en bucle a `/api/*`.
- **Modo host:**
  - Después de descargar código nuevo en `main` (`git -C /path/to/loop pull`), reconstruye el servicio de ingesta
    (`docker compose up -d --build` en `services/loop-ingest`; aplica las migraciones nuevas de la base de datos)
    y vuelve a crear loop-web (`docker compose up -d --force-recreate` en `services/loop-web`). `refresh.sh`
    reinstala por su cuenta los paquetes npm cuando cambia el lockfile.
  - `loop-db` se detiene con `could not find a network matching network mode loop-ingest_default` después de una
    actualización: la actualización que pasó los servicios a `loop-net` necesita una vez
    `docker compose up -d --build --force-recreate` en `services/loop-ingest` ([actualizar](upgrading.es.md)).
  - loop-web se detiene con `network loop-net declared as external, but could not be found`: arranca primero el
    stack de ingesta (`docker compose up -d` en `services/loop-ingest` crea la red) y después loop-web. La página
    carga pero Sincronizar, el registro de comidas y el diario responden `502` / `504`: el contenedor de ingesta
    está caído o no está en `loop-net` (`docker network inspect loop-net` muestra los dos contenedores).
  - En un equipo con dirección pública: `INGEST_BIND=127.0.0.1` en `services/loop-ingest/.env` (loop-web no usa
    ese puerto) y `PLAN_WEB_BIND` en `services/loop-web/.env`, y después `docker compose up -d` en cada carpeta.

## ¿Sigues atascado?

- [Referencia del servidor LOOP](../lan-services.md) (en inglés): las imágenes, el protocolo de sincronización, los
  códigos de error y la seguridad.
- [Atajo de iOS](../ios-shortcut.es.md): cada clave de los datos enviados, Problemas frecuentes, Solución de
  problemas y Comprobación.
- [README de loop-ingest](../../services/loop-ingest/README.md) (en inglés): endpoints, Strava, configuración.
- [README de loop-web](../../services/loop-web/README.md) (en inglés): modo host: pasos de instalación, prueba
  rápida, segunda instalación.
