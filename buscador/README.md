# buscador

Índice de búsqueda de samukis-notes: la única pieza con dependencias
(Python, `fastembed`, `sqlite-vec`). PocketBase no hace búsqueda de texto ni
embeddings, así que esto vive aparte y tiene su propia SQLite en `/data`.

## Qué hace con cada nota

| Vista | Para qué | Cómo |
|---|---|---|
| `fts_word` | palabras y prefijos, fragmentos resaltados | FTS5 `unicode61 remove_diacritics 2`, bm25 con el título ×3 |
| `fts_tri` | subcadenas y errores tipográficos | FTS5 `trigram` sobre texto plegado (minúsculas, sin tildes) |
| `vec` | semántica ("cosas para el viaje" → "equipaje") | `sqlite-vec`, un vector por trozo de ~700 caracteres con el título delante |

Las tres listas se funden con RRF (reciprocal rank fusion). Las notas en la
papelera se indexan pero no se embeben, y solo salen con `trashed=1`.

Se alimenta de dos formas: el hook `pb_hooks/search.pb.js` avisa de cada
nota que cambia, y cada `SYNC_SECONDS` se piden a PocketBase las notas
cambiadas desde la última vez (si el hook falló, se recupera). Al arrancar
reindexa todo y poda lo borrado. Un cambio de `EMBED_MODEL` tira los vectores
y los recalcula.

## API

Caddy pasa `/search*` tal cual (sin recortar el prefijo).

### `GET /search`

Cabecera `Authorization: <token de usuario de PocketBase>` (el mismo que usa
la web). El buscador lo valida con PocketBase y busca solo en las notas de
ese usuario.

| Parámetro | Por defecto | |
|---|---|---|
| `q` | — | obligatorio |
| `limit` | 10 | máx. 50 |
| `folder` | — | id de carpeta |
| `tag` | — | etiqueta, con o sin `#` |
| `trashed` | 0 | `1` busca en la papelera |
| `semantic` | 1 | `0` apaga los vectores (más rápido, solo léxico) |

```json
{
  "results": [
    {
      "id": "abc123", "title": "Router de casa", "folder": "f1", "tags": ["redes"],
      "fragment": "…la clave del router está en…",
      "fragment_html": "…la clave del <mark>router</mark> está en…",
      "score": 0.0322, "updated": "2026-10-31 13:20:00.000Z"
    }
  ],
  "took_ms": 48
}
```

`fragment_html` es `null` cuando la nota entró solo por semántica o por
trigramas (no hay palabra exacta que marcar); entonces `fragment` es el
inicio del texto. La UI de resaltado está apagada en v1: el dato ya viene.

### `GET /search/health`

`{ ok, ready, model, notes, last_sync, error }`. `ready` es `false` mientras
carga el modelo (la primera vez lo descarga a `/data/models`).

### `POST /search/index` y `POST /search/reindex`

Internas, con cabecera `X-Index-Token` (el `INDEX_TOKEN` del `.env`). Caddy
las cierra en la entrada pública. `index` recibe
`{ id, owner, folder, title, plain, tags, trashed_at, updated }` o
`{ id, deleted: true }`; `reindex` lanza un reindexado completo.

## Variables

`PB_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `INDEX_TOKEN`,
`EMBED_MODEL` (por defecto `jinaai/jina-embeddings-v2-base-es`),
`SYNC_SECONDS` (60), `DATA_DIR` (`/data`), `PORT` (8095).

## Probar

```bash
PB_URL=http://127.0.0.1:8093 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/search-smoke.mjs
```
