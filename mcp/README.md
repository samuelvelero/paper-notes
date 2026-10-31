# Servidor MCP de Notas

Deja que Claude busque, lea y escriba en tus notas con tu cuenta. Un solo
archivo, `server.js`, sin dependencias (Node ≥ 18). Habla con PocketBase y
con el buscador; nunca con el superusuario.

## Herramientas

| Herramienta | Para qué |
|---|---|
| `notas_buscar` | Búsqueda híbrida (semántica + palabras + errores tipográficos) ya ordenada, con fragmento. Filtros: `carpeta`, `etiqueta`, `incluir_papelera`, `solo_lexico` |
| `nota_leer` | Una nota completa en Markdown, por `id` o por `titulo` |
| `nota_crear` | `contenido` (Markdown), `titulo` opcional (se antepone como `# Título`), `carpeta`, `fijada` |
| `nota_agregar` | Añade texto al `final` o al `inicio` (debajo del título) sin reescribir el resto |
| `nota_actualizar` | Reemplaza el cuerpo entero, mueve (`carpeta`, `"ninguna"` = raíz), fija, `papelera: true/false` |
| `notas_recientes` | Últimas editadas con extracto; por carpeta, etiqueta, fijadas primero o papelera |
| `carpetas_listar` | Árbol de carpetas con conteos, sueltas, papelera y etiquetas en uso |

## Reglas que respeta (son las de la web)

- **Una carpeta debe existir.** Si no, la herramienta falla, lista las carpetas
  reales y no escribe nada. Solo `crear_carpeta: true` la crea.
- **Lee antes de escribir.** `nota_agregar` y `nota_actualizar` mandan
  `base_version`; si alguien guardó entre medias, gana lo que llega, la otra
  versión queda en `note_versions` y la respuesta lo avisa.
- **Nada se borra.** Como máximo `papelera: true`; el servidor la vacía a los
  30 días. Para sacar una nota de la papelera, `papelera: false`.
- `title`, `plain`, `tags` y `links` los deriva el servidor del Markdown con
  el mismo `md.js` de la web; el MCP solo manda `body`.
- Si el buscador no responde (arrancando, modelo cargando), `notas_buscar`
  cae a una búsqueda por palabras exactas en PocketBase y lo dice en `aviso`.

Tests de las reglas puras: `node --test tests/mcp.test.js`. Recorrido completo
contra un servidor vivo:

```bash
PB_URL=http://127.0.0.1:8093 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/mcp-smoke.mjs
```

## Registrarlo en Claude Code o Claude Desktop (stdio, en esta máquina)

```bash
claude mcp add notas --scope user \
  -e NOTAS_URL=http://<servidor>:8093 \
  -e NOTAS_EMAIL=tu@correo.com \
  -e NOTAS_PASSWORD=tu-clave \
  -- node /ruta/a/samukis-notes/mcp/server.js
```

Claude Desktop: lo mismo en `mcpServers` de `claude_desktop_config.json`
(`command: "node"`, `args: [ruta]`, `env: {…}`). Variables opcionales:
`NOTAS_TZ` (def. `America/Lima`), `NOTAS_SEARCH_URL` (def. `NOTAS_URL/search`),
`NOTAS_MD_JS` (ruta a `md.js`; por defecto la del repo).

## Conector remoto (Claude web y móvil, sin la PC encendida)

El servicio `mcp` de `docker-compose.yml` corre `server.js` en modo HTTP
(`MCP_HTTP_PORT=8092`) dentro del servidor de casa; Caddy lo publica en
`/mcp/<MCP_PATH_TOKEN>` y el túnel de Cloudflare lo saca como
`https://notes.samukis.xyz/mcp/<MCP_PATH_TOKEN>`. Claude web y móvil se
conectan desde la nube de Anthropic, por eso es público: **el token de la
URL es la única llave**, trátalo como una contraseña.

- Añadirlo: Claude → Ajustes → Conectores → Añadir conector personalizado →
  pegar la URL (sin OAuth).
- Rotar el token: cambiar `MCP_PATH_TOKEN` en el `.env` del servidor y
  `docker compose up -d mcp`; luego actualizar la URL en Claude.
- Cambió `server.js`: `docker compose restart mcp` (se monta, no se construye).
- Variables del `.env`: `MCP_PATH_TOKEN`, `MCP_NOTAS_EMAIL`, `MCP_NOTAS_PASSWORD`.

Solo responde JSON a `POST` (la especificación lo permite); sin SSE ni
sesiones. Cualquier otra ruta o método es un 404/405 mudo.
