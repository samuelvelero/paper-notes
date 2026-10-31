# samukis-notes — Plan

Notas personales al estilo Apple Notes, self-hosted, sin servidores de terceros,
con la misma fórmula que la app de tareas (`Things3_Files/project`):
PocketBase + Caddy + túnel de Cloudflare en la laptop Linux, PWA vanilla local-first,
MCP en Node sin dependencias, y después una app nativa de Android ("Notas").

Fecha del plan: 31 oct 2026. Decisiones tomadas en la entrevista del mismo día.

---

## 1. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Backend | PocketBase (misma versión que tareas, v0.39.x), SQLite embebido, en `~/samukis-notes` de la laptop Linux |
| Dominio | `notes.samukis.xyz` por cloudflared (público) + `localhost:8090` por Tailscale |
| Web | PWA vanilla (HTML/CSS/JS, cero build), responsive escritorio + móvil. **Look de Notas de HyperOS** (`docs/ui-hyperos.md`): sin pestaña de tareas, sin asistente IA en el editor, fondos de nota a futuro. ME3 como variante futura |
| Android | Nativa Kotlin + Compose, offline-first, DESPUÉS de iterar la web |
| Usuarios | Solo Samuel, pero multiusuario real desde el día uno (colección `users` + `owner` + API Rules) |
| Formato | Markdown en la base de datos, editor WYSIWYG que no deja ver Markdown |
| Título | La primera línea con formato Título es el título. Ajuste "título automático en notas nuevas" (on/off como Apple). Una nota puede no tener título |
| Formato v1 | Título, subtítulo, encabezado, cuerpo, negrita, cursiva, subrayado, tachado, viñetas, numeradas, to-do, separador, cita, bloque de código, imágenes. **Tablas en v2** |
| Organización v1 | Carpetas anidadas, notas fijadas, `#etiquetas` inline, papelera 30 días, enlaces entre notas. Sin carpetas inteligentes ni notas bloqueadas |
| Búsqueda | Prefijos, sin tildes ni mayúsculas, tolerancia a errores, semántica (embeddings). Fragmentos resaltados: backend listo, UI apagada |
| Conflictos | Gana la última versión; la perdedora va al historial de la nota |
| Sync | Local-first: IndexedDB/Room primero, cola de cambios, realtime SSE de PocketBase |
| Android extras | Quick tile con cuadro flotante, share target (texto y enlaces), widget. Sin pantalla de bloqueo |
| MCP | `notas_buscar`, `nota_leer`, `nota_crear`, `nota_agregar`, `nota_actualizar`, `notas_recientes`, `carpetas_listar`. Claude solo manda a papelera, nunca borra |
| Migración | Obsidian (Markdown directo) e iCloud Notes (solo vía icloud.com) |
| Nombres | Repo `samukis-notes`, app Android "Notas", paquete `com.samukis.notas` |
| Fuera | Trazos de lápiz (reservado en el esquema), Things 3 / tareas, colaboración |

---

## 2. Arquitectura

```
                 ┌──────────────── laptop Linux (docker compose) ────────────────┐
                 │                                                                │
  PC (PWA) ──┐   │  Caddy :8090 (tailnet) / :8091 (túnel)                         │
  Android ───┼──▶│    ├── /            → PocketBase (API, SSE, pb_public)          │
  Claude ────┘   │    ├── /mcp/<token> → mcp (Node, modo HTTP)                     │
                 │    └── /search/*    → buscador (índice FTS5 + vectores)         │
                 │                                                                │
                 │  PocketBase ──(hook: nota guardada)──▶ buscador (reindexa)      │
                 │  cloudflared ──▶ Caddy :8091   (notes.samukis.xyz)              │
                 └────────────────────────────────────────────────────────────────┘
```

Cuatro contenedores: `caddy`, `pocketbase`, `mcp`, `buscador`, más `cloudflared`
bajo el perfil `publico`. Igual que tareas, menos el notifier (aquí no hay
recordatorios) y más el buscador.

### 2.1 Por qué un servicio "buscador" aparte

PocketBase no hace FTS ni embeddings. Las tres cosas pedidas (tolerancia a
errores, semántica, fragmentos) viven en un índice propio:

- **SQLite propio** del buscador con una tabla `FTS5` con tokenizador
  `trigram` (prefijos y subcadenas) y una segunda con `unicode61
  remove_diacritics 2` (palabras exactas, para rankear mejor), sobre texto
  normalizado (sin tildes, minúsculas).
- **Vectores** en la misma SQLite con `sqlite-vec`. Embeddings multilingües
  calculados en la laptop con un modelo pequeño (`multilingual-e5-small`,
  ~470 MB en ONNX, o `bge-m3` si el disco lo permite).
- **Ranking híbrido**: FTS (léxico) + vectores (semántico) fusionados por RRF.
  El MCP recibe la lista ya ordenada con fragmentos; el LLM no pagina ni filtra.
- Se alimenta por un **hook de PocketBase** (`pb_hooks/`, como `/publish` en
  tareas) que avisa al buscador cuando una nota cambia, y por un reindexado
  completo al arrancar.

Lenguaje del buscador: **Python** (fastembed + sqlite-vec, las dos librerías
maduras para esto) en un contenedor pequeño. Es la única pieza con dependencias;
la web, el MCP y los hooks siguen siendo cero dependencias. Alternativa Node
(`fastembed` tiene puerto a Node) si prefieres un solo lenguaje de servidor.

**Aviso de disco:** el host de tareas está al 97%. El modelo de embeddings
ocupa entre 100 MB (`e5-small` cuantizado) y 2 GB (`bge-m3`). Hay que liberar
espacio antes de la Fase 1 o poner el buscador en otro disco.

### 2.2 Búsqueda en cada cliente (sin red)

- **PWA**: las notas ya están en IndexedDB. Un índice en memoria propio
  (trigramas sobre texto normalizado, ~60 líneas de JS) responde en < 5 ms con
  miles de notas. Cubre prefijos, tildes y un error tipográfico. Si hay red,
  la PWA añade los resultados semánticos del buscador debajo.
- **Android**: Room con FTS4/5 y normalización propia; misma lógica. Es el
  índice que luego consume Quick Search por ContentProvider.
- **Semántica offline en el teléfono**: v2 (modelo ONNX on-device). No
  bloquea nada.

---

## 3. Modelo de datos (PocketBase)

Lección del plan multitenant de tareas: `users` desde el día uno, nada de
`_superusers`, y API Rules `owner = @request.auth.id` en todas las colecciones.

| Colección | Campos clave |
|---|---|
| `users` (auth) | la de PocketBase; `settings` (json: título automático, tema, orden) |
| `folders` | `owner`, `name`, `parent` (relación a sí misma, nullable), `order` (fraccional como tareas), `icon` |
| `notes` | `owner`, `folder` (nullable = "Notas"), `body` (markdown), `title` (derivado, denormalizado para listas), `plain` (texto sin marcas, para índices), `tags` (json, derivado de `#tag`), `links` (json de ids, derivado de `[[nota]]`), `pinned`, `trashed_at` (nullable), `version` (int), `client_updated` (fecha del dispositivo), `device` |
| `note_versions` | `note`, `owner`, `body`, `version`, `device`, `created`. Se escribe la versión perdedora en cada conflicto y, de paso, un snapshot cada N guardados |
| `attachments` | `note`, `owner`, `file` (campo file de PocketBase), `kind` (`image` hoy; `ink` reservado), `width`, `height` |
| `tags` | `owner`, `name`, `color`, `order`. Opcional: solo para orden y color; la verdad vive en `notes.tags` |

Reglas de borrado: a papelera = `trashed_at`. Un hook de PocketBase (cron diario)
borra de verdad lo que lleva más de 30 días. `note_versions` y `attachments`
se borran en cascada.

Derivados (`title`, `plain`, `tags`, `links`): los calcula **el cliente** al
guardar y los **revalida un hook** `onRecordBeforeUpdate` en el servidor, para
que el MCP y la web no diverjan. El parser de Markdown→plain es un archivo JS
compartido (montado en el MCP como `quick.js` en tareas).

### 3.1 Markdown: el dialecto

CommonMark + extensiones mínimas, todas con equivalente visual:

```
# Título        ## Subtítulo       ### Encabezado
**negrita** *cursiva* ~~tachado~~ ++subrayado++
- viñeta  1. numerada  - [ ] por hacer  - [x] hecho
> cita     ```código```     ---   (separador)
![img](attachments/<id>)     [[id-o-título de otra nota]]     #etiqueta
```

El título es solo la primera línea `# ` si existe; si la nota empieza por
cuerpo, `title` se deriva de las primeras palabras para listas y búsqueda.

---

## 4. Sync y conflictos

Copiado de tareas (`idb.js`, `sync.js`): cola de operaciones en IndexedDB,
`drainSyncQueue()` al reconectar, SSE para recibir, eco para ignorar lo propio.
Lo que cambia respecto a tareas:

1. **Guardado por nota, con `version`.** El cliente manda
   `PATCH /notes/:id` con `version` esperada. Un hook compara: si la del
   servidor es mayor, hay conflicto.
2. **Conflicto**: gana la que llega (última escritura real), la que estaba en
   el servidor se guarda en `note_versions`, y la respuesta avisa al cliente
   para mostrar "esta nota tiene una versión anterior" en el historial.
3. **Autoguardado** con debounce (~800 ms) mientras se escribe, y guardado
   inmediato al salir de la nota. Cada guardado es la nota completa (no diffs):
   simple y suficiente para texto de este tamaño.
4. **Adjuntos** se suben aparte (multipart) y se referencian por id; en
   offline la imagen se guarda en IndexedDB y se sube al reconectar.
5. **Papelera, carpetas y fijado** son campos normales: viajan por la misma cola.

---

## 5. El editor (la pieza más difícil)

Requisito: WYSIWYG sin rastro de Markdown, con negrita dentro de una línea,
listas, to-dos, código, imágenes. Dos caminos honestos:

**A. Vendorizar ProseMirror** (como se vendorizó morphdom): un solo bundle
prebuilt (~350 KB, MIT), esquema propio con exactamente nuestros bloques, y
`prosemirror-markdown` para serializar. Robusto en móvil (IME, selección,
deshacer). Rompe la regla "cero dependencias" en un solo archivo, con la
misma justificación que morphdom: es trabajo que no vale la pena rehacer.

**B. Editor propio sobre `contenteditable`**: un bloque por línea, formato
inline propio. Control total y cero KB extra, pero la selección multi-bloque,
el pegado y el teclado de Android son meses de bugs.

**Recomendación: A.** Se encapsula en `js/editor.js` con una API pequeña
(`editorOpen(note)`, `editorMarkdown()`, `editorCmd('bold')`) para poder
cambiar de motor sin tocar el resto. La barra de formato estilo Apple Notes
(Aa, lista, to-do, cámara) es nuestra.

En Android el editor es nativo (Compose + `AnnotatedString`/propio); el
Markdown es el contrato entre los dos.

---

## 6. MCP

`mcp/server.js`, copia de la estructura de tareas: un archivo, sin
dependencias, modo stdio y modo HTTP tras `/mcp/<MCP_PATH_TOKEN>`.

| Herramienta | Entrada | Salida |
|---|---|---|
| `notas_buscar` | `q`, `limite` (10), `carpeta`, `etiqueta`, `incluir_papelera` | lista rankeada: `id`, `titulo`, `carpeta`, `fragmento`, `puntaje`, `actualizada`. Llama al buscador (híbrido) |
| `nota_leer` | `id` o `titulo` | nota completa en Markdown + metadatos |
| `nota_crear` | `contenido` (markdown), `carpeta`, `fijada` | nota creada |
| `nota_agregar` | `id`, `contenido`, `donde` (`final` / `inicio`) | nota actualizada |
| `nota_actualizar` | `id`, `contenido`? , `carpeta`?, `fijada`?, `papelera`? | nota actualizada |
| `notas_recientes` | `limite`, `carpeta` | últimas editadas |
| `carpetas_listar` | — | árbol de carpetas con conteos + etiquetas en uso |

Reglas: `nota_actualizar` con `contenido` reemplaza el cuerpo entero y pasa
por el mismo control de `version` (el MCP siempre lee antes de escribir).
Nada se borra: `papelera: true` es lo máximo. Tests en `tests/mcp.test.js`
como en tareas. Conector remoto en Claude igual que `tareas`.

---

## 7. Android ("Notas")

Reutiliza lo aprendido en `PLAN-android-nativo.md` de tareas (Kotlin,
Compose, cliente REST propio, Room, WorkManager para la cola).

- **Offline-first**: Room es la verdad local; cola de cambios; SSE cuando la
  app está abierta, `WorkManager` periódico cuando no.
- **Editor nativo** con los mismos bloques; Markdown como formato de
  intercambio.
- **Quick tile "Nota nueva"**: `TileService` → `Activity` flotante
  (tema diálogo) con un campo de texto y "Guardar". **Tile "Buscar"**:
  abre la búsqueda directamente.
- **Share target**: `ACTION_SEND` de texto y URLs → cuadro flotante con la
  nota prellenada (URL como enlace + título de la página si hay red).
- **Widget** (Glance): lista de notas fijadas + botón de nota nueva.
- **ContentProvider** `com.samukis.notas.provider` (`content://…/search?q=`)
  protegido por permiso de firma: devuelve id, título, fragmento, carpeta,
  fecha, desde el índice local. Es lo que consume Quick Search.
- **Deep link** `notas://nota/<id>` para abrir una nota desde fuera.

---

## 8. Quick Search

Verificado en el repo (`teja2495/quick-search`, MIT, 613 estrellas, activo):
Kotlin + Compose, sus secciones de resultados (apps, contactos, archivos,
notas propias…) están en código, **no hay API de plugins** ni lee
ContentProviders ajenos. Tiene un checklist interno
(`.claude/skills/new-search-section/SKILL.md`) para añadir una sección nueva.

Camino: **fork** `samukis/quick-search` con una sección "Notas" que consulta
nuestro ContentProvider y abre la nota por deep link al tocar. Se mantiene al
día con rebase sobre upstream (son ~12 archivos tocados, por su checklist).
Opcional después: proponer upstream una sección genérica "proveedor de notas
externo" para no mantener el fork.

Semántica dentro de Quick Search: depende del índice del teléfono (léxico en
v1; semántica cuando exista el modelo on-device, v2).

---

## 9. Migración

- **Obsidian**: importador en la web ("Importar carpeta") que lee `.md`,
  conserva carpetas, convierte `[[wikilinks]]` a enlaces entre notas si el
  destino también se importa, y adjunta imágenes locales. Las notas quedan
  marcadas `imported_from: obsidian` para poder repetir sin duplicar.
- **iCloud Notes** (sin dispositivo Apple): no hay exportación oficial desde
  icloud.com. Dos opciones, por probar en este orden:
  1. `privacy.apple.com` → "Obtener una copia de tus datos": comprobar si
     incluye Notas (no está confirmado).
  2. Script de navegador (Playwright) que recorre icloud.com/notes y copia
     cada nota como HTML → Markdown. Lento pero funciona para cientos de notas.

---

## 10. Fases y entregables

Orden aprobado: backend + búsqueda → MCP → web → Android. La migración entra
cuando ya hay web para verla.

| Fase | Entregable | Hecho cuando |
|---|---|---|
| **0. Cimientos** ✅ 31 oct 2026 | Repo `samukis-notes`, `docker-compose.yml` (caddy, pocketbase, cloudflared), colecciones y API Rules, usuario `users` de Samuel, hooks de derivados y de `version`, hostname `notes.samukis.xyz` en Cloudflare | Creas y editas una nota por la API REST desde la PC y desde el celular, con `owner` aislado |
| **1. Buscador** | Contenedor `buscador`: FTS5 trigram + unicode61, embeddings, `sqlite-vec`, RRF, endpoint `/search`, reindexado por hook y completo | "reunon" encuentra "reunión"; "cosas para el viaje" encuentra una nota que dice "equipaje"; respuesta < 100 ms con 5 000 notas de prueba |
| **2. MCP** | `mcp/server.js` con las 7 herramientas, tests, conector remoto registrado en Claude | Desde Claude móvil: "busca en mis notas lo del router" devuelve la nota sin que el LLM liste nada |
| **3. PWA v1** | Shell + sidebar (carpetas, fijadas, etiquetas, papelera) + lista + editor ProseMirror + búsqueda local + adjuntos + offline + historial de versiones + ajustes (título automático) | Uso diario en PC y celular dos semanas sin volver a Apple Notes |
| **4. Migración** | Importador Obsidian + exportación de iCloud | Todas las notas viejas dentro, sin duplicados |
| **5. Android v1** | App "Notas": lista, editor, búsqueda, offline, sync, tile, share target, widget, ContentProvider, deep link | Misma prueba de dos semanas, ahora en el teléfono |
| **6. Quick Search** | Fork con sección "Notas" | Al escribir en Quick Search aparecen tus notas y se abren al tocar |
| **7. v2** | Tablas, semántica on-device, variante ME3, trazos de lápiz, carpetas inteligentes | — |

Estimación relativa de esfuerzo: Fase 3 ≈ Fase 5 > Fase 1 > Fase 0 ≈ Fase 2 >
Fase 6 > Fase 4.

---

## 11. Estructura del repo

```
samukis-notes/
├── CLAUDE.md               contexto (hereda el estilo del de tareas)
├── docker-compose.yml
├── caddy/Caddyfile
├── pocketbase/Dockerfile
├── pb_hooks/               derivados, version/conflictos, papelera 30 días, aviso al buscador
├── pb_public/              la PWA (index.html, styles.css, js/…)
│   └── js/ morphdom.js prosemirror.js state.js idb.js sync.js md.js editor.js search.js render.js actions.js boot.js
├── shared/md.js            Markdown → plain/title/tags/links (lo usan web, hooks y MCP)
├── buscador/               Python: índice FTS5 + sqlite-vec + API
├── mcp/server.js
├── importers/              obsidian.js, icloud/
├── android/                "Notas" (Kotlin + Compose)
└── tests/
```

---

## 12. Preguntas abiertas (no bloquean la Fase 0)

1. **Editor**: ¿ProseMirror vendorizado (recomendado) o editor propio?
2. **Modelo de embeddings y disco**: liberar espacio en la laptop o usar otro
   disco. ¿Cuánto hay libre de verdad?
3. **iCloud**: probar si la exportación de privacidad de Apple incluye Notas
   antes de escribir el scraper.
4. **Lenguaje del buscador**: Python (recomendado) o Node.
