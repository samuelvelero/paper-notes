"""El servicio `buscador`: HTTP sin frameworks (stdlib) delante del índice.

Rutas (Caddy las enruta con su prefijo /search, sin recortarlo):

  GET  /search?q=…&limit=10&folder=&tag=&trashed=0&semantic=1
       Authorization: <token de usuario de PocketBase>
       → { "results": [ {id, title, folder, tags, fragment, fragment_html, score, updated}, … ] }
       Ya ordenados: quien llama (web, MCP) no tiene que rankear ni paginar.
  GET  /search/health      → { ok, ready, notes, model }
  POST /search/index       X-Index-Token  (lo llama el hook de PocketBase)
       { id, owner, folder, title, plain, tags, trashed_at, updated }  ó  { id, deleted: true }
  POST /search/reindex     X-Index-Token  → reindexa todo en segundo plano

Además del aviso del hook, cada SYNC_SECONDS pide a PocketBase las notas
cambiadas desde la última vez: si el hook falló, se recupera solo. Al
arrancar reindexa todo (y poda lo que ya no exista).
"""
import json
import os
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from index import Index
from pb import PB, PBError

PORT = int(os.environ.get("PORT", "8095"))
DATA_DIR = os.environ.get("DATA_DIR", "/data")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "jinaai/jina-embeddings-v2-base-es")
INDEX_TOKEN = os.environ.get("INDEX_TOKEN", "")
SYNC_SECONDS = int(os.environ.get("SYNC_SECONDS", "60"))
PB_URL = os.environ.get("PB_URL", "http://pocketbase:8090")

state = {"ready": False, "index": None, "pb": None, "last_sync": None, "error": None}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ── sincronización con PocketBase ─────────────────────────────────────
def full_sync():
    idx, pb = state["index"], state["pb"]
    t0 = time.time()
    keep, touched = set(), 0
    for note in pb.iter_notes():
        keep.add(note["id"])
        if idx.upsert(note):
            touched += 1
    gone = idx.prune(keep)
    state["last_sync"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t0 - 5))
    idx.set_meta("last_sync", state["last_sync"])
    log(f"reindex completo: {len(keep)} notas, {touched} reindexadas, {gone} podadas, {time.time() - t0:.1f}s")


def incremental_sync():
    idx, pb = state["index"], state["pb"]
    since = state["last_sync"]
    t0 = time.time()
    n = 0
    for note in pb.iter_notes(since=since):
        if idx.upsert(note):
            n += 1
    state["last_sync"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t0 - 5))
    idx.set_meta("last_sync", state["last_sync"])
    if n:
        log(f"sync: {n} notas actualizadas")


def sync_loop():
    while True:
        try:
            if state["last_sync"]:
                incremental_sync()
            else:
                full_sync()
            state["error"] = None
        except Exception as e:  # PocketBase caído, red… se reintenta en el siguiente ciclo
            state["error"] = str(e)
            log("sync falló:", e)
        time.sleep(SYNC_SECONDS)


def boot():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        log("cargando modelo", EMBED_MODEL)
        state["index"] = Index(os.path.join(DATA_DIR, "index.sqlite"), EMBED_MODEL, os.path.join(DATA_DIR, "models"))
        state["pb"] = PB(PB_URL, os.environ["PB_ADMIN_EMAIL"], os.environ["PB_ADMIN_PASSWORD"])
        log(f"modelo listo (dim {state['index'].dim}); notas en el índice: {state['index'].count()}")
        state["ready"] = True
        threading.Thread(target=sync_loop, daemon=True).start()
    except Exception as e:
        state["error"] = str(e)
        log("no pude arrancar:", e)
        traceback.print_exc()


# ── HTTP ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "buscador/1"

    def log_message(self, fmt, *args):   # solo errores, no cada petición
        if args and str(args[1]).startswith(("4", "5")):
            log(self.address_string(), fmt % args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _internal_ok(self):
        return INDEX_TOKEN and self.headers.get("X-Index-Token") == INDEX_TOKEN

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path.rstrip("/")
        if path in ("/search/health", "/health"):
            idx = state["index"]
            return self._json(200, {"ok": True, "ready": state["ready"], "model": EMBED_MODEL,
                                    "notes": idx.count() if idx else 0, "last_sync": state["last_sync"],
                                    "error": state["error"]})
        if path == "/search":
            if not state["ready"]:
                return self._json(503, {"message": "El buscador todavía está arrancando."})
            uid = state["pb"].user_id(self.headers.get("Authorization", "").replace("Bearer ", "", 1))
            if not uid:
                return self._json(401, {"message": "Hace falta un token de usuario válido."})
            qs = urllib.parse.parse_qs(url.query)
            get = lambda k, d=None: (qs.get(k) or [d])[0]
            q = (get("q") or "").strip()
            if not q:
                return self._json(400, {"message": "Falta q."})
            try:
                t0 = time.time()
                res = state["index"].search(
                    uid, q, limit=get("limit", 10), folder=get("folder") or None, tag=get("tag") or None,
                    trashed=get("trashed", "0") in ("1", "true"), semantic=get("semantic", "1") not in ("0", "false"))
                return self._json(200, {"results": res, "took_ms": round((time.time() - t0) * 1000)})
            except Exception as e:
                traceback.print_exc()
                return self._json(500, {"message": f"La búsqueda falló: {e}"})
        self._json(404, {"message": "No existe."})

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        if path in ("/search/index", "/index", "/search/reindex", "/reindex"):
            if not self._internal_ok():
                return self._json(403, {"message": "Token interno incorrecto."})
            if not state["ready"]:
                return self._json(503, {"message": "Arrancando; el sync periódico lo recogerá."})
            if path.endswith("reindex"):
                threading.Thread(target=full_sync, daemon=True).start()
                return self._json(202, {"ok": True})
            try:
                note = self._body()
                if note.get("deleted"):
                    state["index"].remove(note["id"])
                else:
                    state["index"].upsert(note)
                return self._json(200, {"ok": True})
            except Exception as e:
                traceback.print_exc()
                return self._json(500, {"message": str(e)})
        self._json(404, {"message": "No existe."})


if __name__ == "__main__":
    threading.Thread(target=boot, daemon=True).start()   # el modelo tarda en cargar; /health responde mientras
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log("escuchando en", PORT)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
