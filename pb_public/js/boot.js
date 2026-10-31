/* ═══════════════ boot.js — arranque ═══════════════
   1) pinta desde IndexedDB al instante, 2) sube la cola, 3) baja del servidor
   y repinta, 4) realtime. Igual que tareas. */
'use strict';
const APP_V = document.querySelector('script[src*="boot.js"]').src.replace(/.*v=/, '');

async function loadAll() {
  const [no, fo, at] = await Promise.all([PBC.listAll('notes', '-updated'), PBC.listAll('folders', 'order,name'), PBC.listAll('attachments', '-created', 'id,note,file,kind,width,height')]);
  const ops = await idbGetAllSync();
  const pending = new Set(ops.map(o => o.id));
  const keepLocal = (local, fetched, kind) => {
    const out = local.filter(x => pending.has(x.id));
    for (const r of fetched) if (!pending.has(r.id)) out.push(fromRec[kind](r));
    return out;
  };
  notes = keepLocal(notes, no, 'notes');
  folders = keepLocal(folders, fo, 'folders');
  const pendAtt = attachments.filter(a => a.pending);
  attachments = at.map(fromRec.attachments).concat(pendAtt.filter(p => !at.some(a => a.id === p.id)));
  await Promise.all([idbClear('notes'), idbClear('folders'), idbClear('attachments')]);
  notes.forEach(n => idbPut('notes', n));
  folders.forEach(f => idbPut('folders', f));
  attachments.filter(a => !a.pending).forEach(a => idbPut('attachments', a));
}

function showLogin(msg) {
  const l = document.getElementById('login'); if (!l) return;
  l.classList.add('on');
  const e1 = document.getElementById('lg-err'); if (e1) e1.textContent = msg || '';
  const e2 = document.getElementById('lg-email'); if (e2 && !e2.value) e2.value = localStorage.getItem('pb_email') || '';
}
function authMsg(e) {
  const m = (e && e.message) || '';
  if (/failed to authenticate|invalid credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/failed to fetch|networkerror|network request/i.test(m)) return 'Sin conexión con el servidor.';
  return m || 'No pude iniciar sesión.';
}
async function doLogin() {
  const email = document.getElementById('lg-email').value.trim();
  const pass = document.getElementById('lg-pass').value;
  const b = document.getElementById('lg-btn'); b.disabled = true;
  const err = document.getElementById('lg-err'); err.textContent = '';
  try { const d = await PBC.login(email, pass); if (d.record && d.record.settings) applyAccountSettings(d.record.settings); document.getElementById('lg-pass').value = ''; b.disabled = false; boot(); }
  catch (e) { b.disabled = false; err.textContent = authMsg(e); }
}
function showUpdateBar() {
  if (swUpdateReady) return;
  swUpdateReady = true;
  if (st.view !== 'note') paint();
  toast('Hay una versión nueva', { action: 'Actualizar', dur: 30000, onAction: () => location.reload() });
}

/* ?note=<id> (enlace a una nota), ?new=1 (atajo), ?title/?text/?url (share target) */
function handleLaunchParams() {
  if (!location.search) return;
  const p = new URLSearchParams(location.search);
  const limpiar = () => { try { history.replaceState({}, '', '/'); } catch (_) { } };
  const note = p.get('note');
  if (note) { limpiar(); if (noteById(note)) openNote(note); return; }
  const sTitle = (p.get('title') || '').trim(), sText = (p.get('text') || '').trim(), sUrl = (p.get('url') || '').trim();
  if (sTitle || sText || sUrl) {
    limpiar();
    const n = newNote('');
    const body = [sTitle ? `# ${sTitle}` : '', sText && sText !== sUrl ? sText : '', sUrl ? sUrl : ''].filter(Boolean).join('\n\n');
    n.body = settings.autoTitle && !sTitle ? `# \n\n${body}` : body;
    deriveNote(n); delete n.fresh;
    notes.unshift(n); createRec('notes', n);
    openNote(n.id); toast('Guardado como nota nueva');
    return;
  }
  if (p.get('new')) { limpiar(); startNew(); return; }
  if (p.get('fresh')) { limpiar(); setTimeout(() => toast('App actualizada'), 400); return; }
  limpiar();
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      if (reg.waiting) showUpdateBar();
      reg.addEventListener('updatefound', () => { const nw = reg.installing; if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(); }); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'UPDATE_READY') showUpdateBar(); });
  }
  if (!PBC.token) { showLogin(); return; }
  settings.autoTitle = LS.get('autoTitle', true);

  const [no, fo, at] = await Promise.all([idbGetAll('notes'), idbGetAll('folders'), idbGetAll('attachments')]);
  notes = no; folders = fo; attachments = at;
  await restoreBlobUrls();
  const hasLocal = notes.length || folders.length;
  if (hasLocal) { _dataReady = true; document.getElementById('login').classList.remove('on'); paint(); }

  if (navigator.onLine) { await drainSyncQueue(); await PBC.refresh(); LS.set('autoTitle', settings.autoTitle); }
  try { await loadAll(); }
  catch (e) { if (!hasLocal && PBC.token) showLogin('No pude conectar: ' + e.message); return; }
  _dataReady = true;
  document.getElementById('login').classList.remove('on');
  paint();
  realtimeConnect();
  handleLaunchParams();
}
boot();
