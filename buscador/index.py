"""El índice: SQLite propia con tres vistas de cada nota y un ranking híbrido.

- `fts_word`  FTS5 unicode61 sin tildes: palabras y prefijos ("reun" → reunión),
              con bm25 y el título pesando más que el cuerpo. Da los fragmentos.
- `fts_tri`   FTS5 trigram: subcadenas y tolerancia a errores ("reunon" sigue
              compartiendo trigramas con "reunion").
- `vec`       sqlite-vec: embeddings por trozo de nota, para lo semántico
              ("cosas para el viaje" encuentra "equipaje").

Todo el texto se pliega antes (minúsculas, sin diacríticos) con `fold`, tanto
al indexar como al consultar, así "Reunión", "reunion" y "REUNIÓN" son lo
mismo en las tres vistas.

Las tres listas se funden con RRF (reciprocal rank fusion): no hay que
calibrar puntajes de naturaleza distinta, solo posiciones.
"""
import hashlib
import json
import re
import sqlite3
import threading
import unicodedata

import sqlite_vec
from fastembed import TextEmbedding

CHUNK_CHARS = 700        # tamaño de cada trozo que se embebe
CHUNK_OVERLAP = 120
RRF_K = 60
WEIGHTS = {"word": 1.0, "tri": 0.8, "vec": 1.0}
CANDIDATES = 60          # cuántos pide cada vista antes de fundir
SNIPPET_TOKENS = 20


def fold(s):
    """Minúsculas y sin diacríticos (NFKD y fuera las marcas combinantes)."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def tokens(q):
    return [t for t in re.findall(r"[^\W_]+", fold(q)) if t]


def chunks(title, plain):
    """Trozos de ~CHUNK_CHARS con solape, cortando en párrafos cuando se puede.
    Cada trozo lleva el título delante: el embedding sabe de qué nota es."""
    text = (plain or "").strip()
    head = (title or "").strip()
    if not text:
        return [head] if head else []
    out, start = [], 0
    while start < len(text):
        end = min(len(text), start + CHUNK_CHARS)
        if end < len(text):
            cut = text.rfind("\n", start + CHUNK_CHARS // 2, end)
            if cut == -1:
                cut = text.rfind(" ", start + CHUNK_CHARS // 2, end)
            if cut != -1:
                end = cut
        piece = text[start:end].strip()
        if piece:
            out.append((head + "\n\n" + piece) if head and not piece.startswith(head) else piece)
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return out


def _tags_list(v):
    if isinstance(v, list):
        return [str(t) for t in v]
    if isinstance(v, str) and v:
        try:
            j = json.loads(v)
            return [str(t) for t in j] if isinstance(j, list) else []
        except ValueError:
            return []
    return []


class Index:
    def __init__(self, path, model_name, cache_dir):
        self.lock = threading.RLock()
        self.model_name = model_name
        self.model = TextEmbedding(model_name=model_name, cache_dir=cache_dir)
        self.dim = len(next(self.model.embed(["hola"])))
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.enable_load_extension(True)
        sqlite_vec.load(self.db)
        self.db.enable_load_extension(False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self._schema()

    # ── esquema ─────────────────────────────────────────────────────
    def _schema(self):
        c = self.db
        c.executescript("""
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, folder TEXT, title TEXT, plain TEXT,
            tags TEXT, trashed INTEGER NOT NULL DEFAULT 0, updated TEXT, hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes (owner, trashed);
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_word USING fts5(
            id UNINDEXED, owner UNINDEXED, title, body,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_tri USING fts5(
            id UNINDEXED, owner UNINDEXED, text, tokenize = 'trigram'
        );
        """)
        # Si cambia el modelo, los vectores viejos no sirven: fuera la tabla.
        row = c.execute("SELECT v FROM meta WHERE k = 'model'").fetchone()
        if row and row[0] != f"{self.model_name}:{self.dim}":
            c.execute("DROP TABLE IF EXISTS vec")
            c.execute("UPDATE notes SET hash = ''")
        c.execute(f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec USING vec0(
            chunk_id TEXT PRIMARY KEY, note_id TEXT, owner TEXT PARTITION KEY,
            embedding float[{self.dim}]
        )""")
        c.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('model', ?)", (f"{self.model_name}:{self.dim}",))
        c.commit()

    def get_meta(self, k, default=None):
        row = self.db.execute("SELECT v FROM meta WHERE k = ?", (k,)).fetchone()
        return row[0] if row else default

    def set_meta(self, k, v):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", (k, v))
            self.db.commit()

    # ── escritura ───────────────────────────────────────────────────
    def upsert(self, note, force=False):
        """`note` con id, owner, folder, title, plain, tags, trashed_at, updated.
        Devuelve True si tocó el índice (hash distinto)."""
        nid = note["id"]
        title = note.get("title") or ""
        plain = note.get("plain") or ""
        tags = _tags_list(note.get("tags"))
        trashed = 1 if note.get("trashed_at") else 0
        folder = note.get("folder") or ""
        owner = note["owner"]
        h = hashlib.sha1(json.dumps([title, plain, tags, trashed, folder, owner], ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            old = self.db.execute("SELECT hash FROM notes WHERE id = ?", (nid,)).fetchone()
            if old and old[0] == h and not force:
                return False
            self._delete_rows(nid)
            self.db.execute(
                "INSERT OR REPLACE INTO notes (id, owner, folder, title, plain, tags, trashed, updated, hash) VALUES (?,?,?,?,?,?,?,?,?)",
                (nid, owner, folder, title, plain, json.dumps(tags, ensure_ascii=False), trashed, note.get("updated") or "", h))
            # fts_word guarda el texto ORIGINAL: unicode61 ya pliega mayúsculas y
            # tildes al tokenizar, y así el fragmento (snippet) sale con su forma real.
            self.db.execute("INSERT INTO fts_word (id, owner, title, body) VALUES (?,?,?,?)",
                            (nid, owner, title, plain))
            self.db.execute("INSERT INTO fts_tri (id, owner, text) VALUES (?,?,?)",
                            (nid, owner, fold(title + "\n" + plain)))
            if not trashed:
                pieces = chunks(title, plain)
                if pieces:
                    for i, emb in enumerate(self.model.embed(pieces)):
                        self.db.execute("INSERT INTO vec (chunk_id, note_id, owner, embedding) VALUES (?,?,?,?)",
                                        (f"{nid}:{i}", nid, owner, sqlite_vec.serialize_float32(emb.tolist())))
            self.db.commit()
            return True

    def _delete_rows(self, nid):
        self.db.execute("DELETE FROM notes WHERE id = ?", (nid,))
        self.db.execute("DELETE FROM fts_word WHERE id = ?", (nid,))
        self.db.execute("DELETE FROM fts_tri WHERE id = ?", (nid,))
        self.db.execute("DELETE FROM vec WHERE note_id = ?", (nid,))

    def remove(self, nid):
        with self.lock:
            self._delete_rows(nid)
            self.db.commit()

    def prune(self, keep_ids):
        """Quita del índice lo que ya no existe en PocketBase."""
        with self.lock:
            have = [r[0] for r in self.db.execute("SELECT id FROM notes")]
            gone = [i for i in have if i not in keep_ids]
            for i in gone:
                self._delete_rows(i)
            self.db.commit()
            return len(gone)

    def count(self):
        return self.db.execute("SELECT count(*) FROM notes").fetchone()[0]

    # ── búsqueda ────────────────────────────────────────────────────
    def search(self, owner, q, limit=10, folder=None, tag=None, trashed=False, semantic=True):
        toks = tokens(q)
        if not toks:
            return []
        limit = max(1, min(int(limit or 10), 50))
        ranked = {}            # id -> puntaje RRF

        def add(view, ids):
            w = WEIGHTS[view]
            for rank, nid in enumerate(ids):
                ranked[nid] = ranked.get(nid, 0.0) + w / (RRF_K + rank + 1)

        with self.lock:
            # 1. palabras y prefijos (bm25: título ×3)
            word_q = " AND ".join(f'"{t}"*' for t in toks)
            try:
                rows = self.db.execute(
                    "SELECT id FROM fts_word WHERE owner = ? AND fts_word MATCH ? ORDER BY bm25(fts_word, 0, 0, 3.0, 1.0) LIMIT ?",
                    (owner, word_q, CANDIDATES)).fetchall()
                add("word", [r[0] for r in rows])
            except sqlite3.OperationalError:
                pass
            # 2. trigramas: cada palabra de ≥3 letras, en OR, y la frase entera
            tri_terms = [t for t in toks if len(t) >= 3]
            if tri_terms:
                tri_q = " OR ".join(f'"{t}"' for t in tri_terms)
                phrase = fold(q).strip()
                if len(phrase) >= 3 and len(tri_terms) > 1:
                    tri_q = f'"{phrase}" OR ' + tri_q
                try:
                    rows = self.db.execute(
                        "SELECT id FROM fts_tri WHERE owner = ? AND fts_tri MATCH ? ORDER BY bm25(fts_tri) LIMIT ?",
                        (owner, tri_q, CANDIDATES)).fetchall()
                    add("tri", [r[0] for r in rows])
                except sqlite3.OperationalError:
                    pass
            # 3. semántica
            if semantic and len(fold(q).strip()) >= 3:
                emb = next(self.model.embed([q.strip()]))
                rows = self.db.execute(
                    "SELECT note_id, min(distance) AS d FROM vec WHERE owner = ? AND embedding MATCH ? AND k = ? GROUP BY note_id ORDER BY d",
                    (owner, sqlite_vec.serialize_float32(emb.tolist()), CANDIDATES)).fetchall()
                add("vec", [r[0] for r in rows])

            if not ranked:
                return []
            ids = sorted(ranked, key=lambda i: -ranked[i])
            out = []
            for nid in ids:
                row = self.db.execute("SELECT id, owner, folder, title, plain, tags, trashed, updated FROM notes WHERE id = ?", (nid,)).fetchone()
                if not row:
                    continue
                _, _, nfolder, title, plain, ntags, ntrashed, updated = row
                if bool(ntrashed) != bool(trashed):
                    continue
                if folder and nfolder != folder:
                    continue
                tag_list = json.loads(ntags or "[]")
                if tag and fold(tag).lstrip("#") not in [fold(t) for t in tag_list]:
                    continue
                frag_html = self._snippet(nid, word_q)
                frag = re.sub(r"</?mark>", "", frag_html) if frag_html else (plain or "")[:160].replace("\n", " ")
                out.append({
                    "id": nid, "title": title, "folder": nfolder or None, "tags": tag_list,
                    "fragment": frag, "fragment_html": frag_html or None,
                    "score": round(ranked[nid], 5), "updated": updated,
                })
                if len(out) >= limit:
                    break
            return out

    def _snippet(self, nid, word_q):
        """Fragmento con <mark> alrededor de lo que coincidió, con el texto tal
        cual (mayúsculas y tildes). None si no hubo coincidencia de palabras
        (p. ej. resultado solo semántico o solo por trigramas)."""
        try:
            row = self.db.execute(
                "SELECT snippet(fts_word, 3, '<mark>', '</mark>', '…', ?) FROM fts_word WHERE id = ? AND fts_word MATCH ?",
                (SNIPPET_TOKENS, nid, word_q)).fetchone()
            return row[0].replace("\n", " ") if row and row[0] else None
        except sqlite3.OperationalError:
            return None
