/* ═══════════════ state.js — datos en memoria y consultas ═══════════════
   Como en tareas: los arrays son la verdad en pantalla, IndexedDB los
   persiste y sync.js los sube. Nada aquí toca el DOM. */
'use strict';

const genId = () => { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; for (let i = 0; i < 15; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
/* Texto comparable: minúsculas y sin tildes («diseno» encuentra «diseñar»). */
const sNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Datos. `notes` incluye la papelera (trashed_at != ''). */
let notes = [];
let folders = [];
let attachments = [];   // {id, note, file, kind, width, height}
let _dataReady = false;

/* Ajustes locales (dispositivo) y de cuenta (users.settings, sincronizado). */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('notas.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('notas.' + k, JSON.stringify(v)); } catch (_) { } },
};
const settings = {
  layout: LS.get('layout', 'grid'),        // grid | list
  sort: LS.get('sort', 'updated'),         // updated | created | title
  font: LS.get('font', 'm'),               // s | m | l
  autoTitle: true,                         // users.settings.autoTitle (se carga en boot)
};

/* Estado de la interfaz. `view`: list | note | folders | settings | trash | history.
   `folder`: null = Todo, '' = las sueltas en "Notas", id = esa carpeta. */
const st = {
  view: 'list', folder: null, tag: null, q: '', remote: null,   // remote: resultados del buscador (al confirmar)
  noteId: null, editing: false, histId: null, histVersions: null, histPreview: null,
  menu: null, modal: null, sel: new Set(), refocus: null,
};

/* ─── Consultas ─── */
const noteById = id => notes.find(n => n.id === id) || null;
const folderById = id => folders.find(f => f.id === id) || null;
const active = () => notes.filter(n => !n.trashed_at);
const trashed = () => notes.filter(n => !!n.trashed_at);

/* Todas las carpetas que cuelgan de `id` (ella incluida). */
function folderSubtree(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) folders.forEach(f => { if (f.parent === out[i] && !out.includes(f.id)) out.push(f.id); });
  return out;
}
function folderPath(id) {
  const parts = []; let f = folderById(id), guard = 0;
  while (f && guard++ < 50) { parts.unshift(f.name); f = f.parent ? folderById(f.parent) : null; }
  return parts.join(' / ');
}
function folderChildren(parent) {
  return folders.filter(f => (f.parent || '') === (parent || '')).sort(folderCmp);
}
const folderCmp = (a, b) => (a.order || '').localeCompare(b.order || '') || a.name.localeCompare(b.name, 'es');
const folderDepth = id => { let d = 0, f = folderById(id); while (f && f.parent && d < 50) { d++; f = folderById(f.parent); } return d; };
/* Conteo de notas activas por carpeta (incluye subcarpetas). */
function folderCount(id) {
  const ids = new Set(folderSubtree(id));
  return active().filter(n => ids.has(n.folder)).length;
}

const noteCmp = (a, b) => {
  if (settings.sort === 'title') return (a.title || '').localeCompare(b.title || '', 'es');
  if (settings.sort === 'created') return (b.created || '').localeCompare(a.created || '');
  return (b.updated || '').localeCompare(a.updated || '');
};

/* La lista principal según carpeta, etiqueta y búsqueda local. */
function listNotes() {
  let arr = active();
  if (st.folder === '') arr = arr.filter(n => !n.folder);
  else if (st.folder) { const ids = new Set(folderSubtree(st.folder)); arr = arr.filter(n => ids.has(n.folder)); }
  if (st.tag) arr = arr.filter(n => (n.tags || []).includes(st.tag));
  if (st.q.trim()) arr = localSearch(arr, st.q);
  else arr = arr.slice().sort(noteCmp);
  return arr;
}
/* Búsqueda mientras se escribe: cada palabra debe aparecer (prefijo) en el
   título o el cuerpo. El título pesa más; empate por fecha. La semántica y
   los errores tipográficos llegan del buscador al confirmar (st.remote). */
function localSearch(arr, q) {
  const words = sNorm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return arr.slice().sort(noteCmp);
  const scored = [];
  for (const n of arr) {
    const t = sNorm(n.title), p = sNorm(n.plain);
    let score = 0, ok = true;
    for (const w of words) {
      const it = t.indexOf(w), ip = p.indexOf(w);
      if (it < 0 && ip < 0) { ok = false; break; }
      if (it >= 0) score += (it === 0 || t[it - 1] === ' ') ? 6 : 3;
      if (ip >= 0) score += (ip === 0 || /\s/.test(p[ip - 1])) ? 2 : 1;
    }
    if (ok) scored.push({ n, score });
  }
  return scored.sort((a, b) => b.score - a.score || (b.n.updated || '').localeCompare(a.n.updated || '')).map(x => x.n);
}
/* Etiquetas en uso con conteo, dentro del ámbito actual (carpeta). */
function tagsInScope() {
  let arr = active();
  if (st.folder === '') arr = arr.filter(n => !n.folder);
  else if (st.folder) { const ids = new Set(folderSubtree(st.folder)); arr = arr.filter(n => ids.has(n.folder)); }
  const m = {};
  arr.forEach(n => (n.tags || []).forEach(t => { m[t] = (m[t] || 0) + 1; }));
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/* ─── Derivados y presentación ─── */
function deriveNote(n) {
  const d = MD.derive(n.body);
  n.title = d.title; n.plain = d.plain; n.tags = d.tags; n.links = d.links;
  return n;
}
/* Primera imagen del cuerpo → portada de la tarjeta. */
function coverOf(n) {
  const m = /!\[[^\]]*\]\(attachments\/([a-z0-9]{15})\)/.exec(n.body || '');
  return m ? m[1] : null;
}
/* El cuerpo sin el título, aplanado, para el fragmento de la tarjeta. */
function excerptOf(n, max) {
  let p = n.plain || '';
  if (n.title && p.startsWith(n.title)) p = p.slice(n.title.length);
  p = p.replace(/\s*\n+\s*/g, '  ').replace(/\s{3,}/g, '  ').trim();
  max = max || 110;
  return p.length > max ? p.slice(0, max).replace(/\s+\S*$/, '') + '…' : p;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const toDate = iso => new Date(String(iso || '').replace(' ', 'T'));
const p2 = n => String(n).padStart(2, '0');
/* "25 de octubre" · con hora si es de hoy ("18:43") · con año si no es este. */
function niceDate(iso, withTime) {
  if (!iso) return '';
  const d = toDate(iso); if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (sameDay && !withTime) return hm;
  const y = d.getFullYear() !== now.getFullYear() ? ` de ${d.getFullYear()}` : '';
  const base = `${d.getDate()} de ${MESES[d.getMonth()]}${y}`;
  return withTime ? `${base}, ${hm}` : base;
}
const charCount = n => (n.plain || '').replace(/\s/g, '').length;

/* Una nota nueva, vacía, con o sin línea de título según el ajuste. */
function newNote(folder) {
  const now = new Date().toISOString();
  return deriveNote({ id: genId(), folder: folder || '', body: settings.autoTitle ? '# ' : '', pinned: false, trashed_at: '',
    version: 0, created: now, updated: now, client_updated: now, device: 'web', fresh: true });
}
const isEmptyNote = n => !String(n.body || '').replace(/^#+\s*/gm, '').trim();
