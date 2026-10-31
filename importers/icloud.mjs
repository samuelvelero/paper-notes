#!/usr/bin/env node
/* ═══════════════ importers/icloud.mjs — Notas de iCloud → samukis-notes ═══════════════

   iCloud no exporta notas. Lo que sí hay: la app web de icloud.com/notes carga
   cada nota en memoria como un texto con atributos (su "TopoText"). Con la
   sesión abierta en un navegador, el script `importers/icloud-extract.js`
   recorre todas las notas, serializa párrafos y estilos a JSON y los manda a
   un receptor local (uno por archivo). Este importador toma esa carpeta,
   convierte cada nota al Markdown de la app y la crea por la API de
   PocketBase con TU cuenta de usuario, conservando carpetas (anidadas),
   fijadas y fecha de modificación (`client_updated`).

   Es idempotente: cada nota lleva `imported_from = icloud:<id de Apple>`;
   repetir la importación actualiza el cuerpo de las que cambiaron y no
   duplica nada.

     NOTAS_URL=https://notes.samukis.xyz NOTAS_EMAIL=… NOTAS_PASSWORD=… \
       node importers/icloud.mjs <carpeta-con-json> [--dry] [--limit N]

   Códigos de estilo de párrafo de Apple Notes (los mismos que en su protobuf):
     0 título · 1 encabezado · 2 subencabezado · 4 monoespaciado
     100 lista con puntos · 101 con guiones · 102 numerada · 103 casillas
   `indent` anida; `toDo.done` marca la casilla; `blockQuoteLevel` cita.
   Inline: `fontHints` 1 negrita, 2 cursiva, 3 ambas; `underlined`,
   `strikethrough`, `link`. Los adjuntos llegan como objetos con el id del
   registro `Attachment` de CloudKit. Si junto a la carpeta de notas hay una
   `adjuntos/` (la que escribe `importers/icloud-adjuntos.mjs`), las imágenes,
   dibujos y vistas previas se suben a `attachments` y la nota las enlaza como
   `![nombre](attachments/<id>)`; los enlaces recuperan su URL. Sin esa
   carpeta se anotan como pendientes. Las subidas se apuntan en
   `adjuntos/subidos.json` (id de Apple → id en PocketBase) para no repetirlas. */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
const DRY = args.includes('--dry');
const LIMIT = +(args[args.indexOf('--limit') + 1] || 0) || 0;
const IS_MAIN = (process.argv[1] || '').replace(/\\/g, '/').endsWith('/icloud.mjs');   // importado desde los tests, no hace nada
if (IS_MAIN && !dir) { console.error('uso: node importers/icloud.mjs <carpeta> [--dry] [--limit N]'); process.exit(2); }

const BASE = (process.env.NOTAS_URL || 'http://127.0.0.1:8093').replace(/\/+$/, '');
const EMAIL = process.env.NOTAS_EMAIL, PASS = process.env.NOTAS_PASSWORD;
/* Alternativa: como superusuario, fijando el dueño (`NOTAS_OWNER` = id del
   usuario en `users`). El hook de dueño no toca lo que manda un superusuario. */
const ADMIN_EMAIL = process.env.NOTAS_ADMIN_EMAIL, ADMIN_PASS = process.env.NOTAS_ADMIN_PASSWORD, OWNER = process.env.NOTAS_OWNER || '';

/* ─── Adjuntos (opcional) ─── */
const ADJ_DIR = dir ? path.join(dir, '..', 'adjuntos') : '';
const SUBIDOS_PATH = ADJ_DIR ? path.join(ADJ_DIR, 'subidos.json') : '';
let ADJ = {};        // id de Apple → { uti, name, url, image: { file, mime, width, height } | null, extras }
let SUBIDOS = {};    // id de Apple → { id, note } en PocketBase
if (ADJ_DIR && fs.existsSync(path.join(ADJ_DIR, 'index.json'))) {
  ADJ = JSON.parse(fs.readFileSync(path.join(ADJ_DIR, 'index.json'), 'utf8')).adjuntos || {};
  if (fs.existsSync(SUBIDOS_PATH)) SUBIDOS = JSON.parse(fs.readFileSync(SUBIDOS_PATH, 'utf8'));
}
export function setAdjuntos(adj, subidos) { ADJ = adj || {}; SUBIDOS = subidos || {}; }
const altOf = (e, fallback) => ((e && e.name) || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\[\]()]/g, '').trim() || fallback;

/* ─── Markdown ─── */
const esc = s => s.replace(/([*_`~\\])/g, '\\$1');
function inlineMd(runs) {
  let out = '';
  for (const r of runs) {
    let t = r.text || '';
    if (!t && !r.attachment) continue;
    if (r.attachment) {
      const a = r.attachment, u = a.uti || '';
      if (a.tag) t = '#' + a.tag;                                   // etiqueta inline (viene del mapa de hashtags)
      else if (/hashtag/.test(u)) t = '';                            // etiqueta sin texto conocido: se añade al final
      else if (/calculateresult/.test(u)) t = '';                    // resultado de cálculo inline: el texto ya está
      else if (/table/.test(u)) t = a.table ? tableMd(a.table) : '[tabla de Apple Notes, no importada]';
      else if (/public\.url/.test(u)) { const url = a.url || (ADJ[a.id] && ADJ[a.id].url); t = url ? `<${url}>` : '[vista previa de enlace]'; }
      else if (SUBIDOS[a.id]) {
        /* La imagen es un bloque en el dialecto (sola en su línea): se separa
           del texto con líneas en blanco; el aviso de PDF o vídeo va debajo. */
        const e = ADJ[a.id] || {};
        const isPdf = /pdf|doc\.scan/.test(u), isVideo = /mpeg|movie|video|quicktime/.test(u);
        t = `\n\n![${altOf(e, isPdf ? 'documento' : /paper|drawing/.test(u) ? 'dibujo' : 'imagen')}](attachments/${SUBIDOS[a.id].id})\n\n`;
        if (isPdf) t += `[PDF no importado: ${e.name || a.id}]\n\n`;
        else if (isVideo) t += `[vídeo no importado: ${e.name || a.id}]\n\n`;
      }
      else if (/jpeg|png|gif|heic|webp|public\.image/i.test(u)) t = `[imagen pendiente: ${a.id}]`;
      else if (/com\.apple\.paper|drawing/.test(u)) t = `[dibujo o escaneo pendiente: ${a.id}]`;
      else if (/gallery/.test(u)) t = `[galería pendiente: ${a.id}]`;
      else if (/mpeg|movie|video|quicktime/.test(u)) t = `[vídeo no importado: ${(ADJ[a.id] && ADJ[a.id].name) || a.id}]`;
      else if (/pdf/.test(u)) t = `[PDF no importado: ${(ADJ[a.id] && ADJ[a.id].name) || a.id}]`;
      else t = `[adjunto pendiente: ${u}]`;
      out += t; continue;
    }
    const lead = /^\s*/.exec(t)[0], trail = /\s*$/.exec(t)[0];
    let core = esc(t.slice(lead.length, t.length - trail.length));
    if (!core) { out += t; continue; }
    if (r.code) core = '`' + t.trim() + '`';
    if (r.bold) core = `**${core}**`;
    if (r.italic) core = `*${core}*`;
    if (r.underline) core = `++${core}++`;
    if (r.strike) core = `~~${core}~~`;
    if (r.link && !/^https?:\/\//.test(t.trim())) core = `[${core}](${r.link})`;
    out += lead + core + trail;
  }
  return out;
}
function tableMd(rows) {
  if (!rows || !rows.length) return '[tabla]';
  const w = Math.max(...rows.map(r => r.length));
  const line = r => '| ' + Array.from({ length: w }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
  return [line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}
export function toMarkdown(note) {
  const out = [];
  let num = 0, lastList = null;
  for (const p of note.paragraphs) {
    /* Las imágenes salen del párrafo y van debajo como bloques propios: en
       un título o una viñeta romperían el prefijo. */
    const imgs = [];
    const text = inlineMd(p.runs).replace(/\n*(!\[[^\]]*\]\(attachments\/[^)]+\))\n*(\[(?:PDF|vídeo) no importado:[^\]]*\]\n*)?/g, (m, img, extra) => { imgs.push(img + (extra ? '\n\n' + extra.trim() : '')); return ' '; }).replace(/ {2,}/g, ' ');
    const indent = '  '.repeat(p.indent || 0);
    const st = p.style;
    let line;
    if (imgs.length && !text.trim()) { out.push(imgs.join('\n\n')); lastList = -1; num = 0; continue; }
    if (st === 0) line = '# ' + text.trim();
    else if (st === 1) line = '## ' + text.trim();
    else if (st === 2) line = '### ' + text.trim();
    else if (st === 4) line = '```\n' + (p.runs.map(r => r.text || '').join('')) + '\n```';
    /* 3 aparece en pocas notas con texto normal (¿"monostyled" antiguo?): se deja como cuerpo */
    else if (st === 100 || st === 101) line = indent + '- ' + text.trim();
    else if (st === 102) { num = lastList === 102 && lastList != null ? num + 1 : (p.start || 1); line = indent + num + '. ' + text.trim(); }
    else if (st === 103) line = indent + (p.done ? '- [x] ' : '- [ ] ') + text.trim();
    else line = text;
    if (p.quote) line = line.split('\n').map(l => '> ' + l).join('\n');
    const isList = st >= 100 && st <= 103;
    /* las líneas de una misma lista van pegadas; lo demás, separado por línea en blanco */
    if (isList && lastList != null && (lastList >= 100)) out[out.length - 1] += '\n' + line;
    else out.push(line);
    lastList = isList ? st : (line.trim() ? -1 : lastList);
    if (!isList) num = 0;
    if (imgs.length) { out.push(imgs.join('\n\n')); lastList = -1; num = 0; }
  }
  let md = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  /* Apple toma el título de la primera línea aunque no tenga formato: si la
     primera línea ES el título, se le pone el formato; si no, se antepone. */
  const title = (note.title || '').trim();
  if (title && !/^# /.test(md)) {
    const first = md.split('\n')[0].trim();
    if (first.replace(/^\\/, '') === title || first === esc(title)) md = '# ' + title + md.slice(md.split('\n')[0].length);
    else md = `# ${title}\n\n${md}`;
  }
  if (note.tags && note.tags.length) {
    const missing = note.tags.filter(t => !new RegExp('(^|\\s)#' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(md));
    if (missing.length) md += '\n\n' + missing.map(t => '#' + t.replace(/\s+/g, '_')).join(' ');
  }
  return md;
}

/* ─── PocketBase ─── */
let token = '';
async function api(method, p, body) {
  const isFD = typeof FormData !== 'undefined' && body instanceof FormData;
  const r = await fetch(BASE + p, { method, headers: { ...(isFD ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: token } : {}) }, body: isFD ? body : body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${d.message || ''} ${d.data ? JSON.stringify(d.data) : ''}`);
  return d;
}
async function listAll(col, filter, fields) {
  let page = 1, out = [];
  for (;;) {
    const d = await api('GET', `/api/collections/${col}/records?page=${page}&perPage=500&skipTotal=1${filter ? '&filter=' + encodeURIComponent(filter) : ''}${fields ? '&fields=' + encodeURIComponent(fields) : ''}`);
    out = out.concat(d.items || []);
    if (!d.items || d.items.length < 500) break;
    page++;
  }
  return out;
}

async function main() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const notes = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(n => !n.deleted);
  /* maps.json (opcional, junto a la carpeta): carpetas y etiquetas por los 8
     primeros caracteres del UUID de la nota, sacados aparte de la página
     porque el modelo de la nota no expone ni su carpeta ni el texto de sus
     etiquetas inline. */
  const mapsPath = path.join(dir, '..', 'maps.json');
  if (fs.existsSync(mapsPath)) {
    const maps = JSON.parse(fs.readFileSync(mapsPath, 'utf8'));
    const short = id => String(id).split('::').pop().slice(0, 8).toUpperCase();
    const fo = Object.fromEntries(Object.entries(maps.folders || {}).map(([k, v]) => [k.toUpperCase(), v]));
    const tg = Object.fromEntries(Object.entries(maps.tags || {}).map(([k, v]) => [k.toUpperCase(), v]));
    let nf = 0, nt = 0;
    for (const n of notes) { const k = short(n.id); if (fo[k]) { n.folderPath = fo[k]; nf++; } if (tg[k] && tg[k].length) { n.tags = tg[k]; nt++; } }
    console.log(`maps.json: ${nf} notas con carpeta, ${nt} con etiquetas`);
  }
  console.log(`${notes.length} notas en ${dir}${LIMIT ? `, límite ${LIMIT}` : ''}`);
  const todo = LIMIT ? notes.slice(0, LIMIT) : notes;
  if (DRY) {
    for (const n of todo.slice(0, 5)) { console.log('\n────', n.title, '·', n.folderPath, '·', n.modified); console.log(toMarkdown(n)); }
    const styles = {}; notes.forEach(n => n.paragraphs.forEach(p => { styles[p.style] = (styles[p.style] || 0) + 1; }));
    console.log('\nestilos de párrafo:', styles);
    console.log('con imágenes:', notes.filter(n => n.paragraphs.some(p => p.runs.some(r => r.attachment && /image|jpeg|png|heic/i.test(r.attachment.uti || '')))).length);
    return;
  }
  let ownerField = {};
  if (ADMIN_EMAIL && ADMIN_PASS && OWNER) {
    const auth = await api('POST', '/api/collections/_superusers/auth-with-password', { identity: ADMIN_EMAIL, password: ADMIN_PASS });
    token = auth.token; ownerField = { owner: OWNER };
    console.log('como superusuario, dueño', OWNER);
  } else {
    if (!EMAIL || !PASS) { console.error('faltan NOTAS_EMAIL / NOTAS_PASSWORD (o NOTAS_ADMIN_EMAIL / NOTAS_ADMIN_PASSWORD / NOTAS_OWNER)'); process.exit(2); }
    const auth = await api('POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASS });
    token = auth.token;
  }
  const ownerFilter = OWNER ? `owner = '${OWNER}'` : '';

  /* carpetas: por ruta "A / B" */
  const folders = await listAll('folders', ownerFilter);
  const byPath = new Map();
  const pathOf = f => { const parts = []; let cur = f, g = 0; while (cur && g++ < 50) { parts.unshift(cur.name); cur = cur.parent ? folders.find(x => x.id === cur.parent) : null; } return parts.join(' / '); };
  folders.forEach(f => byPath.set(pathOf(f), f));
  async function ensureFolder(pathStr) {
    if (!pathStr) return '';
    if (byPath.has(pathStr)) return byPath.get(pathStr).id;
    const parts = pathStr.split(' / ');
    const parentPath = parts.slice(0, -1).join(' / ');
    const parent = parentPath ? await ensureFolder(parentPath) : '';
    const rec = await api('POST', '/api/collections/folders/records', { ...ownerField, name: parts[parts.length - 1], parent, order: '' });
    folders.push(rec); byPath.set(pathStr, rec);
    console.log('  carpeta nueva:', pathStr);
    return rec.id;
  }

  /* adjuntos de una nota que tienen imagen en `adjuntos/` y aún no se han subido */
  const pendientes = n => { const ids = new Set(); for (const p of n.paragraphs) for (const r of p.runs) if (r.attachment && r.attachment.id) ids.add(r.attachment.id); return [...ids].filter(id => ADJ[id] && ADJ[id].image && !SUBIDOS[id]); };
  async function subirAdjuntos(n, noteId) {
    let subidos = 0;
    for (const id of pendientes(n)) {
      const img = ADJ[id].image;
      const fd = new FormData();
      if (OWNER) fd.append('owner', OWNER);
      fd.append('note', noteId); fd.append('kind', 'image'); fd.append('width', String(img.width || 0)); fd.append('height', String(img.height || 0));
      fd.append('file', new Blob([fs.readFileSync(path.join(ADJ_DIR, img.file))], { type: img.mime }), img.file);
      const rec = await api('POST', '/api/collections/attachments/records', fd);
      SUBIDOS[id] = { id: rec.id, note: noteId };
      fs.writeFileSync(SUBIDOS_PATH, JSON.stringify(SUBIDOS, null, 1));
      subidos++;
    }
    return subidos;
  }
  if (Object.keys(ADJ).length) console.log(`adjuntos/: ${Object.keys(ADJ).length} adjuntos, ${Object.values(ADJ).filter(a => a.image).length} con imagen, ${Object.keys(SUBIDOS).length} ya subidos`);

  const existing = new Map((await listAll('notes', "imported_from ~ 'icloud:'" + (ownerFilter ? ' && ' + ownerFilter : ''), 'id,imported_from,body,version')).map(n => [n.imported_from, n]));
  let creadas = 0, actualizadas = 0, iguales = 0, fallos = 0, imagenes = 0, conImagenes = 0;
  for (const n of todo) {
    const key = 'icloud:' + n.id;
    try {
      const body = toMarkdown(n);
      const folder = await ensureFolder(n.folderPath);
      let rec = existing.get(key);
      const common = { ...ownerField, folder, pinned: !!n.pinned, client_updated: n.modified || new Date().toISOString(), device: 'importador-icloud', imported_from: key };
      if (rec) {
        if (rec.body === body) iguales++;
        else { rec = await api('PATCH', `/api/collections/notes/records/${rec.id}`, { ...common, body, base_version: rec.version }); actualizadas++; }
      } else {
        rec = await api('POST', '/api/collections/notes/records', { ...common, body });
        creadas++;
      }
      /* segunda pasada: subir las imágenes de la nota y enlazarlas en el cuerpo */
      const subidos = await subirAdjuntos(n, rec.id);
      if (subidos) {
        imagenes += subidos; conImagenes++;
        const body2 = toMarkdown(n);
        if (body2 !== rec.body) await api('PATCH', `/api/collections/notes/records/${rec.id}`, { ...common, body: body2, base_version: rec.version });
      }
    } catch (e) { fallos++; console.error('✘', n.title, e.message); }
  }
  console.log(`\ncreadas ${creadas} · actualizadas ${actualizadas} · sin cambios ${iguales} · fallos ${fallos}` + (imagenes ? ` · ${imagenes} imágenes subidas en ${conImagenes} notas` : ''));
}
if (IS_MAIN) main().catch(e => { console.error(e); process.exit(1); });
