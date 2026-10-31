"""Cliente mínimo de PocketBase para el buscador (solo urllib, sin SDK).

Dos usos:
- como superusuario, para leer TODAS las notas al reindexar (el buscador
  guarda el `owner` de cada una y filtra por él en cada consulta);
- para saber quién pregunta: la web y el MCP mandan el token del usuario y
  aquí se valida contra PocketBase (`auth-refresh`), con un caché corto para
  no pegarle en cada tecla.
"""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

NOTE_FIELDS = "id,owner,folder,title,plain,tags,trashed_at,updated"


class PBError(Exception):
    def __init__(self, status, message):
        super().__init__(f"{status}: {message}")
        self.status = status


class PB:
    def __init__(self, url, admin_email, admin_password):
        self.url = url.rstrip("/")
        self.admin_email = admin_email
        self.admin_password = admin_password
        self._admin_token = None
        self._admin_at = 0.0
        self._users = {}          # token -> (uid, expira)
        self._lock = threading.Lock()

    # ── HTTP ────────────────────────────────────────────────────────
    def request(self, method, path, body=None, token=None, timeout=20):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", token)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("message", "")
            except Exception:
                msg = ""
            raise PBError(e.code, msg or e.reason)

    # ── superusuario ────────────────────────────────────────────────
    def admin_token(self, force=False):
        with self._lock:
            # el token de PocketBase dura horas; se renueva cada 30 min por si acaso
            if force or not self._admin_token or time.time() - self._admin_at > 1800:
                res = self.request("POST", "/api/collections/_superusers/auth-with-password",
                                   {"identity": self.admin_email, "password": self.admin_password})
                self._admin_token = res["token"]
                self._admin_at = time.time()
            return self._admin_token

    def _admin_get(self, path):
        try:
            return self.request("GET", path, token=self.admin_token())
        except PBError as e:
            if e.status in (401, 403):
                return self.request("GET", path, token=self.admin_token(force=True))
            raise

    def iter_notes(self, since=None, page_size=200):
        """Todas las notas (de todos los usuarios), opcionalmente las
        actualizadas desde `since` (texto de fecha de PocketBase)."""
        page = 1
        while True:
            params = {"perPage": page_size, "page": page, "sort": "updated", "fields": NOTE_FIELDS,
                      "skipTotal": 1}
            if since:
                params["filter"] = f'updated >= "{since}"'
            res = self._admin_get("/api/collections/notes/records?" + urllib.parse.urlencode(params))
            items = res.get("items", [])
            for it in items:
                yield it
            if len(items) < page_size:
                return
            page += 1

    # ── quién pregunta ──────────────────────────────────────────────
    def user_id(self, token):
        """El id del usuario dueño de `token`, o None si no vale. Caché de 60 s."""
        if not token:
            return None
        now = time.time()
        hit = self._users.get(token)
        if hit and hit[1] > now:
            return hit[0]
        try:
            res = self.request("POST", "/api/collections/users/auth-refresh", {}, token=token, timeout=10)
            uid = res.get("record", {}).get("id")
        except PBError:
            uid = None
        if uid:
            self._users[token] = (uid, now + 60)
            if len(self._users) > 500:
                self._users = {k: v for k, v in self._users.items() if v[1] > now}
        return uid
