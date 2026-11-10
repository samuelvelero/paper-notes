/* ═══════════════ sync.js — PocketBase: sesión, cola, realtime ═══════════════
   La fórmula de tareas con lo que cambia en notas (PLAN.md §4):
   - cada guardado es la nota entera (`body`) con `base_version`; si el
     servidor tenía una más nueva, responde X-Note-Conflict y la vieja queda
     en note_versions. Aquí solo se avisa.
   - mover, fijar y papelera viajan por la misma cola.
   - las imágenes se suben aparte (multipart) y sin conexión esperan en el
     store `files` con su id ya decidido, para que el Markdown no cambie. */
'use strict';

const PBC = {
  base: '',
  get token() { return localStorage.getItem('pb_token') || ''; },
  set token(v) { v ? localStorage.setItem('pb_token', v) : localStorage.removeItem('pb_token'); },
  get uid() { return localStorage.getItem('pb_uid') || ''; },
  set uid(v) { v ? localStorage.setItem('pb_uid', v) : localStorage.removeItem('pb_uid'); },
  async login(email, pass) {
    const r = await fetch(this.base + '/api/collections/users/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pass }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || 'Credenciales incorrectas');
    this.token = d.token; this.uid = d.record && d.record.id || ''; localStorage.setItem('pb_email', email);
    return d;
  },
  logout() { this.token = ''; this.uid = ''; },
  /* Devuelve el JSON; en `__conflict` va la cabecera X-Note-Conflict si la hubo. */
  async api(method, path, body) {
    if (!this.token && !path.includes('auth-with-password') && !path.includes('auth-refresh')) { showLogin('Sesión vencida, entra de nuevo.'); throw new Error('sesión vencida'); }
    const isFD = body instanceof FormData;
    const headers = this.token ? { Authorization: this.token } : {};
    if (!isFD) headers['Content-Type'] = 'application/json';
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), isFD ? 120000 : 20000);
    let r;
    try { r = await fetch(this.base + path, { method, headers, body: body ? (isFD ? body : JSON.stringify(body)) : undefined, signal: ac.signal }); }
    catch (e) { const err = new Error(e.name === 'AbortError' ? 'el servidor no respondió a tiempo' : 'no se pudo conectar con el servidor'); err.status = 0; throw err; }
    finally { clearTimeout(tm); }
    if (r.status === 401) { this.token = ''; showLogin('Sesión vencida, entra de nuevo.'); throw new Error('sesión vencida'); }
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(data.message || ('HTTP ' + r.status)); err.status = r.status; err.data = data.data; throw err; }
    const c = r.headers.get('X-Note-Conflict');
    if (c) data.__conflict = c;
    return data;
  },
  async refresh() {
    if (!this.token) return;
    try { const d = await this.api('POST', '/api/collections/users/auth-refresh'); if (d.token) { this.token = d.token; this.uid = d.record && d.record.id || ''; if (d.record && d.record.settings) applyAccountSettings(d.record.settings); } } catch (_) { }
  },
  async listAll(col, sort, fields) {
    let page = 1, out = [];
    for (;;) {
      const d = await this.api('GET', `/api/collections/${col}/records?page=${page}&perPage=500&skipTotal=1&sort=${encodeURIComponent(sort || '-updated')}${fields ? '&fields=' + encodeURIComponent(fields) : ''}`);
      out = out.concat(d.items || []);
      if (!d.items || d.items.length < 500) break;
      page++;
    }
    return out;
  },
};
function applyAccountSettings(s) {
  if (s && typeof s === 'object' && 'autoTitle' in s) settings.autoTitle = !!s.autoTitle;
}

/* ─── mapeo registro ↔ objeto local ─── */
const fromRec = {
  notes: r => ({ id: r.id, folder: r.folder || '', body: r.body || '', title: r.title || '', plain: r.plain || '', tags: r.tags || [], links: r.links || [],
    pinned: !!r.pinned, trashed_at: r.trashed_at || '', version: r.version || 0, created: r.created, updated: r.updated, client_updated: r.client_updated || '', device: r.device || '', share: r.share || '' }),
  folders: r => ({ id: r.id, name: r.name || '', parent: r.parent || '', order: r.order || '', icon: r.icon || '' }),
  attachments: r => ({ id: r.id, note: r.note || '', file: r.file || '', kind: r.kind || 'image', width: r.width || 0, height: r.height || 0 }),
};
/* Solo lo que el cliente escribe: los derivados los pone el hook. */
const toRec = {
  notes: n => ({ folder: n.folder || '', body: n.body, pinned: !!n.pinned, trashed_at: n.trashed_at || '', share: n.share || '', client_updated: n.client_updated || new Date().toISOString(), device: 'web' }),
  folders: f => ({ name: f.name, parent: f.parent || '', order: f.order || '', icon: f.icon || '' }),
};
const colArr = kind => kind === 'notes' ? notes : kind === 'folders' ? folders : attachments;

/* ─── cola: debounce por registro + eco ─── */
const _pend = new Map(), _echo = new Map();
const markEcho = id => _echo.set(id, Date.now());
const isEcho = id => { const t = _echo.get(id); return t && Date.now() - t < 4000; };

let _isDraining = false, _syncErr = '';
async function drainSyncQueue() {
  if (_isDraining) return;
  _isDraining = true;
  try {
    const ops = await idbGetAllSync();
    let fallo = '';
    for (const op of ops) {
      if (!navigator.onLine) break;
      try {
        markEcho(op.id);
        let res;
        if (op.method === 'UPLOAD') res = await uploadPending(op);
        else {
          try { res = await PBC.api(op.method, op.path, op.body); }
          catch (e) {
            /* PATCH sobre un registro que nunca llegó a existir (el POST se perdió): se crea */
            if (op.method !== 'PATCH' || e.status !== 404) throw e;
            const { base_version, ...rest } = op.body; void base_version;
            res = await PBC.api('POST', op.path.replace(/\/[^/]+$/, ''), { id: op.id, ...rest });
          }
        }
        await idbRemoveSync(op.id);
        if (res && op.kind === 'notes') afterNoteSaved(op.id, res);
      } catch (e) {
        if (String(e.message).includes('sesión')) break;
        if (e.status === 0) { fallo = e.message; break; }
        if (op.method === 'DELETE' && e.status === 404) { await idbRemoveSync(op.id); continue; }
        fallo = e.message;
        continue;   // un fallo de ESTA operación no atasca las demás
      }
    }
    _syncErr = fallo;
  } catch (e) { _syncErr = String(e && e.message || e); }
  finally { _isDraining = false; }
  netOk();
}
/* La respuesta del servidor trae `version` y los derivados oficiales. */
function afterNoteSaved(id, res) {
  const n = noteById(id);
  if (n && res.id === id) {
    n.version = res.version || n.version;
    n.updated = res.updated || n.updated;
    if (res.title !== undefined) { n.title = res.title; n.plain = res.plain || ''; n.tags = res.tags || []; n.links = res.links || []; }
    idbPut('notes', n);
  }
  if (res.__conflict && typeof toast === 'function') toast('Esta nota tenía otra versión guardada; la encuentras en el historial', { dur: 7000 });
  if (typeof schedulePaint === 'function') schedulePaint();
}

function queueSave(kind, obj, opts) {
  if (!obj || !obj.id) return;
  opts = opts || {};
  idbPut(kind, obj);
  const body = toRec[kind](obj);
  if (kind === 'notes' && opts.bodyChanged) body.base_version = obj.version || 0;
  const op = { id: obj.id, kind, method: 'PATCH', path: `/api/collections/${kind}/records/${obj.id}`, body, ts: Date.now() };
  idbPutSync(op);
  const k = kind + ':' + obj.id;
  clearTimeout(_pend.get(k));
  _pend.set(k, setTimeout(() => { _pend.delete(k); if (navigator.onLine) drainSyncQueue(); }, opts.now ? 0 : 500));
  netPing();
}
function createRec(kind, obj) {
  if (!obj || !obj.id) return;
  idbPut(kind, obj);
  const op = { id: obj.id, kind, method: 'POST', path: `/api/collections/${kind}/records`, body: { id: obj.id, ...toRec[kind](obj) }, ts: Date.now() };
  idbPutSync(op);
  netPing();
  if (navigator.onLine) drainSyncQueue();
}
function removeRec(kind, id) {
  idbDelete(kind, id);
  const op = { id, kind, method: 'DELETE', path: `/api/collections/${kind}/records/${id}`, ts: Date.now() };
  idbPutSync(op);
  const k = kind + ':' + id; clearTimeout(_pend.get(k)); _pend.delete(k);
  netPing();
  if (navigator.onLine) drainSyncQueue();
}

/* ─── imágenes ───
   Con conexión se suben al momento. Sin ella, el blob espera en `files` y
   la cola lleva una operación UPLOAD con el id ya elegido: el Markdown
   (`attachments/<id>`) no cambia nunca. */
const _blobUrls = new Map();
async function uploadImage(noteId, file) {
  const id = genId();
  const att = { id, note: noteId, file: '', kind: 'image', width: 0, height: 0, pending: true };
  attachments.push(att);
  _blobUrls.set(id, URL.createObjectURL(file));
  await idbPut('files', { id, note: noteId, blob: file, name: file.name || 'imagen.png', type: file.type });
  await idbPutSync({ id, kind: 'attachments', method: 'UPLOAD', ts: Date.now() });
  netPing();
  if (navigator.onLine) drainSyncQueue();
  return id;
}
async function uploadPending(op) {
  const f = await idbGet('files', op.id);
  if (!f) return null;   // ya no está: nada que subir
  const fd = new FormData();
  fd.append('id', op.id); fd.append('note', f.note); fd.append('kind', 'image');
  fd.append('file', f.blob, f.name || 'imagen.png');
  let res;
  try { res = await PBC.api('POST', '/api/collections/attachments/records', fd); }
  catch (e) {
    /* la nota aún no subió (su POST está detrás en la cola): se reintenta en la próxima vuelta */
    if (e.status === 400 || e.status === 404) { const err = new Error('la imagen espera a su nota'); err.status = 400; throw err; }
    throw e;
  }
  const a = fromRec.attachments(res);
  const i = attachments.findIndex(x => x.id === a.id);
  if (i >= 0) attachments[i] = a; else attachments.push(a);
  idbPut('attachments', a);
  await idbDelete('files', op.id);
  return res;
}
/* URL de una imagen por id: el blob local mientras no ha subido, luego el archivo de PocketBase. */
function attUrl(id, thumb) {
  const a = attachments.find(x => x.id === id);
  if (a && a.file) return `${PBC.base}/api/files/attachments/${a.id}/${a.file}${thumb ? '?thumb=' + thumb : ''}`;
  return _blobUrls.get(id) || '';
}
/* Al arrancar, los blobs pendientes vuelven a tener URL. */
async function restoreBlobUrls() {
  const fs = await idbGetAll('files');
  for (const f of fs) {
    if (!_blobUrls.has(f.id)) _blobUrls.set(f.id, URL.createObjectURL(f.blob));
    if (!attachments.some(a => a.id === f.id)) attachments.push({ id: f.id, note: f.note, file: '', kind: 'image', pending: true });
  }
}

let _drainTimer = setInterval(() => { if (navigator.onLine) drainSyncQueue(); }, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(_drainTimer); _drainTimer = null; }
  else if (!_drainTimer) { _drainTimer = setInterval(() => { if (navigator.onLine) drainSyncQueue(); }, 5000); if (navigator.onLine) drainSyncQueue(); }
});

/* ─── realtime (SSE de PocketBase, a mano) ─── */
let _es = null;
function realtimeConnect() {
  if (typeof EventSource === 'undefined') return;
  try { _es && _es.close(); } catch (_) { }
  _es = new EventSource(PBC.base + '/api/realtime');
  _es.addEventListener('PB_CONNECT', async ev => {
    try { const { clientId } = JSON.parse(ev.data); await PBC.api('POST', '/api/realtime', { clientId, subscriptions: ['notes', 'folders', 'attachments'] }); } catch (_) { }
  });
  const apply = kind => async ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
    const { action, record } = msg;
    if (action !== 'delete' && isEcho(record.id)) return;
    if (await idbGetSync(record.id)) return;   // lo local sin subir es sagrado
    const arr = colArr(kind);
    const i = arr.findIndex(x => x.id === record.id);
    if (action === 'delete') {
      idbDelete(kind, record.id);
      if (i >= 0) arr.splice(i, 1);
      if (kind === 'notes' && st.noteId === record.id && typeof onNoteGone === 'function') onNoteGone(record.id);
    } else {
      const obj = fromRec[kind](record);
      idbPut(kind, obj);
      if (i >= 0) arr[i] = obj; else arr.push(obj);
      if (kind === 'notes' && st.noteId === record.id && typeof onNoteChangedRemotely === 'function') onNoteChangedRemotely(obj);
    }
    schedulePaint();
  };
  _es.addEventListener('notes', apply('notes'));
  _es.addEventListener('folders', apply('folders'));
  _es.addEventListener('attachments', apply('attachments'));
}
let _paintPend = false;
function schedulePaint() {
  const ae = document.activeElement;
  if (ae && (/INPUT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable)) {
    if (_paintPend) return;
    _paintPend = true;
    /* Fuera del blur: si el blur lo dispara destruir el editor (cerrar la
       nota), repintar ahí dentro le quita los nodos a ProseMirror a medias. */
    ae.addEventListener('blur', () => { setTimeout(() => { _paintPend = false; paint(); }, 0); }, { once: true });
  } else paint();
}

/* ─── la barra de red (igual que en tareas: silencio = todo arriba) ─── */
const NET_LENTO = 2500;
let _netTimer = null, _netAviso = false;
function netOk() {
  const b = document.getElementById('netbar');
  if (!b) return;
  clearTimeout(_netTimer);
  idbGetAllSync().then(ops => {
    const n = ops.length, plural = n === 1 ? 'cambio' : 'cambios';
    if (!navigator.onLine) { b.textContent = n ? `Sin conexión · ${n} ${plural} por subir` : 'Sin conexión'; b.className = 'on'; _netAviso = true; return; }
    if (n) {
      const viejo = Math.min(...ops.map(o => o.ts || 0));
      if (Date.now() - viejo > NET_LENTO) { b.textContent = _syncErr ? `${n} ${plural} sin subir · ${_syncErr}` : `Guardando ${n} ${plural}…`; b.className = 'on net-sync'; _netAviso = true; }
      _netTimer = setTimeout(netOk, NET_LENTO);
      return;
    }
    if (_netAviso) { _netAviso = false; b.textContent = 'Todo guardado'; b.className = 'on net-ok'; _netTimer = setTimeout(() => { b.className = ''; }, 1600); return; }
    b.className = '';
  }).catch(() => {});
}
function netPing() { clearTimeout(_netTimer); _netTimer = setTimeout(netOk, NET_LENTO + 100); }
window.addEventListener('offline', netOk);
window.addEventListener('online', () => { netOk(); if (navigator.onLine) drainSyncQueue(); });
