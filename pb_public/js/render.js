/* ═══════════════ render.js — HTML de cada vista + morph ═══════════════
   Como en tareas: cada paint() genera el HTML entero de las regiones
   (#side, #head, #content, #toolbar) y morphdom aplica solo la diferencia.
   Excepción: con una nota abierta, #content NO se repinta (ahí vive el
   editor de ProseMirror); solo cabecera, chip y metadatos. */
'use strict';
let swUpdateReady = false;

function morph(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof morphdom === 'undefined') { el.innerHTML = html; return; }
  const t = el.cloneNode(false);
  t.innerHTML = html;
  try {
    morphdom(el, t, { childrenOnly: true, onBeforeElUpdated(fromEl) { return !((fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA') && fromEl === document.activeElement); } });
  } catch (e) { console.error('morph', id, e); el.innerHTML = html; }
}
const btn = (act, icon, title, extra) => `<button class="ib${extra && extra.cls ? ' ' + extra.cls : ''}" data-act="${act}"${extra && extra.arg != null ? ` data-arg="${esc(extra.arg)}"` : ''} title="${esc(title || '')}" aria-label="${esc(title || '')}"${extra && extra.disabled ? ' disabled' : ''}>${icon}</button>`;

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;
const scopeTitle = () => st.view === 'trash' ? 'Eliminadas' : st.folder === null ? 'Notas' : st.folder === '' ? 'Notas sueltas' : (folderById(st.folder) || {}).name || 'Notas';

/* ─── barra lateral (escritorio) ─── */
function sideHTML() {
  /* data-drop: acepta notas arrastradas desde la lista (actions.js). «Todo»
     no es una carpeta: no acepta. */
  const row = (key, icon, label, count, on) => `<button class="sd-row${on ? ' on' : ''}" data-act="goFolder" data-arg="${esc(key)}"${key !== 'all' ? ` data-drop="${esc(key)}"` : ''}><span class="sd-ico">${icon}</span><span class="sd-lbl">${esc(label)}</span><span class="sd-cnt">${count || ''}</span></button>`;
  let h = `<div class="sd-brand">Paper Notes</div>
  <div class="sd-search">${I.search()}<input id="q" placeholder="Buscar" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>
  <div class="sd-scroll">`;
  h += row('all', I.note(), 'Todo', active().length, st.view !== 'trash' && st.folder === null);
  h += row('', I.folder(), 'Notas', active().filter(n => !n.folder).length, st.view !== 'trash' && st.folder === '');
  h += folderRowsHTML('', 0);
  h += `<div class="sd-gap"></div>`;
  h += `<button class="sd-row sd-new" data-act="newFolder"><span class="sd-ico">${I.plus()}</span><span class="sd-lbl">Nueva carpeta</span></button>`;
  h += row('trash', I.trash(), 'Eliminadas', trashed().length, st.view === 'trash');
  h += `</div><div class="sd-foot">
    ${swUpdateReady ? `<button class="sd-row sd-upd" data-act="reload"><span class="sd-ico">${I.restore()}</span><span class="sd-lbl">Actualizar la app</span></button>` : ''}
    <button class="sd-row" data-act="goSettings"><span class="sd-ico">${I.settings()}</span><span class="sd-lbl">Ajustes</span></button>
  </div>`;
  return h;
}
function folderRowsHTML(parent, depth) {
  return folderChildren(parent).map(f => `<button class="sd-row sd-f${st.view !== 'trash' && st.folder === f.id ? ' on' : ''}" style="--d:${depth}" data-act="goFolder" data-arg="${f.id}" data-folder="${f.id}" data-drop="${f.id}"><span class="sd-ico">${st.folder === f.id ? I.folderOpen() : I.folder()}</span><span class="sd-lbl">${esc(f.name)}</span><span class="sd-cnt">${folderCount(f.id) || ''}</span></button>` + folderRowsHTML(f.id, depth + 1)).join('');
}

/* ─── cabeceras ─── */
function headHTML() {
  switch (st.view) {
    case 'note': return noteHeadHTML();
    case 'folders': return `<div class="hd hd-center"><div class="hd-l">${btn('back', I.back(), 'Atrás')}</div><div class="hd-title">Carpetas</div><div class="hd-r">${btn('goTrash', I.trash(), 'Eliminadas')}</div></div>`;
    case 'settings': return `<div class="hd hd-center"><div class="hd-l">${btn('back', I.back(), 'Atrás')}</div><div class="hd-title">Ajustes</div><div class="hd-r"></div></div>`;
    case 'trash': return `<div class="hd hd-center"><div class="hd-l">${btn('back', I.back(), 'Atrás')}</div><div class="hd-title">Eliminadas</div><div class="hd-r">${trashed().length ? btn('emptyTrash', I.trash(), 'Vaciar papelera') : ''}</div></div>`;
    case 'history': return `<div class="hd hd-center"><div class="hd-l">${btn('back', I.back(), 'Atrás')}</div><div class="hd-title">Historial</div><div class="hd-r"></div></div>`;
    default: return listHeadHTML();
  }
}
function listHeadHTML() {
  const sub = st.folder !== null && !isDesktop();
  return `<div class="hd hd-list">
    <div class="hd-l">${sub ? btn('goFolder', I.back(), 'Todas las notas', { arg: 'all' }) : ''}</div>
    <div class="hd-r">${btn('goFolders', I.folder(), 'Carpetas', { cls: 'm-only' })}${btn('goSettings', I.settings(), 'Ajustes', { cls: 'm-only' })}</div>
  </div>
  <h1 class="page-title">${esc(scopeTitle())}</h1>
  <div class="m-search m-only"><div class="sd-search">${I.search()}<input id="qm" placeholder="Buscar" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div></div>`;
}
function noteHeadHTML() {
  const n = noteById(st.noteId);
  if (!n) return '';
  return `<div class="hd hd-note">
    <div class="hd-l">${btn('closeNote', I.back(), 'Atrás')}</div>
    <div class="hd-r">${btn('share', I.share(), 'Compartir')}${btn('noteMenu', I.more(), 'Más')}</div>
  </div>`;
}

/* ─── lista ─── */
function cardHTML(n, remote) {
  const cover = coverOf(n);
  const ex = remote && remote.fragment ? remote.fragment : excerptOf(n);
  /* draggable: se arrastra a una carpeta de la barra lateral (solo escritorio). */
  return `<article class="card${n.pinned ? ' pinned' : ''}" data-act="open" data-arg="${n.id}" data-note="${n.id}"${isDesktop() ? ' draggable="true"' : ''}>
    ${cover ? `<div class="card-cover"><img src="${esc(attUrl(cover, '800x0'))}" alt="" loading="lazy" draggable="false"></div>` : ''}
    <div class="card-body">
      <div class="card-title">${esc(n.title) || '<span class="muted">Sin título</span>'}</div>
      <div class="card-ex">${ex ? esc(ex) : '<span class="muted">Sin texto</span>'}</div>
      <div class="card-meta">${n.pinned ? `<span class="card-pin">${I.pin()}</span>` : ''}${n.share ? `<span class="card-pin card-shared" title="Compartida por enlace">${I.link()}</span>` : ''}${esc(niceDate(n.updated))}${n.folder && st.folder === null ? ` · ${esc((folderById(n.folder) || {}).name || '')}` : ''}</div>
    </div></article>`;
}
function listHTML() {
  const tags = tagsInScope();
  let h = '';
  if (tags.length) h += `<div class="chips">${tags.slice(0, 30).map(t => `<button class="chip${st.tag === t.name ? ' on' : ''}" data-act="toggleTag" data-arg="${esc(t.name)}">#${esc(t.name)}<span class="chip-n">${t.count}</span></button>`).join('')}</div>`;
  if (st.remote) {
    const rs = st.remote.results || [];
    h += `<div class="sec-h">Resultados del buscador <span class="muted">${rs.length}${st.remote.took_ms != null ? ` · ${st.remote.took_ms} ms` : ''}</span><button class="chip" data-act="clearRemote">${I.close()} Quitar</button></div>`;
    if (!rs.length) h += `<div class="empty">Nada por ahí.</div>`;
    else h += `<div class="grid ${settings.layout}">${rs.map(r => { const n = noteById(r.id); return n ? cardHTML(n, r) : ''; }).join('')}</div>`;
    return h;
  }
  const arr = listNotes();
  if (!arr.length) {
    if (!_dataReady) return h + `<div class="empty">Cargando…</div>`;
    return h + `<div class="empty">${st.q ? 'Nada con ese texto. Pulsa Intro para buscar por significado.' : 'Sin notas todavía. Toca + para escribir la primera.'}</div>`;
  }
  const pinned = st.q ? [] : arr.filter(n => n.pinned), rest = st.q ? arr : arr.filter(n => !n.pinned);
  if (pinned.length) h += `<div class="sec-h">Fijadas</div><div class="grid ${settings.layout}">${pinned.map(n => cardHTML(n)).join('')}</div>`;
  if (rest.length) h += (pinned.length ? `<div class="sec-h">Notas</div>` : '') + `<div class="grid ${settings.layout}">${rest.map(n => cardHTML(n)).join('')}</div>`;
  if (st.q) h += `<div class="hint">Intro busca por significado y tolera errores de escritura.</div>`;
  return h;
}

/* ─── carpetas (pantalla del teléfono) ─── */
function foldersHTML() {
  const card = (key, name, count, on, depth) => `<button class="fcard${on ? ' on' : ''}" style="--d:${depth || 0}" data-act="goFolder" data-arg="${esc(key)}"><span class="fcard-chk">${on ? I.check() : ''}</span><span class="fcard-name">${esc(name)}</span><span class="fcard-n">${count}</span>${key && key !== 'all' ? `<span class="fcard-more" data-act="folderMenu" data-arg="${esc(key)}">${I.more()}</span>` : ''}</button>`;
  const rec = (parent, depth) => folderChildren(parent).map(f => card(f.id, f.name, folderCount(f.id), st.folder === f.id, depth) + rec(f.id, depth + 1)).join('');
  return `<div class="fcards">
    ${card('all', 'Todo', active().length, st.folder === null)}
    ${card('', 'Notas', active().filter(n => !n.folder).length, st.folder === '')}
    ${rec('', 0)}
    <button class="fcard fcard-new" data-act="newFolder"><span class="fcard-plus">${I.plus()}</span><span class="fcard-name">Nueva carpeta</span></button>
  </div>`;
}

/* ─── nota ─── */
function noteHTML() {
  const n = noteById(st.noteId);
  if (!n) return `<div class="empty">Esa nota ya no está.</div>`;
  return `<div class="note-wrap">
    ${noteMetaHTML(n)}
    <div id="ed-host" class="ed-host"></div>
  </div>`;
}
function noteMetaHTML(n) {
  const f = n.folder ? folderById(n.folder) : null;
  return `<div id="note-meta" class="note-meta">
    <button class="chip chip-folder" data-act="moveNote" data-arg="${n.id}">${I.folder()} ${esc(f ? f.name : 'Notas')}</button>
    <div class="note-date">${esc(niceDate(n.updated, true))} · ${charCount(n)} caracteres${n.pinned ? ' · fijada' : ''}${n.share ? ' · <button class="note-shared" data-act="shareLink" data-arg="' + n.id + '">compartida por enlace</button>' : ''}</div>
  </div>`;
}
/* La barra de formato (HyperOS: una fila, scroll horizontal, grupos, X al
   final). En el teléfono va pegada sobre el teclado; en escritorio fija
   arriba del editor. `expanded` = se tocó la T. */
function toolbarHTML() {
  if (st.view !== 'note') return '';
  const es = editorState() || { marks: {}, block: 'paragraph' };
  const tb = (act, icon, title, on, disabled) => `<button class="tb${on ? ' on' : ''}" data-act="ed" data-arg="${act}" title="${title}" aria-label="${title}"${disabled ? ' disabled' : ''}>${icon}</button>`;
  const sep = '<span class="tb-sep"></span>';
  let h = `<div class="tb-row">`;
  h += tb('undo', I.undo(), 'Deshacer', false, !es.canUndo) + tb('redo', I.redo(), 'Rehacer', false, !es.canRedo) + sep;
  h += tb('image', I.image(), 'Imagen') + tb('todo', I.todo(), 'Lista de tareas', es.list === 'todo_list');
  h += `<button class="tb${st.tbText ? ' on' : ''}" data-act="tbText" title="Formato de texto" aria-label="Formato de texto">${I.text()}</button>`;
  if (st.tbText || isDesktop()) {
    h += sep + tb('h1', I.h1(), 'Título', es.block === 'heading1') + tb('h2', I.h2(), 'Subtítulo', es.block === 'heading2') + tb('h3', I.h3(), 'Encabezado', es.block === 'heading3');
    h += sep + tb('bold', I.bold(), 'Negrita', es.marks.strong) + tb('italic', I.italic(), 'Cursiva', es.marks.em) + tb('underline', I.underline(), 'Subrayado', es.marks.underline) + tb('strike', I.strike(), 'Tachado', es.marks.strike);
    h += sep + tb('bullet', I.bullet(), 'Viñetas', es.list === 'bullet_list') + tb('ordered', I.ordered(), 'Numerada', es.list === 'ordered_list');
    h += sep + tb('quote', I.quote(), 'Cita', es.quote) + tb('code', I.code(), 'Código', es.block === 'code_block') + tb('hr', I.hr(), 'Separador');
    h += sep + tb('indent', I.indent(), 'Aumentar sangría', false, !es.canIndent) + tb('outdent', I.outdent(), 'Reducir sangría', false, !es.canOutdent);
  }
  h += `</div><button class="tb tb-x m-only" data-act="tbClose" title="Cerrar teclado" aria-label="Cerrar teclado">${I.close()}</button>`;
  return h;
}

/* ─── papelera ─── */
function trashHTML() {
  const arr = trashed().sort((a, b) => (b.trashed_at || '').localeCompare(a.trashed_at || ''));
  if (!arr.length) return `<div class="empty">La papelera está vacía.</div>`;
  return `<p class="hint">Se borran solas a los 30 días.</p><div class="grid ${settings.layout}">${arr.map(n => `<article class="card trash" data-note="${n.id}">
    <div class="card-body">
      <div class="card-title">${esc(n.title) || '<span class="muted">Sin título</span>'}</div>
      <div class="card-ex">${esc(excerptOf(n)) || '<span class="muted">Sin texto</span>'}</div>
      <div class="card-meta">eliminada ${esc(niceDate(n.trashed_at))}</div>
      <div class="card-acts"><button class="chip" data-act="restore" data-arg="${n.id}">${I.restore()} Restaurar</button><button class="chip danger" data-act="deleteForever" data-arg="${n.id}">${I.trash()} Borrar</button></div>
    </div></article>`).join('')}</div>`;
}

/* ─── historial de versiones ─── */
function historyHTML() {
  const n = noteById(st.histId);
  if (!n) return `<div class="empty">Esa nota ya no está.</div>`;
  const vs = st.histVersions;
  let h = `<div class="hist-wrap"><div class="hist-cur"><div class="sec-h">Ahora · versión ${n.version}</div></div>`;
  if (vs === null) h += `<div class="empty">Cargando…</div>`;
  else if (!vs.length) h += `<div class="empty">Sin versiones anteriores. Se guarda una cada 20 cambios y en cada conflicto.</div>`;
  else {
    h += `<div class="hist-list">${vs.map(v => `<button class="hist-row${st.histPreview === v.id ? ' on' : ''}" data-act="histPreview" data-arg="${v.id}">
      <span class="hist-v">v${v.version}</span><span class="hist-date">${esc(niceDate(v.created, true))}</span><span class="hist-reason">${v.reason === 'conflict' ? 'conflicto' : v.reason === 'manual' ? 'manual' : 'copia'}</span>
    </button>`).join('')}</div>`;
    const p = vs.find(v => v.id === st.histPreview);
    if (p) h += `<div class="hist-prev"><div class="sec-h">Versión ${p.version} <button class="chip" data-act="histRestore" data-arg="${p.id}">${I.restore()} Restaurar esta</button></div><div class="hist-body"><pre>${esc(p.body)}</pre></div></div>`;
  }
  return h + `</div>`;
}

/* ─── ajustes ─── */
/* En Mac e iOS el <select> nativo es bonito y se queda; en el resto
   (Windows, Android) el desplegable lo pinta la app con su popover. */
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Mac|iPhone|iPad/.test(navigator.userAgent || '');
const SETTING_OPTS = {
  font: [['s', 'Pequeña'], ['m', 'Mediana'], ['l', 'Grande']],
  sort: [['updated', 'Por fecha de modificación'], ['created', 'Por fecha de creación'], ['title', 'Por título']],
  layout: [['grid', 'Ver en cuadrícula'], ['list', 'Ver en lista']],
};
function settingsHTML() {
  const sel = (key, val, opts) => isApple()
    ? `<span class="st-val"><select data-act="setting" data-arg="${key}">${opts.map(([v, l]) => `<option value="${v}"${val === v ? ' selected' : ''}>${l}</option>`).join('')}</select>${I.chevDown()}</span>`
    : `<button class="st-val pick" data-act="pickSetting" data-arg="${key}">${esc((opts.find(o => o[0] === val) || opts[0])[1])}${I.chevDown()}</button>`;
  const tog = (key, on) => `<button class="tog${on ? ' on' : ''}" data-act="setting" data-arg="${key}" role="switch" aria-checked="${on}"><span></span></button>`;
  const row = (label, right, act, arg) => `<div class="st-row${act ? ' nav' : ''}"${act ? ` data-act="${act}"${arg ? ` data-arg="${esc(arg)}"` : ''}` : ''}><span class="st-lbl">${label}</span>${right}</div>`;
  return `<div class="st-wrap">
    <div class="sec-h">Estilo</div><div class="st-card">
      ${row('Tamaño de fuente', sel('font', settings.font, SETTING_OPTS.font))}
      ${row('Ordenar', sel('sort', settings.sort, SETTING_OPTS.sort))}
      ${row('Diseño', sel('layout', settings.layout, SETTING_OPTS.layout))}
    </div>
    <div class="sec-h">Notas</div><div class="st-card">
      ${row('Título automático en notas nuevas', tog('autoTitle', settings.autoTitle))}
      <p class="st-help">Con el ajuste activo, la primera línea de una nota nueva ya tiene formato de título, como en Apple Notes. Sin él, la nota empieza por cuerpo y el título se toma de la primera línea.</p>
    </div>
    <div class="sec-h">Datos</div><div class="st-card">
      ${row('Elementos eliminados recientemente', `<span class="st-val">${trashed().length}${I.chevron()}</span>`, 'goTrash')}
      ${row('Exportar todas las notas', `<span class="st-val">${I.download()}</span>`, 'exportAll')}
      ${row('Importar desde Obsidian', `<span class="st-val muted">próximamente</span>`)}
    </div>
    <div class="sec-h">Cuenta</div><div class="st-card">
      ${row(esc(localStorage.getItem('pb_email') || ''), `<span class="st-val">${I.logout()}</span>`, 'logout')}
    </div>
    <div class="sec-h">App</div><div class="st-card">
      ${row('Versión', `<span class="st-val muted">${APP_V}</span>`)}
      ${row('Buscar actualización', `<span class="st-val">${I.restore()}</span>`, 'reloadFresh')}
    </div>
  </div>`;
}

/* ─── paint ─── */
function paint() {
  const app = document.getElementById('app');
  app.dataset.view = st.view;
  document.documentElement.dataset.font = settings.font;
  if (isDesktop()) morph('side', sideHTML());
  morph('head', headHTML());
  if (st.view === 'note') {
    const n = noteById(st.noteId);
    const host = document.getElementById('ed-host');
    if (!host || host.dataset.note !== st.noteId) {
      morph('content', noteHTML());
      const h = document.getElementById('ed-host');
      if (h && n) { h.dataset.note = n.id; mountEditor(h, n); }
    } else if (n) {
      morph('note-meta', noteMetaHTML(n).replace(/^<div id="note-meta" class="note-meta">|<\/div>$/g, ''));
    }
  } else {
    if (document.getElementById('ed-host')) unmountEditor();
    morph('content', st.view === 'folders' ? foldersHTML() : st.view === 'settings' ? settingsHTML() : st.view === 'trash' ? trashHTML() : st.view === 'history' ? historyHTML() : listHTML());
  }
  morph('toolbar', toolbarHTML());
  document.getElementById('toolbar').classList.toggle('on', st.view === 'note' && (st.tbOn || isDesktop()));
  const fab = document.getElementById('fab');
  fab.style.display = (st.view === 'list' || st.view === 'folders') ? '' : 'none';
  if (st.refocus) { const el = document.getElementById(st.refocus); st.refocus = null; if (el) { el.focus(); } }
}
function paintToolbar() { if (st.view === 'note') morph('toolbar', toolbarHTML()); }
