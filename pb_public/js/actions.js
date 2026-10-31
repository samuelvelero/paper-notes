/* ═══════════════ actions.js — lo que pasa al tocar ═══════════════
   Un solo handler delegado: cada botón lleva data-act (y data-arg). Aquí
   viven también el autoguardado del editor, los menús, los modales y los
   atajos de teclado. */
'use strict';

/* ─── navegación ─── */
function navPush() { try { history.pushState({ v: st.view, n: st.noteId, f: st.folder }, ''); } catch (_) { } }
function goList(folder) {
  if (folder !== undefined) { st.folder = folder; st.tag = null; }
  st.view = 'list'; st.remote = null;
  paint();
}
function goBack() {
  if (st.view === 'note') return closeNote();
  if (st.view === 'history') { st.view = 'note'; paint(); return; }
  goList();
}
window.addEventListener('popstate', () => { if (st.view !== 'list') goBack(); });

/* ─── abrir / cerrar nota ─── */
function openNote(id) {
  const n = noteById(id);
  if (!n) return;
  flushSave();
  st.noteId = id; st.view = 'note'; st.tbText = false; st.tbOn = false; st.remote = null;
  navPush();
  paint();
}
function closeNote() {
  flushSave();
  const n = noteById(st.noteId);
  /* una nota nueva que se quedó vacía no se guarda (como en Apple Notes) */
  if (n && n.fresh && isEmptyNote(n)) {
    notes.splice(notes.indexOf(n), 1);
    removeRec('notes', n.id);
  } else if (n) delete n.fresh;
  st.noteId = null; st.view = 'list';
  paint();
}
function startNew() {
  flushSave();
  const n = newNote(st.folder || '');
  notes.unshift(n);
  createRec('notes', n);
  st.noteId = n.id; st.view = 'note'; st.tbText = false; st.tbOn = false; st.remote = null;
  navPush();
  paint();
  editorCmd('focusEnd');
}
function openNoteByTitle(title) {
  const t = sNorm(title);
  const hit = active().find(n => sNorm(n.title) === t) || active().find(n => sNorm(n.title).startsWith(t)) || active().find(n => n.id === title);
  if (hit) openNote(hit.id);
  else toast(`No hay ninguna nota «${title}»`, { action: 'Crearla', onAction: () => { flushSave(); const n = newNote(st.folder || ''); n.body = `# ${title}\n\n`; deriveNote(n); notes.unshift(n); createRec('notes', n); openNote(n.id); } });
}

/* ─── editor: montaje y autoguardado ─── */
let _saveTimer = null, _dirty = false;
function mountEditor(host, n) {
  editorOpen(host, n.body, {
    onChange() { _dirty = true; clearTimeout(_saveTimer); _saveTimer = setTimeout(flushSave, 800); paintToolbar(); },
    onSelection() { paintToolbar(); },
    onFocus() { if (!isDesktop()) { st.tbOn = true; document.getElementById('toolbar').classList.add('on'); } },
    onBlur() { /* la barra se cierra con la X: perder el foco al tocarla no debe esconderla */ },
    onImage(file) { insertImage(file); },
    onWikilink(title) { flushSave(); openNoteByTitle(title); },
    onTag(tag) { closeNote(); st.tag = tag; paint(); },
  });
  if (n.fresh) setTimeout(() => editorCmd('focusEnd'), 30);
}
function unmountEditor() { flushSave(); editorDestroy(); }
/* Guarda YA lo que haya cambiado (al salir de la nota, al ocultar la pestaña). */
function flushSave() {
  clearTimeout(_saveTimer); _saveTimer = null;
  if (!_dirty || !ED.view) { _dirty = false; return; }
  _dirty = false;
  const n = noteById(st.noteId);
  if (!n) return;
  const md = editorMarkdown();
  if (md === n.body) return;
  n.body = md; deriveNote(n);
  n.client_updated = new Date().toISOString(); n.updated = n.client_updated;
  delete n.fresh;
  queueSave('notes', n, { bodyChanged: true });
  const meta = document.getElementById('note-meta');
  if (meta) morph('note-meta', noteMetaHTML(n).replace(/^<div id="note-meta" class="note-meta">|<\/div>$/g, ''));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);
/* Llegó de otro dispositivo la nota que está abierta. */
function onNoteChangedRemotely(obj) {
  if (!ED.view || _dirty) return;    // lo que se está escribiendo manda; el servidor resolverá
  if (obj.body !== editorMarkdown()) editorSet(obj.body);
}
function onNoteGone() { toast('La nota se borró en otro dispositivo'); st.noteId = null; st.view = 'list'; paint(); }

/* ─── imágenes ─── */
function pickImage() {
  const inp = document.getElementById('file-in');
  inp.value = '';
  inp.onchange = () => { for (const f of inp.files) insertImage(f); };
  inp.click();
}
async function insertImage(file) {
  const n = noteById(st.noteId);
  if (!n || !/^image\//.test(file.type)) return;
  if (file.size > 25 * 1024 * 1024) { toast('La imagen pesa más de 25 MB'); return; }
  delete n.fresh;
  const id = await uploadImage(n.id, file);
  editorCmd('image', 'attachments/' + id);
}

/* ─── carpetas ─── */
function promptFolder(title, value, cb) {
  openModal(`<div class="md-title">${esc(title)}</div><input id="md-in" class="md-input" value="${esc(value || '')}" placeholder="Nombre" maxlength="80">
    <div class="md-acts"><button class="btn" data-act="modalClose">Cancelar</button><button class="btn primary" data-act="modalOk">Aceptar</button></div>`,
    () => { const v = document.getElementById('md-in').value.trim(); if (v) cb(v); });
  setTimeout(() => { const i = document.getElementById('md-in'); i && i.focus(); i && i.select(); }, 30);
}
function newFolder(parent) {
  promptFolder('Nueva carpeta', '', name => {
    const f = { id: genId(), name, parent: parent || '', order: String(Date.now()), icon: '' };
    folders.push(f); createRec('folders', f);
    st.folder = f.id; st.view = 'list'; paint();
  });
}
function folderMenu(id, anchor) {
  const f = folderById(id); if (!f) return;
  openPop(anchor, [
    { label: 'Renombrar', icon: I.text(), run: () => promptFolder('Renombrar carpeta', f.name, name => { f.name = name; queueSave('folders', f); paint(); }) },
    { label: 'Nueva subcarpeta', icon: I.plus(), run: () => newFolder(f.id) },
    { label: 'Mover las notas a Notas y borrar', icon: I.trash(), danger: true, run: () => confirmModal(`¿Borrar la carpeta «${f.name}»?`, 'Sus notas (y las de sus subcarpetas) pasan a «Notas». No se borra ninguna nota.', () => {
      const ids = folderSubtree(f.id);
      notes.forEach(n => { if (ids.includes(n.folder)) { n.folder = ''; queueSave('notes', n); } });
      ids.forEach(fid => { const i = folders.findIndex(x => x.id === fid); if (i >= 0) folders.splice(i, 1); removeRec('folders', fid); });
      if (ids.includes(st.folder)) st.folder = null;
      paint();
    }) },
  ]);
}
function moveNoteModal(id) {
  const n = noteById(id); if (!n) return;
  const rows = [['', 'Notas', 0]];
  const rec = (parent, depth) => folderChildren(parent).forEach(f => { rows.push([f.id, f.name, depth]); rec(f.id, depth + 1); });
  rec('', 0);
  openModal(`<div class="md-title">Mover a</div><div class="md-list">${rows.map(([fid, name, d]) => `<button class="md-row${(n.folder || '') === fid ? ' on' : ''}" style="--d:${d}" data-act="moveTo" data-arg="${fid}"><span class="sd-ico">${I.folder()}</span>${esc(name)}<span class="fcard-chk">${(n.folder || '') === fid ? I.check() : ''}</span></button>`).join('')}
    <button class="md-row" data-act="newFolderFromMove"><span class="sd-ico">${I.plus()}</span>Nueva carpeta</button></div>`);
}

/* ─── menú de la nota ─── */
function noteMenu(anchor) {
  const n = noteById(st.noteId); if (!n) return;
  openPop(anchor, [
    { label: n.pinned ? 'Desfijar' : 'Fijar', icon: n.pinned ? I.pinOff() : I.pin(), run: () => { n.pinned = !n.pinned; queueSave('notes', n); paint(); toast(n.pinned ? 'Nota fijada' : 'Nota desfijada'); } },
    { label: 'Mover a…', icon: I.move(), run: () => moveNoteModal(n.id) },
    { label: 'Historial de versiones', icon: I.history(), run: () => openHistory(n.id) },
    { label: 'Copiar como Markdown', icon: I.code(), run: () => { flushSave(); navigator.clipboard && navigator.clipboard.writeText(n.body).then(() => toast('Markdown copiado')); } },
    { label: 'Mover a la papelera', icon: I.trash(), danger: true, run: () => trashNote(n.id) },
  ]);
}
function trashNote(id) {
  const n = noteById(id); if (!n) return;
  flushSave();
  n.trashed_at = new Date().toISOString(); n.pinned = false;
  queueSave('notes', n);
  if (st.noteId === id) { st.noteId = null; st.view = 'list'; }
  paint();
  toast('Nota en la papelera', { action: 'Deshacer', onAction: () => { n.trashed_at = ''; queueSave('notes', n); paint(); } });
}
function shareNote() {
  const n = noteById(st.noteId); if (!n) return;
  flushSave();
  const text = n.plain || '';
  if (navigator.share) navigator.share({ title: n.title || 'Nota', text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Texto copiado'));
}

/* ─── historial ─── */
async function openHistory(id) {
  flushSave();
  st.histId = id; st.histVersions = null; st.histPreview = null; st.view = 'history';
  paint();
  try {
    const d = await PBC.api('GET', `/api/collections/note_versions/records?perPage=200&skipTotal=1&sort=-version,-created&filter=${encodeURIComponent(`note="${id}"`)}`);
    st.histVersions = d.items || [];
  } catch (e) { st.histVersions = []; toast('No pude cargar el historial: ' + e.message); }
  if (st.view === 'history') paint();
}
function histRestore(vid) {
  const v = (st.histVersions || []).find(x => x.id === vid), n = noteById(st.histId);
  if (!v || !n) return;
  confirmModal('¿Restaurar esta versión?', 'La versión actual queda guardada en el historial.', async () => {
    try { await PBC.api('POST', '/api/collections/note_versions/records', { note: n.id, body: n.body, version: n.version, device: 'web', reason: 'manual' }); } catch (_) { }
    n.body = v.body; deriveNote(n); n.client_updated = new Date().toISOString();
    queueSave('notes', n, { bodyChanged: true });
    st.view = 'note'; paint();
    if (ED.view) editorSet(n.body);
    toast('Versión restaurada');
  });
}

/* ─── búsqueda ─── */
let _qTimer = null;
function onSearchInput(v) {
  st.q = v; st.remote = null;
  clearTimeout(_qTimer);
  _qTimer = setTimeout(() => { if (st.view !== 'list') st.view = 'list'; paint(); }, 60);
}
async function remoteSearch() {
  const q = st.q.trim();
  if (!q) return;
  try {
    const params = new URLSearchParams({ q, limit: '30' });
    if (st.folder) params.set('folder', st.folder);
    if (st.tag) params.set('tag', st.tag);
    const r = await fetch(`${PBC.base}/search?${params}`, { headers: { Authorization: PBC.token } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    st.remote = await r.json();
    st.view = 'list'; paint();
  } catch (e) { toast('El buscador no respondió: ' + e.message); }
}

/* ─── menús y modales ─── */
function openPop(anchor, items) {
  const pop = document.getElementById('pop');
  pop.innerHTML = items.map((it, i) => `<button class="pop-row${it.danger ? ' danger' : ''}" data-pop="${i}">${it.icon || ''}<span>${esc(it.label)}</span></button>`).join('');
  pop._items = items;
  pop.classList.add('on');
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, right: 20, bottom: 60, top: 60 };
  const w = 260;
  let left = Math.min(r.right - w, window.innerWidth - w - 10); if (left < 10) left = 10;
  pop.style.left = left + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
  requestAnimationFrame(() => { const h = pop.offsetHeight; if (r.bottom + 6 + h > window.innerHeight) pop.style.top = Math.max(10, r.top - h - 6) + 'px'; });
  document.getElementById('scrim').classList.add('on');
}
function closePop() { const pop = document.getElementById('pop'); pop.classList.remove('on'); pop._items = null; if (!st.modal) document.getElementById('scrim').classList.remove('on'); }
function openModal(html, onOk) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="md-card">${html}</div>`;
  m.classList.add('on'); st.modal = { onOk };
  document.getElementById('scrim').classList.add('on');
}
function closeModal() { const m = document.getElementById('modal'); m.classList.remove('on'); m.innerHTML = ''; st.modal = null; closePop(); document.getElementById('scrim').classList.remove('on'); }
/* El onOk corre ANTES de cerrar (lee el campo del modal); si abrió otro
   modal, ese se queda. */
function modalOk() {
  const m = st.modal; if (!m) return;
  try { m.onOk && m.onOk(); } finally { if (st.modal === m) closeModal(); }
}
function confirmModal(title, text, onOk) {
  openModal(`<div class="md-title">${esc(title)}</div><p class="md-text">${esc(text)}</p><div class="md-acts"><button class="btn" data-act="modalClose">Cancelar</button><button class="btn primary" data-act="modalOk">Sí</button></div>`, onOk);
}

/* ─── ajustes ─── */
function setSetting(key, value) {
  if (key === 'autoTitle') {
    settings.autoTitle = !!value;
    PBC.api('PATCH', `/api/collections/users/records/${PBC.uid}`, { settings: { autoTitle: settings.autoTitle } }).catch(() => toast('No pude guardar el ajuste en el servidor'));
  } else { settings[key] = value; LS.set(key, value); }
  paint();
}
function exportAll() {
  flushSave();
  const data = { exported: new Date().toISOString(), folders: folders.map(f => ({ id: f.id, name: f.name, parent: f.parent })), notes: active().map(n => ({ id: n.id, folder: n.folder, title: n.title, body: n.body, tags: n.tags, pinned: n.pinned, created: n.created, updated: n.updated })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `notas-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function logout() {
  confirmModal('¿Cerrar sesión?', 'Las notas quedan en este dispositivo hasta que entres de nuevo.', async () => {
    flushSave();
    PBC.logout();
    location.reload();
  });
}

/* ─── el handler ─── */
document.addEventListener('click', e => {
  const popRow = e.target.closest('[data-pop]');
  if (popRow) { const pop = document.getElementById('pop'); const it = pop._items && pop._items[+popRow.dataset.pop]; closePop(); it && it.run(); return; }
  if (e.target.id === 'scrim') { if (st.modal) closeModal(); else closePop(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, arg = el.dataset.arg;
  if (el.tagName === 'SELECT') return;   // lo maneja change
  switch (act) {
    case 'open': openNote(arg); break;
    case 'closeNote': closeNote(); break;
    case 'back': goBack(); break;
    case 'goFolder': goList(arg === 'all' ? null : arg === 'trash' ? null : arg); if (arg === 'trash') { st.view = 'trash'; paint(); } break;
    case 'goFolders': st.view = 'folders'; paint(); break;
    case 'goSettings': st.view = 'settings'; paint(); break;
    case 'goTrash': st.view = 'trash'; paint(); break;
    case 'toggleTag': st.tag = st.tag === arg ? null : arg; st.remote = null; paint(); break;
    case 'clearRemote': st.remote = null; paint(); break;
    case 'newFolder': newFolder(''); break;
    case 'newFolderFromMove': closeModal(); promptFolder('Nueva carpeta', '', name => { const f = { id: genId(), name, parent: '', order: String(Date.now()), icon: '' }; folders.push(f); createRec('folders', f); const n = noteById(st.noteId); if (n) { n.folder = f.id; queueSave('notes', n); } paint(); }); break;
    case 'folderMenu': e.stopPropagation(); folderMenu(arg, el); break;
    case 'moveNote': moveNoteModal(arg); break;
    case 'moveTo': { const n = noteById(st.noteId); if (n) { n.folder = arg; queueSave('notes', n); } closeModal(); paint(); break; }
    case 'noteMenu': noteMenu(el); break;
    case 'share': shareNote(); break;
    case 'restore': { const n = noteById(arg); if (n) { n.trashed_at = ''; queueSave('notes', n); paint(); toast('Nota restaurada'); } break; }
    case 'deleteForever': { const n = noteById(arg); if (n) confirmModal('¿Borrar para siempre?', 'No se puede deshacer.', () => { notes.splice(notes.indexOf(n), 1); removeRec('notes', n.id); paint(); }); break; }
    case 'emptyTrash': confirmModal('¿Vaciar la papelera?', `Se borran ${trashed().length} notas para siempre.`, () => { trashed().forEach(n => { notes.splice(notes.indexOf(n), 1); removeRec('notes', n.id); }); paint(); }); break;
    case 'histPreview': st.histPreview = st.histPreview === arg ? null : arg; paint(); break;
    case 'histRestore': histRestore(arg); break;
    case 'ed': if (arg === 'image') pickImage(); else editorCmd(arg); paintToolbar(); break;
    case 'tbText': st.tbText = !st.tbText; paintToolbar(); editorFocus(); break;
    case 'tbClose': st.tbOn = false; st.tbText = false; editorBlur(); document.getElementById('toolbar').classList.remove('on'); break;
    case 'modalClose': closeModal(); break;
    case 'modalOk': modalOk(); break;
    case 'setting': if (el.classList.contains('tog')) setSetting(arg, !el.classList.contains('on')); break;
    case 'exportAll': exportAll(); break;
    case 'logout': logout(); break;
    case 'reload': location.reload(); break;
    case 'reloadFresh': location.href = '/?fresh=1'; break;
  }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act="setting"]');
  if (el && el.tagName === 'SELECT') setSetting(el.dataset.arg, el.value);
});
document.addEventListener('input', e => {
  if (e.target.id === 'q' || e.target.id === 'qm') onSearchInput(e.target.value);
});
document.addEventListener('keydown', e => {
  if ((e.target.id === 'q' || e.target.id === 'qm')) {
    if (e.key === 'Enter') { e.preventDefault(); remoteSearch(); }
    if (e.key === 'Escape') { e.target.value = ''; onSearchInput(''); e.target.blur(); }
    return;
  }
  if (e.target.id === 'md-in') { if (e.key === 'Enter') modalOk(); if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'Escape') { if (st.modal) return closeModal(); if (document.getElementById('pop').classList.contains('on')) return closePop(); if (st.view === 'note' && !editorHasFocus()) return closeNote(); if (st.view === 'note' && editorHasFocus()) { editorBlur(); return; } if (st.view !== 'list') return goBack(); }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); startNew(); }
  if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey && st.view === 'list') { e.preventDefault(); const q = document.getElementById(isDesktop() ? 'q' : 'qm'); q && q.focus(); }
});
document.getElementById('fab').addEventListener('click', startNew);
window.addEventListener('resize', () => { clearTimeout(window._rsz); window._rsz = setTimeout(paint, 120); });
