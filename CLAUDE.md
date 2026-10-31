# samukis-notes — contexto del proyecto

App de notas personal al estilo **Apple Notes**: self-hosted, sin servidores de
terceros para sincronizar, con búsqueda muy rápida (léxica y semántica) y un
conector MCP para que Claude lea y escriba notas. Hermana de la app de tareas
(estilo Things 3) y hereda su fórmula a propósito: PocketBase + Caddy + túnel
de Cloudflare en un servidor de casa, PWA vanilla local-first, MCP en Node sin
dependencias, y una app nativa de Android ("Notas") cuando la web esté madura.

Habla con Samuel en **español**, casual pero técnico. Valora honestidad sobre
limitaciones y decisiones ya tomadas (no las reabras sin razón). El plan
completo, con fases y criterios de "hecho", está en `PLAN.md`.

**El repo es público.** Nada de secretos, IPs de la tailnet, alias SSH ni
rutas del servidor en archivos versionados. Los secretos viven en el `.env`
del servidor (ignorado); los datos del despliegue, fuera del repo.

## Stack

- **Backend**: PocketBase v0.39.6 (binario Go, SQLite embebido), fijado en
  `pocketbase/Dockerfile`. Sirve API REST, realtime (SSE) y la PWA estática
  (`pb_public/`) desde el mismo origen. Con `--migrationsDir pb_migrations`
  y `--hooksDir pb_hooks`.
- **Esquema**: `pb_migrations/` es la fuente de verdad. **No se crean ni
  editan colecciones a mano en el panel**: se escribe una migración nueva
  (`<timestamp>_<nombre>.js`), se prueba en local y se despliega.
- **Hooks** (`pb_hooks/`, JS sobre goja): `notes.pb.js` pone el dueño,
  deriva `title`/`plain`/`tags`/`links` del `body`, lleva `version` y
  conflictos, y vacía la papelera. Lo compartido entre handlers va en
  `notes_lib.js` porque **cada handler corre en un runtime aparte y no ve
  las funciones del nivel superior del archivo**.
- **Caddy** (`caddy/Caddyfile`): comprime, pone `Cache-Control` y separa las
  dos entradas: `:8093` (tailnet/LAN, todo abierto) y `:8094` (pública, solo
  `127.0.0.1`, con el panel, el login de superusuario y el registro cerrados).
  La pública la recoge un cloudflared que corre en el host y la publica como
  `notes.samukis.xyz`. Nunca comprimir `text/event-stream` (mata el SSE).
- **Web** (Fase 3): HTML+CSS+JS vanilla, cero frameworks, cero build, local-first
  (IndexedDB + cola de sync + SSE), como tareas. Editor: ProseMirror vendorizado
  (única librería, en un solo archivo, como morphdom en tareas).
  **UI: la de Notas de HyperOS**, documentada en `docs/ui-hyperos.md` (tokens,
  pantallas, barra de edición). Sin pestaña de tareas, sin asistente de IA en
  el editor; fondos de nota "estilizados" en v2 (`notes.theme`, aún sin campo).
- **Buscador** (`buscador/`, Python, la única pieza con dependencias):
  SQLite propia en `data/buscador` con `fts_word` (unicode61 sin tildes:
  prefijos y fragmentos `<mark>`), `fts_tri` (trigramas: errores
  tipográficos) y `vec` (`sqlite-vec`, un vector por trozo con
  `jinaai/jina-embeddings-v2-base-es`), fundidos con RRF. Valida el token
  del usuario contra PocketBase y filtra por `owner`. Lo alimenta el hook
  `pb_hooks/search.pb.js` (POST `/search/index` con `X-Index-Token`) y un
  sync periódico de respaldo. Caddy pasa `/search*` sin recortar el prefijo.
  Contrato completo en `buscador/README.md`. El modelo se cachea en el
  volumen (`data/buscador/models`); cambiarlo recalcula los vectores.
- **MCP** (Fase 2): `mcp/server.js`, un archivo, sin dependencias, modo stdio y
  modo HTTP tras `/mcp/<token>`.
- **Android** (Fase 5): Kotlin + Compose, Room, offline-first. Quick tile,
  share target, widget, ContentProvider para Quick Search (fork).

## Modelo de datos (resumen; el detalle en la migración)

- `users` (auth de PocketBase): la app se autentica aquí, **nunca con
  `_superusers`** (se saltan todas las API Rules). `createRule = null`: las
  cuentas las crea el superusuario. `settings` (json) guarda los ajustes.
- Todas las colecciones de datos llevan `owner` y reglas
  `owner = @request.auth.id`. La de creación acepta `owner` ausente (el hook
  lo pone) o igual al propio usuario: PocketBase comprueba la regla **en seco
  antes de los hooks**, así que no puede exigir un campo que el hook pondrá.
- `notes.body` es Markdown y es lo único que escribe el cliente. `title`,
  `plain`, `tags`, `links` son derivados por `pb_public/js/md.js` (el mismo
  archivo en web, hooks y MCP) en hooks de modelo: lo que mande el cliente en
  esos campos se ignora.
- Versionado: el cliente manda `base_version` al editar `body`. Si es menor
  que la del servidor, gana la que llega, la anterior va a `note_versions`
  (`reason=conflict`) y la respuesta lleva `X-Note-Conflict: <versión>`.
  Cambios que no tocan `body` (mover, fijar, papelera) no suben `version`.
- Papelera: `trashed_at`; el cron `papelera` borra de verdad a los 30 días.
- `folders.parent` es autorreferencia (carpetas anidadas, cascada al borrar).
- `attachments.kind = ink` queda reservado para trazos de lápiz.

### Dialecto Markdown

```
# Título   ## Subtítulo   ### Encabezado
**negrita** *cursiva* ~~tachado~~ ++subrayado++ `código`
- viñeta   1. numerada   - [ ] por hacer   - [x] hecho
> cita   ```bloque```   ---   ![alt](attachments/<id>)   [[otra nota]]   #etiqueta
```

El título NO es un slot: es la primera línea si lleva formato `# `. Una nota
puede empezar por cuerpo; `title` se deriva igual para listas y búsqueda.

## Desarrollo local

Sin Docker: un binario de PocketBase 0.39.6 fuera del repo y

```bash
pocketbase serve --http=127.0.0.1:8790 --dir <carpeta-de-datos> --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations
```

En Windows PocketBase **no se reinicia solo** al cambiar un hook: hay que
pararlo y arrancarlo. Las migraciones ya aplicadas no se vuelven a aplicar:
para probar un cambio de esquema, carpeta de datos nueva.

Pruebas (sin npm):

```bash
node --test tests/md.test.js
```

```bash
PB_URL=http://127.0.0.1:8790 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/api-smoke.mjs
```

`api-smoke.mjs` crea dos usuarios ficticios, verifica dueño, derivados,
versiones, conflicto, aislamiento entre usuarios, carpetas y papelera, y los
borra. Vale contra el servidor real. `search-smoke.mjs` hace lo mismo con el
buscador (prefijos, tildes, errores tipográficos, semántica, filtros,
aislamiento) y necesita el servicio levantado con Docker: no corre en local
sin él.

## Despliegue

Como tareas: un remoto `casa` apunta a un repo bare en el servidor cuyo
`post-receive` hace `git reset --hard` sobre el working tree. `git push casa
main` **es producción en el acto**, por eso el pre-push (`git config
core.hooksPath scripts/hooks`) comprueba sintaxis y tests antes.

En el servidor: `docker compose up -d --build`. Un cambio en `pb_hooks/` o
`pb_migrations/` se recoge al reiniciar PocketBase (`docker compose restart
pocketbase`); uno en `pb_public/` no necesita nada. Backup = la carpeta
`data/pb_data`.

## Convenciones

- Cero dependencias de build. Lo externo se vendoriza en un archivo y se
  documenta aquí.
- Assets con `?v=N` en `index.html`; subirlo al editar js/css (Caddy los
  cachea un año).
- Comentarios en español que explican el porqué, no el qué.
- Cada handler de hook hace su `require` dentro.
- Nada se borra desde el MCP: como máximo, a papelera.
