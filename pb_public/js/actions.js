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
function folderMenu(id, anchor) { const items = folderMenuItems(id); if (items) openPop(anchor, items); }
function folderMenuItems(id) {
  const f = folderById(id); if (!f) return null;
  return [
    { label: 'Renombrar', icon: I.text(), run: () => promptFolder('Renombrar carpeta', f.name, name => { f.name = name; queueSave('folders', f); paint(); }) },
    { label: 'Nueva subcarpeta', icon: I.plus(), run: () => newFolder(f.id) },
    { label: 'Mover las notas a Notas y borrar', icon: I.trash(), danger: true, run: () => confirmModal(`¿Borrar la carpeta «${f.name}»?`, 'Sus notas (y las de sus subcarpetas) pasan a «Notas». No se borra ninguna nota.', () => {
      const ids = folderSubtree(f.id);
      notes.forEach(n => { if (ids.includes(n.folder)) { n.folder = ''; queueSave('notes', n); } });
      ids.forEach(fid => { const i = folders.findIndex(x => x.id === fid); if (i >= 0) folders.splice(i, 1); removeRec('folders', fid); });
      if (ids.includes(st.folder)) st.folder = null;
      paint();
    }) },
  ];
}
/* Mover una nota a una carpeta ('' = «Notas», la raíz), con deshacer. */
function moveNoteTo(id, folder) {
  const n = noteById(id); if (!n) return;
  folder = folder || '';
  if ((n.folder || '') === folder) return;
  if (st.noteId === id) flushSave();
  const prev = n.folder || '';
  n.folder = folder; queueSave('notes', n); paint();
  const name = folder ? ((folderById(folder) || {}).name || 'la carpeta') : 'Notas';
  toast(`Movida a «${name}»`, { action: 'Deshacer', onAction: () => { n.folder = prev; queueSave('notes', n); paint(); } });
}
function moveNoteModal(id) {
  const n = noteById(id); if (!n) return;
  const rows = [['', 'Notas', 0]];
  const rec = (parent, depth) => folderChildren(parent).forEach(f => { rows.push([f.id, f.name, depth]); rec(f.id, depth + 1); });
  rec('', 0);
  st.moveId = id;   // la nota que se mueve (puede no ser la abierta: menú de la tarjeta)
  openModal(`<div class="md-title">Mover a</div><div class="md-list">${rows.map(([fid, name, d]) => `<button class="md-row${(n.folder || '') === fid ? ' on' : ''}" style="--d:${d}" data-act="moveTo" data-arg="${fid}"><span class="sd-ico">${I.folder()}</span>${esc(name)}<span class="fcard-chk">${(n.folder || '') === fid ? I.check() : ''}</span></button>`).join('')}
    <button class="md-row" data-act="newFolderFromMove"><span class="sd-ico">${I.plus()}</span>Nueva carpeta</button></div>`);
}

/* ─── menú de la nota ─── */
function noteMenu(anchor) { const items = noteMenuItems(st.noteId); if (items) openPop(anchor, items); }
/* Las acciones de una nota: las usan el ⋮ de la nota abierta y el clic
   derecho en su tarjeta (`withOpen` añade «Abrir»). */
function noteMenuItems(id, withOpen) {
  const n = noteById(id); if (!n) return null;
  const items = [];
  if (withOpen) items.push({ label: 'Abrir', icon: I.open(), run: () => openNote(n.id) }, { sep: true });
  items.push(
    { label: n.pinned ? 'Desfijar' : 'Fijar', icon: n.pinned ? I.pinOff() : I.pin(), run: () => { n.pinned = !n.pinned; queueSave('notes', n); paint(); toast(n.pinned ? 'Nota fijada' : 'Nota desfijada'); } },
    { label: 'Mover a…', icon: I.move(), run: () => moveNoteModal(n.id) },
    { label: n.share ? 'Enlace público…' : 'Compartir enlace público', icon: I.link(), run: () => shareLink(n.id) },
    { label: 'Historial de versiones', icon: I.history(), run: () => openHistory(n.id) },
    { label: 'Copiar como Markdown', icon: I.code(), run: () => { if (st.noteId === n.id) flushSave(); navigator.clipboard && navigator.clipboard.writeText(n.body).then(() => toast('Markdown copiado')); } },
    { sep: true },
    { label: 'Mover a la papelera', icon: I.trash(), danger: true, run: () => trashNote(n.id) },
  );
  return items;
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
/* ─── compartir ───
   Dos maneras: el ENLACE PÚBLICO de solo lectura (notes.share = token,
   la página /shared/<token> la sirve pb_hooks/share.pb.js) o mandar el texto
   tal cual con el menú de compartir del sistema. */
const PUBLIC_ORIGIN = 'https://notes.samukis.xyz';
/* En local (pruebas) el enlace apunta al propio servidor; desde la tailnet o
   el dominio, siempre al público: es el que puede abrir un tercero. */
const shareUrl = token => (/^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.origin : PUBLIC_ORIGIN) + '/shared/' + token;
function newShareToken() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function shareMenu(id, anchor) {
  const n = noteById(id); if (!n) return;
  openPop(anchor, [
    { label: n.share ? 'Enlace público…' : 'Compartir enlace público', icon: I.link(), run: () => shareLink(n.id) },
    { label: navigator.share ? 'Enviar el texto…' : 'Copiar el texto', icon: I.share(), run: () => shareText(n.id) },
    { label: 'Copiar como Markdown', icon: I.code(), run: () => { if (st.noteId === n.id) flushSave(); navigator.clipboard && navigator.clipboard.writeText(n.body).then(() => toast('Markdown copiado')); } },
  ]);
}
function shareText(id) {
  const n = noteById(id); if (!n) return;
  if (st.noteId === id) flushSave();
  const text = n.plain || '';
  if (navigator.share) navigator.share({ title: n.title || 'Nota', text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Texto copiado'));
}
/* Crea el enlace si no lo hay y enseña el diálogo (copiar / dejar de compartir). */
function shareLink(id) {
  const n = noteById(id); if (!n) return;
  if (st.noteId === id) flushSave();
  const isNew = !n.share;
  if (isNew) { n.share = newShareToken(); queueSave('notes', n, { now: true }); paint(); }
  const url = shareUrl(n.share);
  openModal(`<div class="md-title">Enlace público</div>
    <p class="md-text">Cualquiera con el enlace puede leer esta nota, sin cuenta. No puede editarla ni ver tus otras notas. Los cambios que hagas se ven al recargar.</p>
    <input class="md-input share-url" readonly value="${esc(url)}" onclick="this.select()">
    ${!navigator.onLine ? '<p class="md-text share-off">Sin conexión: el enlace funcionará cuando se suba el cambio.</p>' : ''}
    <div class="md-acts share-acts">
      <button class="btn danger" data-act="shareStop" data-arg="${n.id}">Dejar de compartir</button>
      <span class="md-acts-gap"></span>
      ${navigator.share ? `<button class="btn" data-act="shareSend" data-arg="${n.id}">Enviar…</button>` : ''}
      <button class="btn primary" data-act="shareCopy" data-arg="${n.id}">Copiar enlace</button>
    </div>`);
  if (isNew) copyShareLink(n.id, true);
}
function copyShareLink(id, quiet) {
  const n = noteById(id); if (!n || !n.share) return;
  const url = shareUrl(n.share);
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast(quiet ? 'Enlace creado y copiado' : 'Enlace copiado'), () => { if (!quiet) toast('No pude copiar: selecciona el enlace'); });
}
function stopSharing(id) {
  const n = noteById(id); if (!n) return;
  closeModal();
  const prev = n.share;
  n.share = ''; queueSave('notes', n, { now: true }); paint();
  toast('El enlace dejó de funcionar', { action: 'Deshacer', onAction: () => { n.share = prev; queueSave('notes', n, { now: true }); paint(); } });
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
/* `anchor`: un elemento (el menú cae bajo él, alineado a su derecha) o un
   punto {x, y} (clic derecho: el menú sale desde el puntero). Items:
   { label, icon, run, danger, hint } o { sep: true }. */
function openPop(anchor, items) {
  const pop = document.getElementById('pop');
  pop.innerHTML = items.map((it, i) => it.sep ? '<div class="pop-sep"></div>'
    : `<button class="pop-row${it.danger ? ' danger' : ''}" data-pop="${i}"${it.disabled ? ' disabled' : ''}>${it.icon || ''}<span>${esc(it.label)}</span>${it.hint ? `<kbd class="pop-kbd">${esc(it.hint)}</kbd>` : ''}</button>`).join('');
  pop._items = items;
  pop.classList.add('on');
  const w = 260, point = anchor && anchor.x != null && !anchor.getBoundingClientRect;
  const r = point ? { left: anchor.x, right: anchor.x + w, top: anchor.y, bottom: anchor.y - 6 }
    : anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, right: 20, bottom: 60, top: 60 };
  let left = Math.min(r.right - w, window.innerWidth - w - 10); if (left < 10) left = 10;
  pop.style.left = left + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
  requestAnimationFrame(() => { const h = pop.offsetHeight; if (r.bottom + 6 + h > window.innerHeight) pop.style.top = Math.max(10, (point ? r.top : r.top - 6) - h) + 'px'; });
  const scrim = document.getElementById('scrim');
  scrim.classList.toggle('clear', !!point);   // el menú contextual no oscurece la pantalla
  scrim.classList.add('on');
}
function closePop() { const pop = document.getElementById('pop'); pop.classList.remove('on'); pop._items = null; if (!st.modal) document.getElementById('scrim').classList.remove('on', 'clear'); }
/* Tocar el menú no le quita el foco al editor: así Cortar/Copiar/Pegar
   actúan sobre la selección de ProseMirror. */
document.getElementById('pop').addEventListener('mousedown', e => e.preventDefault());
function openModal(html, onOk) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="md-card">${html}</div>`;
  m.classList.add('on'); st.modal = { onOk };
  const scrim = document.getElementById('scrim');
  scrim.classList.remove('clear'); scrim.classList.add('on');
}
function closeModal() { const m = document.getElementById('modal'); m.classList.remove('on'); m.innerHTML = ''; st.modal = null; closePop(); document.getElementById('scrim').classList.remove('on', 'clear'); }

/* ─── arrastrar una nota a una carpeta de la barra lateral ───
   Las tarjetas de la lista son draggable (escritorio); las filas de la barra
   lateral que aceptan llevan data-drop: el id de la carpeta, '' para
   «Notas» (raíz) o 'trash' para «Eliminadas». */
let _dragNote = null, _dropEl = null;
function setDropTarget(el) {
  if (_dropEl === el) return;
  if (_dropEl) _dropEl.classList.remove('drop-on');
  _dropEl = el;
  if (el) el.classList.add('drop-on');
}
document.addEventListener('dragstart', e => {
  const card = e.target.closest && e.target.closest('.card[data-note]:not(.trash)');
  if (!card) return;
  _dragNote = card.dataset.note;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', (noteById(_dragNote) || {}).title || 'Nota'); } catch (_) { }
  card.classList.add('dragging');
  document.body.classList.add('dragging-note');
});
document.addEventListener('dragend', () => {
  document.querySelectorAll('.card.dragging').forEach(c => c.classList.remove('dragging'));
  document.body.classList.remove('dragging-note');
  setDropTarget(null); _dragNote = null;
});
document.addEventListener('dragover', e => {
  if (!_dragNote) return;
  const row = e.target.closest && e.target.closest('[data-drop]');
  const n = noteById(_dragNote);
  /* la carpeta donde ya está no se resalta: soltar ahí no haría nada */
  const ok = row && n && (row.dataset.drop === 'trash' || row.dataset.drop !== (n.folder || ''));
  setDropTarget(ok ? row : null);
  if (!ok) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
document.addEventListener('drop', e => {
  if (!_dragNote) return;
  const row = e.target.closest && e.target.closest('[data-drop]');
  if (!row) return;
  e.preventDefault();
  const id = _dragNote, dest = row.dataset.drop;
  setDropTarget(null);
  if (dest === 'trash') trashNote(id); else moveNoteTo(id, dest);
});

/* ─── clic derecho: el menú de la app en vez del de Chrome ───
   Cada zona tiene sus acciones (tarjeta, carpeta, papelera, editor…). Con
   Shift + clic derecho sale el menú del navegador (inspeccionar, revisar la
   ortografía, etc.). En los campos de texto se deja el nativo (pegar,
   autocompletar). En el teléfono, una pulsación larga en el EDITOR selecciona
   texto: ahí tampoco se intercepta. */
let _lastPointer = 'mouse';
document.addEventListener('pointerdown', e => { _lastPointer = e.pointerType || 'mouse'; }, true);
document.addEventListener('contextmenu', e => {
  if (e.shiftKey) return;
  const t = e.target;
  if (!t.closest || t.closest('input, textarea, select, #login')) return;
  if (_lastPointer === 'touch' && t.closest('.ed')) return;
  e.preventDefault();
  if (t.closest('#pop') || t.closest('#modal')) return;
  if (document.getElementById('pop').classList.contains('on')) closePop();
  if (st.modal) return;
  const items = contextItems(t);
  if (items && items.length) openPop({ x: e.clientX, y: e.clientY }, items);
});
function contextItems(t) {
  const card = t.closest('.card[data-note]');
  if (card) {
    const id = card.dataset.note;
    if (card.classList.contains('trash')) {
      const n = noteById(id); if (!n) return null;
      return [
        { label: 'Restaurar', icon: I.restore(), run: () => { n.trashed_at = ''; queueSave('notes', n); paint(); toast('Nota restaurada'); } },
        { sep: true },
        { label: 'Borrar para siempre', icon: I.trash(), danger: true, run: () => confirmModal('¿Borrar para siempre?', 'No se puede deshacer.', () => { notes.splice(notes.indexOf(n), 1); removeRec('notes', n.id); paint(); }) },
      ];
    }
    return noteMenuItems(id, true);
  }
  const drop = t.closest('[data-drop], .fcard[data-arg]');
  if (drop) {
    const key = drop.dataset.drop != null ? drop.dataset.drop : drop.dataset.arg;
    if (key === 'trash') return trashed().length ? [{ label: 'Vaciar la papelera', icon: I.trash(), danger: true, run: () => emptyTrash() }] : null;
    const items = [{ label: 'Nueva nota aquí', icon: I.plus(), run: () => { goList(key === 'all' ? null : key); startNew(); } }];
    if (key && key !== 'all') { const more = folderMenuItems(key); if (more) items.push({ sep: true }, ...more); }
    else items.push({ label: 'Nueva carpeta', icon: I.folder(), run: () => newFolder('') });
    return items;
  }
  if (t.closest('.ed') && ED.view) return editorContextItems(t);
  if (st.view === 'note') return noteMenuItems(st.noteId);
  if (st.view === 'trash') return trashed().length ? [{ label: 'Vaciar la papelera', icon: I.trash(), danger: true, run: () => emptyTrash() }] : null;
  if (st.view === 'list' || st.view === 'folders') {
    const here = st.folder || '';
    return [
      { label: 'Nueva nota', icon: I.plus(), run: startNew },
      { label: here ? 'Nueva subcarpeta' : 'Nueva carpeta', icon: I.folder(), run: () => newFolder(here) },
    ];
  }
  return null;
}
/* Dentro del editor: portapapeles, formato y las acciones de la nota. */
function editorContextItems(t) {
  const es = editorState() || { marks: {} };
  const sel = ED.view.state.selection, hasSel = !sel.empty;
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
  const items = [];
  const a = t.closest('a[href]');
  if (a) items.push(
    { label: 'Abrir enlace', icon: I.open(), run: () => window.open(a.href, '_blank', 'noopener') },
    { label: 'Copiar enlace', icon: I.link(), run: () => navigator.clipboard && navigator.clipboard.writeText(a.href).then(() => toast('Enlace copiado')) },
    { sep: true });
  const img = t.closest('.ed-img img');
  if (img && img.src) items.push({ label: 'Abrir imagen', icon: I.open(), run: () => window.open(img.src, '_blank', 'noopener') }, { sep: true });
  items.push(
    { label: 'Cortar', icon: I.cut(), hint: mod + 'X', disabled: !hasSel, run: () => { editorFocus(); document.execCommand('cut'); } },
    { label: 'Copiar', icon: I.copy(), hint: mod + 'C', disabled: !hasSel, run: () => { editorFocus(); document.execCommand('copy'); } },
    { label: 'Pegar', icon: I.paste(), hint: mod + 'V', run: () => editorPasteFromClipboard() },
    { label: 'Seleccionar todo', icon: I.selectAll(), hint: mod + 'A', run: () => editorCmd('selectAll') },
    { sep: true },
  );
  if (hasSel) items.push(
    { label: es.marks.strong ? 'Quitar negrita' : 'Negrita', icon: I.bold(), hint: mod + 'B', run: () => { editorCmd('bold'); paintToolbar(); } },
    { label: es.marks.em ? 'Quitar cursiva' : 'Cursiva', icon: I.italic(), hint: mod + 'I', run: () => { editorCmd('italic'); paintToolbar(); } },
    { label: es.marks.strike ? 'Quitar tachado' : 'Tachado', icon: I.strike(), run: () => { editorCmd('strike'); paintToolbar(); } },
    { sep: true },
  );
  return items.concat(noteMenuItems(st.noteId) || []);
}
async function editorPasteFromClipboard() {
  if (!navigator.clipboard) { toast('Usa Ctrl+V para pegar'); return; }
  try {
    if (navigator.clipboard.read) {
      const its = await navigator.clipboard.read();
      for (const it of its) {
        const imgType = it.types.find(x => /^image\//.test(x));
        if (imgType) { const b = await it.getType(imgType); insertImage(new File([b], 'pegada.' + imgType.split('/')[1], { type: imgType })); return; }
      }
      for (const it of its) {
        if (it.types.includes('text/html')) { const h = await (await it.getType('text/html')).text(); editorPaste({ html: h }); return; }
        if (it.types.includes('text/plain')) { const s = await (await it.getType('text/plain')).text(); editorPaste({ text: s }); return; }
      }
      return;
    }
    editorPaste({ text: await navigator.clipboard.readText() });
  } catch (_) { toast('El navegador no dejó leer el portapapeles: usa Ctrl+V'); }
}
function emptyTrash() {
  confirmModal('¿Vaciar la papelera?', `Se borran ${trashed().length} notas para siempre.`, () => { trashed().forEach(n => { notes.splice(notes.indexOf(n), 1); removeRec('notes', n.id); }); paint(); });
}
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
    case 'newFolderFromMove': { const mid = st.moveId || st.noteId; closeModal(); promptFolder('Nueva carpeta', '', name => { const f = { id: genId(), name, parent: '', order: String(Date.now()), icon: '' }; folders.push(f); createRec('folders', f); const n = noteById(mid); if (n) { n.folder = f.id; queueSave('notes', n); } paint(); }); break; }
    case 'folderMenu': e.stopPropagation(); folderMenu(arg, el); break;
    case 'moveNote': moveNoteModal(arg); break;
    case 'moveTo': { const mid = st.moveId || st.noteId; closeModal(); moveNoteTo(mid, arg); break; }
    case 'noteMenu': noteMenu(el); break;
    case 'share': shareMenu(st.noteId, el); break;
    case 'shareLink': shareLink(arg); break;
    case 'shareCopy': copyShareLink(arg); break;
    case 'shareStop': stopSharing(arg); break;
    case 'shareSend': { const n = noteById(arg); if (n && n.share && navigator.share) navigator.share({ title: n.title || 'Nota', url: shareUrl(n.share) }).catch(() => {}); break; }
    case 'restore': { const n = noteById(arg); if (n) { n.trashed_at = ''; queueSave('notes', n); paint(); toast('Nota restaurada'); } break; }
    case 'deleteForever': { const n = noteById(arg); if (n) confirmModal('¿Borrar para siempre?', 'No se puede deshacer.', () => { notes.splice(notes.indexOf(n), 1); removeRec('notes', n.id); paint(); }); break; }
    case 'emptyTrash': emptyTrash(); break;
    case 'histPreview': st.histPreview = st.histPreview === arg ? null : arg; paint(); break;
    case 'histRestore': histRestore(arg); break;
    case 'ed': if (arg === 'image') pickImage(); else editorCmd(arg); paintToolbar(); break;
    case 'tbText': st.tbText = !st.tbText; paintToolbar(); editorFocus(); break;
    case 'tbClose': st.tbOn = false; st.tbText = false; editorBlur(); document.getElementById('toolbar').classList.remove('on'); break;
    case 'modalClose': closeModal(); break;
    case 'modalOk': modalOk(); break;
    case 'setting': if (el.classList.contains('tog')) setSetting(arg, !el.classList.contains('on')); break;
    case 'pickSetting': openPop(el, SETTING_OPTS[arg].map(([v, l]) => ({ label: l, icon: settings[arg] === v ? I.check() : '', run: () => setSetting(arg, v) }))); break;
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
