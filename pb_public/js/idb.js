/* ═══════════════ idb.js — la copia local (IndexedDB) ═══════════════
   Calcado de tareas: un store por colección, `sync_queue` con UNA operación
   por registro (un PATCH sobre un POST pendiente se funde en el POST), y
   `files` con los blobs de imágenes que esperan subirse sin conexión. */
'use strict';
const IDB_NAME = 'SamukisNotas';
const IDB_VER = 1;

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

let _dbPromise = null;
function idbOpen() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const s of ['notes', 'folders', 'attachments', 'sync_queue', 'files', 'meta'])
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}
const idbReq = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function idbPut(store, obj) { try { const db = await idbOpen(); await idbReq(db.transaction(store, 'readwrite').objectStore(store).put(obj)); } catch (e) { console.warn('IDB put', store, e); } }
async function idbGet(store, id) { try { const db = await idbOpen(); return await idbReq(db.transaction(store, 'readonly').objectStore(store).get(id)); } catch (e) { return undefined; } }
async function idbDelete(store, id) { try { const db = await idbOpen(); await idbReq(db.transaction(store, 'readwrite').objectStore(store).delete(id)); } catch (e) { console.warn('IDB delete', store, e); } }
async function idbGetAll(store) { try { const db = await idbOpen(); return await idbReq(db.transaction(store, 'readonly').objectStore(store).getAll()); } catch (e) { console.warn('IDB getAll', store, e); return []; } }
async function idbClear(store) { try { const db = await idbOpen(); await idbReq(db.transaction(store, 'readwrite').objectStore(store).clear()); } catch (e) { console.warn('IDB clear', store, e); } }

/* Una operación por registro. Un PATCH sobre un POST que aún no subió se
   funde en el POST (con el cuerpo nuevo); un DELETE sobre un POST pendiente
   anula los dos (el registro nunca existió en el servidor). */
async function idbPutSync(op) {
  try {
    const db = await idbOpen();
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    const req = store.get(op.id);
    req.onsuccess = () => {
      const ex = req.result;
      if (ex && ex.method === 'POST') {
        if (op.method === 'PATCH') { op.method = 'POST'; op.path = ex.path; op.body = { ...ex.body, ...op.body }; delete op.body.base_version; }
        else if (op.method === 'DELETE') { store.delete(op.id); return; }
      }
      if (ex && ex.method === 'PATCH' && op.method === 'PATCH') {
        /* conserva la base_version más antigua: es la que vio el usuario al empezar a editar */
        if (ex.body && ex.body.base_version != null && op.body && op.body.base_version != null) op.body.base_version = Math.min(ex.body.base_version, op.body.base_version);
        op.body = { ...ex.body, ...op.body };
      }
      store.put(op);
    };
  } catch (e) { console.warn('IDB putSync', e); }
}
async function idbRemoveSync(id) { try { const db = await idbOpen(); await idbReq(db.transaction('sync_queue', 'readwrite').objectStore('sync_queue').delete(id)); } catch (e) { console.warn('IDB removeSync', e); } }
async function idbGetSync(id) { try { const db = await idbOpen(); return await idbReq(db.transaction('sync_queue', 'readonly').objectStore('sync_queue').get(id)); } catch (e) { return undefined; } }
async function idbGetAllSync() { try { const db = await idbOpen(); const ops = await idbReq(db.transaction('sync_queue', 'readonly').objectStore('sync_queue').getAll()); return ops.sort((a, b) => a.ts - b.ts); } catch (e) { return []; } }
