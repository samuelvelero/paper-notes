#!/usr/bin/env node
/* ═══════════════ Servidor MCP de Notas ═══════════════
   Deja que Claude busque, lea y escriba en samukis-notes hablando con
   PocketBase (el mismo backend que usan la web y Android) y con el buscador,
   siempre con la cuenta del usuario: nunca con el superusuario.

   Cero dependencias, como en tareas: el protocolo MCP es JSON-RPC 2.0 (por
   stdio, un mensaje por línea; o por HTTP tras /mcp/<MCP_PATH_TOKEN>) y
   Node ≥ 18 trae `fetch`.

   Reglas del dominio, las mismas que la web (ver CLAUDE.md):
   - Lo único que se escribe de una nota es `body` (Markdown). `title`,
     `plain`, `tags` y `links` los deriva el servidor con pb_public/js/md.js;
     aquí se usa el MISMO archivo solo para presentar (extractos, títulos).
   - Antes de escribir se lee: `nota_agregar` y `nota_actualizar` mandan
     `base_version` y el hook guarda la versión anterior si hubo conflicto.
   - Nada se borra desde aquí. Como máximo, `papelera: true` (`trashed_at`);
     el cron del servidor vacía la papelera a los 30 días.
   - Una carpeta debe existir. Solo `crear_carpeta: true` la crea, a propósito.

   Configuración por variables de entorno:
     NOTAS_URL         base de PocketBase (def. http://127.0.0.1:8093)
     NOTAS_SEARCH_URL  endpoint del buscador (def. NOTAS_URL + /search, que
                       es la ruta que Caddy le pasa)
     NOTAS_EMAIL       correo del usuario de la app
     NOTAS_PASSWORD    su contraseña
     NOTAS_TZ          zona horaria para mostrar fechas (def. America/Lima)
     NOTAS_MD_JS       ruta a md.js (def. ../pb_public/js/md.js desde aquí) */

'use strict';

const path = require('path');

const BASE = (process.env.NOTAS_URL || 'http://127.0.0.1:8093').replace(/\/+$/, '');
const SEARCH = (process.env.NOTAS_SEARCH_URL || BASE + '/search').replace(/\/+$/, '');
const EMAIL = process.env.NOTAS_EMAIL || '';
const PASS = process.env.NOTAS_PASSWORD || '';
const TZ = process.env.NOTAS_TZ || 'America/Lima';
const MD = require(process.env.NOTAS_MD_JS || path.join(__dirname, '..', 'pb_public', 'js', 'md.js'));

const PAGE = 500;
const EXCERPT = 160;

/* ─── Texto y fechas ─── */
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const NONE = new Set(['ninguna', 'ninguno', 'quitar', 'raiz', 'null', 'none']);
const isNone = v => v === null || (typeof v === 'string' && (v.trim() === '' || NONE.has(norm(v))));
const bareTag = s => norm(s).replace(/^#+/, '');

/* PocketBase devuelve "2026-10-31 13:20:00.000Z"; se muestra en la zona del usuario. */
function fmtDate(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso).replace(' ', 'T'));
  if (isNaN(ms)) return String(iso);
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}`;
}

/* ─── Cuerpo de la nota (puro, sin red) ─── */

/* "# Título" delante del contenido, salvo que el contenido ya empiece por uno. */
function withTitle(titulo, contenido) {
  const t = String(titulo || '').trim().replace(/^#+\s*/, '');
  const c = String(contenido || '').replace(/\r\n?/g, '\n').replace(/^\n+/, '');
  if (!t) return c;
  if (MD.hasTitle(c)) return c;
  return c ? `# ${t}\n\n${c.replace(/\n+$/, '')}` : `# ${t}`;
}

/* Añade texto al final o al inicio. Al inicio respeta el título: si la nota
   empieza por "# Título", lo nuevo va justo debajo (como en Apple Notes). */
function appendBody(body, texto, donde) {
  const b = String(body || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const t = String(texto || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!t.trim()) throw new Error('No hay nada que añadir: "contenido" está vacío.');
  if (!b) return t;
  if (donde !== 'inicio') return `${b}\n\n${t}`;
  if (!MD.hasTitle(b)) return `${t}\n\n${b}`;
  const nl = b.indexOf('\n');
  const head = nl < 0 ? b : b.slice(0, nl);
  const rest = nl < 0 ? '' : b.slice(nl + 1).replace(/^\n+/, '');
  return rest ? `${head}\n\n${t}\n\n${rest}` : `${head}\n\n${t}`;
}

/* Las primeras palabras del cuerpo, sin el título ni marcas. */
function excerpt(plain, title, max = EXCERPT) {
  let p = String(plain || '').replace(/\r\n?/g, '\n').trim();
  if (title && p.startsWith(title)) p = p.slice(title.length).trim();
  p = p.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ');
  return p.length > max ? p.slice(0, max).replace(/\s+\S*$/, '') + '…' : p;
}

/* ─── Carpetas (puro) ─── */

/* "Trabajo / Clientes": el nombre de la carpeta precedido por sus ancestros. */
function folderPath(folders, id) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const parts = [];
  let cur = byId.get(id), guard = 0;
  while (cur && guard++ < 50) { parts.unshift(cur.name); cur = cur.parent ? byId.get(cur.parent) : null; }
  return parts.join(' / ');
}

/* Encuentra una carpeta por id, nombre exacto, ruta "A / B", prefijo o
   contenido (sin tildes ni mayúsculas). Ambigua o inexistente: error con la
   lista real, nunca una suposición. */
function pickFolder(folders, name) {
  const n = norm(name).replace(/\s*\/\s*/g, ' / ');
  const byId = folders.find(f => f.id === name);
  if (byId) return byId;
  const pathOf = f => norm(folderPath(folders, f.id));
  let hit = folders.filter(f => norm(f.name) === n || pathOf(f) === n);
  if (hit.length === 0) hit = folders.filter(f => norm(f.name).startsWith(n));
  if (hit.length === 0) hit = folders.filter(f => pathOf(f).includes(n));
  if (hit.length === 1) return hit[0];
  const list = (hit.length ? hit : folders).map(f => `"${folderPath(folders, f.id)}"`).join(', ');
  throw new Error(hit.length > 1
    ? `Carpeta ambigua "${name}": coincide con ${list}. Sé más específico (usa la ruta "Padre / Hija") o el id.`
    : `No existe la carpeta "${name}". Carpetas: ${list || '(ninguna)'}. No se creó nada: elige una existente o repite con crear_carpeta=true.`);
}

/* Árbol con conteos. `counts` = { folderId: notas no en papelera }. */
function folderTree(folders, counts) {
  const kids = new Map();
  for (const f of folders) {
    const k = f.parent && folders.some(p => p.id === f.parent) ? f.parent : '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(f);
  }
  const byOrder = (a, b) => String(a.order || '').localeCompare(String(b.order || '')) || a.name.localeCompare(b.name, 'es');
  const build = (parent, depth) => (kids.get(parent) || []).sort(byOrder).map(f => {
    const o = { id: f.id, nombre: f.name, notas: counts[f.id] || 0 };
    if (f.icon) o.icono = f.icon;
    const sub = depth < 20 ? build(f.id, depth + 1) : [];
    if (sub.length) o.subcarpetas = sub;
    return o;
  });
  return build('', 0);
}

/* ─── Cliente PocketBase ─── */
let token = '', uid = '';
async function login() {
  if (!EMAIL || !PASS) throw new Error('Faltan NOTAS_EMAIL y NOTAS_PASSWORD en la configuración del servidor MCP.');
  let r;
  try {
    r = await fetch(BASE + '/api/collections/users/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASS }), signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new Error(`No se pudo conectar con ${BASE} (¿Tailscale activo?): ${e.message}`); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('No se pudo iniciar sesión en Notas: ' + (d.message || 'HTTP ' + r.status));
  token = d.token; uid = d.record.id;
}
async function api(method, p, body, retry = true) {
  if (!token) await login();
  let r;
  try {
    r = await fetch(BASE + p, { method, headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new Error(`No se pudo conectar con ${BASE} (¿Tailscale activo?): ${e.message}`); }
  if (r.status === 401 && retry) { token = ''; return api(method, p, body, false); }
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) throw new Error('No existe esa nota (o no es tuya).');
    throw new Error(`PocketBase ${r.status}: ${d.message || ''} ${d.data ? JSON.stringify(d.data) : ''}`.trim());
  }
  d.__conflict = r.headers.get('X-Note-Conflict') || null;
  return d;
}
async function listAll(col, { filter = '', sort = '', fields = '' } = {}) {
  let page = 1, out = [];
  for (;;) {
    const q = `page=${page}&perPage=${PAGE}&skipTotal=1` + (sort ? `&sort=${encodeURIComponent(sort)}` : '') +
      (filter ? `&filter=${encodeURIComponent(filter)}` : '') + (fields ? `&fields=${encodeURIComponent(fields)}` : '');
    const d = await api('GET', `/api/collections/${col}/records?${q}`);
    out = out.concat(d.items || []);
    if (!d.items || d.items.length < PAGE) break;
    page++;
  }
  return out;
}
/* Valor seguro dentro de un filtro de PocketBase: fuera comillas y barras. */
const q = s => '"' + String(s).replace(/["\\]/g, '') + '"';

const folders = () => listAll('folders', { sort: 'order,name' });
const getNote = id => api('GET', `/api/collections/notes/records/${encodeURIComponent(String(id || '').trim())}`);

/* ─── Presentación ─── */
function shape(n, fs, full) {
  const o = { id: n.id, titulo: n.title || '(sin título)' };
  if (n.folder) o.carpeta = folderPath(fs, n.folder) || n.folder;
  if (n.pinned) o.fijada = true;
  if (n.tags && n.tags.length) o.etiquetas = n.tags;
  if (n.trashed_at) o.en_papelera = true;
  o.actualizada = fmtDate(n.updated);
  if (full) {
    if (n.links && n.links.length) o.enlaces = n.links;
    o.creada = fmtDate(n.created);
    o.version = n.version;
    o.contenido = n.body || '';
  } else {
    const ex = excerpt(n.plain, n.title);
    if (ex) o.extracto = ex;
  }
  return o;
}
const withConflict = (o, d) => (d.__conflict ? { ...o, aviso: `Alguien había guardado la versión ${d.__conflict} mientras tanto: ganó esta, la otra quedó en el historial.` } : o);

/* Nota por título: exacta primero, luego por prefijo, luego por contenido. */
async function noteByTitle(titulo) {
  const t = String(titulo || '').trim();
  const items = await listAll('notes', { filter: `trashed_at = '' && title ~ ${q(t)}`, sort: '-updated', fields: 'id,title,folder,updated' });
  const n = norm(t);
  let hit = items.filter(x => norm(x.title) === n);
  if (hit.length === 0) hit = items.filter(x => norm(x.title).startsWith(n));
  if (hit.length === 0) hit = items;
  if (hit.length === 1) return getNote(hit[0].id);
  if (hit.length === 0) throw new Error(`No hay ninguna nota con título "${t}". Prueba notas_buscar.`);
  throw new Error(`Hay ${hit.length} notas con ese título: ${hit.slice(0, 8).map(x => `"${x.title}" (${x.id})`).join(', ')}. Usa el id.`);
}

/* ─── Buscador ─── */
async function search(a) {
  if (!token) await login();
  const fs = await folders();
  const params = new URLSearchParams({ q: a.q, limit: String(Math.min(Math.max(a.limite || 10, 1), 50)) });
  if (a.carpeta) params.set('folder', pickFolder(fs, a.carpeta).id);
  if (a.etiqueta) params.set('tag', bareTag(a.etiqueta));
  if (a.incluir_papelera) params.set('trashed', '1');
  if (a.solo_lexico) params.set('semantic', '0');
  let r, d;
  try {
    r = await fetch(`${SEARCH}?${params}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(20000) });
    d = await r.json().catch(() => ({}));
  } catch (e) { r = null; d = { error: e.message }; }
  if (r && r.ok) {
    const notas = (d.results || []).map(x => {
      const o = { id: x.id, titulo: x.title || '(sin título)' };
      if (x.folder) o.carpeta = folderPath(fs, x.folder) || x.folder;
      if (x.tags && x.tags.length) o.etiquetas = x.tags;
      if (x.fragment) o.fragmento = x.fragment;
      o.puntaje = Math.round((x.score || 0) * 1e4) / 1e4;
      o.actualizada = fmtDate(x.updated);
      return o;
    });
    return { consulta: a.q, total: notas.length, notas, ...(d.took_ms != null ? { ms: d.took_ms } : {}) };
  }
  /* El buscador no responde (arrancando, modelo cargando, caído): se busca
     por palabras en PocketBase para no dejar a Claude a ciegas. */
  const words = norm(a.q).split(/\s+/).filter(Boolean).slice(0, 6);
  const parts = [a.incluir_papelera ? '' : "trashed_at = ''"].filter(Boolean);
  for (const w of words) parts.push(`(title ~ ${q(w)} || plain ~ ${q(w)})`);
  if (a.carpeta) parts.push(`folder = ${q(pickFolder(fs, a.carpeta).id)}`);
  const items = await listAll('notes', { filter: parts.join(' && '), sort: '-updated', fields: 'id,title,folder,tags,plain,trashed_at,updated' });
  const tag = a.etiqueta ? bareTag(a.etiqueta) : '';
  const hits = items.filter(n => !tag || (n.tags || []).some(x => bareTag(x) === tag)).slice(0, a.limite || 10);
  return { consulta: a.q, total: hits.length, notas: hits.map(n => shape(n, fs)),
    aviso: `El buscador no respondió (${r ? 'HTTP ' + r.status : d.error}); esto es una búsqueda por palabras exactas en PocketBase, sin semántica ni tolerancia a errores.` };
}

/* ─── Herramientas ─── */
const S = (description, extra) => ({ type: 'string', description, ...extra });
const B = description => ({ type: 'boolean', description });
const I = description => ({ type: 'integer', description });

const TOOLS = [
  { name: 'notas_buscar',
    description: 'Busca en las notas por significado y por texto a la vez (tolera errores de escritura, tildes y mayúsculas; "cosas para el viaje" encuentra una nota que dice "equipaje"). Devuelve la lista ya ordenada con un fragmento de cada nota: no hace falta leerlas todas, lee con nota_leer solo la que interese. Empieza por aquí cuando el usuario pregunte por algo que anotó.',
    inputSchema: { type: 'object', properties: {
      q: S('Qué buscar, en lenguaje natural o palabras sueltas.'),
      limite: I('Máximo de resultados (def. 10, máx. 50).'),
      carpeta: S('Solo en esta carpeta (nombre, ruta "Padre / Hija" o id).'),
      etiqueta: S('Solo notas con esta etiqueta (#opcional).'),
      incluir_papelera: B('Buscar en la papelera en vez de en las notas activas.'),
      solo_lexico: B('Apaga la búsqueda semántica (más rápido; solo palabras y prefijos).') }, required: ['q'] },
    run: async (a) => {
      if (!String(a.q || '').trim()) throw new Error('"q" no puede estar vacío.');
      return search({ ...a, q: String(a.q).trim() });
    } },
  { name: 'nota_leer',
    description: 'Lee una nota completa (Markdown) con sus metadatos: carpeta, etiquetas, fijada, versión, fechas. Por id (de notas_buscar / notas_recientes) o por título exacto.',
    inputSchema: { type: 'object', properties: { id: S('Id de la nota.'), titulo: S('Título, si no tienes el id.') } },
    run: async (a) => {
      if (!a.id && !a.titulo) throw new Error('Indica "id" o "titulo".');
      const n = a.id ? await getNote(a.id) : await noteByTitle(a.titulo);
      return shape(n, await folders(), true);
    } },
  { name: 'nota_crear',
    description: 'Crea una nota en Markdown. La primera línea "# Título" es el título (o pasa "titulo" aparte y se pone delante). Dialecto: # ## ###, **negrita**, *cursiva*, ~~tachado~~, ++subrayado++, listas - y 1., - [ ] por hacer, > cita, ```código```, ---, #etiqueta, [[otra nota]]. Si das "carpeta", debe existir; si no existe devuelve error con las carpetas reales y NO crea nada.',
    inputSchema: { type: 'object', properties: {
      contenido: S('Cuerpo en Markdown.'),
      titulo: S('Título (opcional): se antepone como "# Título" si el contenido no empieza ya por uno).'),
      carpeta: S('Carpeta (nombre, ruta o id). Sin carpeta va a "Notas".'),
      crear_carpeta: B('Solo si el usuario pidió crear la carpeta explícitamente. Por defecto false.'),
      fijada: B('Fijar arriba.') }, required: ['contenido'] },
    run: async (a) => {
      const body = withTitle(a.titulo, a.contenido);
      if (!body.trim()) throw new Error('La nota no puede estar vacía.');
      const fs = await folders();
      let folder = '';
      if (a.carpeta && !isNone(a.carpeta)) folder = (await resolveFolder(fs, a.carpeta, !!a.crear_carpeta)).id;
      const rec = await api('POST', '/api/collections/notes/records', {
        body, folder, pinned: !!a.fijada, device: 'mcp', client_updated: new Date().toISOString() });
      return { creada: shape(rec, await folders(), true) };
    } },
  { name: 'nota_agregar',
    description: 'Añade texto a una nota existente sin tocar el resto: al final (por defecto) o al inicio, justo debajo del título. Para "apunta X en la nota Y" usa esto, no nota_actualizar.',
    inputSchema: { type: 'object', properties: {
      id: S('Id de la nota.'), contenido: S('Markdown a añadir.'),
      donde: S('"final" (def.) o "inicio".', { enum: ['final', 'inicio'] }) }, required: ['id', 'contenido'] },
    run: async (a) => {
      const n = await getNote(a.id);
      if (n.trashed_at) throw new Error('La nota está en la papelera. Restáurala primero (nota_actualizar con papelera=false).');
      const body = appendBody(n.body, a.contenido, a.donde === 'inicio' ? 'inicio' : 'final');
      const d = await api('PATCH', `/api/collections/notes/records/${n.id}`, { body, base_version: n.version, device: 'mcp', client_updated: new Date().toISOString() });
      return withConflict({ actualizada: shape(d, await folders(), true) }, d);
    } },
  { name: 'nota_actualizar',
    description: 'Edita una nota: reemplaza el cuerpo ENTERO ("contenido", Markdown; para añadir sin reescribir usa nota_agregar), la mueve de carpeta, la fija o la manda a la papelera (papelera=true) o la restaura (papelera=false). Solo se toca lo que se pasa. Desde aquí nada se borra de verdad: la papelera se vacía sola a los 30 días.',
    inputSchema: { type: 'object', properties: {
      id: S('Id de la nota.'),
      contenido: S('Cuerpo nuevo completo en Markdown.'),
      carpeta: S('Carpeta destino (nombre, ruta o id); "ninguna" la saca a "Notas".'),
      crear_carpeta: B('Solo si el usuario pidió crear la carpeta explícitamente.'),
      fijada: B('Fijar / desfijar.'),
      papelera: B('true = a la papelera; false = restaurar.') }, required: ['id'] },
    run: async (a) => {
      const n = await getNote(a.id);
      const body = {};
      if (a.contenido !== undefined) {
        const c = String(a.contenido).replace(/\r\n?/g, '\n');
        if (!c.trim()) throw new Error('El contenido no puede quedar vacío. Si quieres deshacerte de la nota, usa papelera=true.');
        body.body = c; body.base_version = n.version;
      }
      if (a.carpeta !== undefined) body.folder = isNone(a.carpeta) ? '' : (await resolveFolder(await folders(), a.carpeta, !!a.crear_carpeta)).id;
      if (a.fijada !== undefined) body.pinned = !!a.fijada;
      if (a.papelera !== undefined) body.trashed_at = a.papelera ? new Date().toISOString() : '';
      if (!Object.keys(body).length) throw new Error('No se pasó nada que cambiar.');
      body.device = 'mcp'; body.client_updated = new Date().toISOString();
      const d = await api('PATCH', `/api/collections/notes/records/${n.id}`, body);
      const key = a.papelera === true ? 'en_papelera' : a.papelera === false ? 'restaurada' : 'actualizada';
      return withConflict({ [key]: shape(d, await folders(), a.contenido !== undefined) }, d);
    } },
  { name: 'notas_recientes',
    description: 'Las últimas notas editadas (las fijadas primero si se pide), con un extracto. Para "qué anoté hoy / esta semana" o para ver qué hay en una carpeta.',
    inputSchema: { type: 'object', properties: {
      limite: I('Máximo (def. 10, máx. 100).'),
      carpeta: S('Solo esta carpeta (nombre, ruta o id); "ninguna" = las sueltas en "Notas".'),
      etiqueta: S('Solo con esta etiqueta.'),
      fijadas_primero: B('Las fijadas arriba, luego el resto por fecha.'),
      incluir_papelera: B('Listar la papelera en vez de las notas activas.') } },
    run: async (a) => {
      const fs = await folders();
      const lim = Math.min(Math.max(a.limite || 10, 1), 100);
      const parts = [a.incluir_papelera ? "trashed_at != ''" : "trashed_at = ''"];
      if (a.carpeta !== undefined && a.carpeta !== '') parts.push(isNone(a.carpeta) ? "folder = ''" : `folder = ${q(pickFolder(fs, a.carpeta).id)}`);
      const sort = (a.fijadas_primero ? '-pinned,' : '') + '-updated';
      const tag = a.etiqueta ? bareTag(a.etiqueta) : '';
      const items = tag
        ? (await listAll('notes', { filter: parts.join(' && '), sort, fields: 'id,title,folder,tags,plain,pinned,trashed_at,updated' })).filter(n => (n.tags || []).some(x => bareTag(x) === tag))
        : (await api('GET', `/api/collections/notes/records?page=1&perPage=${lim}&skipTotal=1&sort=${encodeURIComponent(sort)}&filter=${encodeURIComponent(parts.join(' && '))}&fields=${encodeURIComponent('id,title,folder,tags,plain,pinned,trashed_at,updated')}`)).items || [];
      const out = items.slice(0, lim).map(n => shape(n, fs));
      return { ahora: fmtDate(new Date().toISOString()), zona_horaria: TZ, mostrando: out.length, notas: out };
    } },
  { name: 'carpetas_listar',
    description: 'El árbol de carpetas con cuántas notas tiene cada una, las notas sueltas en "Notas", la papelera y las etiquetas en uso. Úsalo para saber dónde se puede guardar o mover una nota.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [fs, notes] = await Promise.all([folders(), listAll('notes', { fields: 'id,folder,tags,trashed_at,pinned' })]);
      const counts = {}, tags = {};
      let sueltas = 0, papelera = 0, fijadas = 0;
      for (const n of notes) {
        if (n.trashed_at) { papelera++; continue; }
        if (n.pinned) fijadas++;
        if (n.folder) counts[n.folder] = (counts[n.folder] || 0) + 1; else sueltas++;
        for (const t of n.tags || []) tags[t] = (tags[t] || 0) + 1;
      }
      return { carpetas: folderTree(fs, counts), sueltas_en_notas: sueltas, fijadas, papelera,
        etiquetas: Object.entries(tags).sort((x, y) => y[1] - x[1]).map(([nombre, n]) => ({ nombre, notas: n })) };
    } },
];

/* Carpeta: debe existir. Solo se crea con crear_carpeta=true, a propósito. */
async function resolveFolder(fs, name, crear) {
  try { return pickFolder(fs, name); }
  catch (e) {
    if (!crear || /ambigua/.test(e.message)) throw e;
    const rec = await api('POST', '/api/collections/folders/records', { name: String(name).trim() });
    fs.push(rec);
    return rec;
  }
}

/* ─── Protocolo MCP: JSON-RPC 2.0, por stdio o por HTTP ─── */
const INSTRUCTIONS = 'Acceso a las notas de Samuel (app propia estilo Apple Notes, Markdown). Para encontrar algo usa notas_buscar (busca por significado y texto, ya ordenado: no listes todo). Para añadir a una nota usa nota_agregar; nota_actualizar con "contenido" reescribe la nota entera. Las carpetas deben existir (carpetas_listar); nunca se borra nada, como máximo papelera=true.';

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined) return null;                  // notificación: sin respuesta
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      return ok({ protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'notas', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return fail(-32602, 'Herramienta desconocida: ' + params?.name);
      try {
        const out = await tool.run(params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    return fail(-32601, 'Método no soportado: ' + method);
  } catch (e) { return fail(-32603, e.message); }
}

/* Transporte stdio (Claude Desktop / Claude Code en esta máquina): un mensaje por línea. */
function serveStdio() {
  const send = m => process.stdout.write(JSON.stringify(m) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } }); continue; }
      handle(msg).then(r => r && send(r));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

/* Transporte HTTP «Streamable» (conector remoto de Claude web y móvil). Claude
   se conecta desde la nube de Anthropic, así que esto tiene que ser alcanzable
   desde internet; por eso la URL lleva un secreto: /mcp/<MCP_PATH_TOKEN>. Sin
   el token exacto, todo es un 404 mudo. Solo JSON, sin flujo SSE. */
function serveHttp(port, secret) {
  const http = require('http'), crypto = require('crypto');
  const want = Buffer.from('/mcp/' + secret);
  const authed = url => {
    const got = Buffer.from(url.split('?')[0].replace(/\/+$/, ''));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  http.createServer((req, res) => {
    const end = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(body); };
    if (!authed(req.url || '')) return end(404, '');
    if (req.method !== 'POST') return end(405, '');   // sin SSE ni sesiones
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch { return end(400, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } })); }
      const batch = Array.isArray(body);
      const out = (await Promise.all((batch ? body : [body]).map(handle))).filter(Boolean);
      if (!out.length) return end(202, '');
      end(200, JSON.stringify(batch ? out : out[0]));
    });
  }).listen(port, () => console.error(`MCP de notas (HTTP) escuchando en :${port}`));
}

if (require.main === module) {
  if (process.env.MCP_HTTP_PORT) {
    if (!/^[A-Za-z0-9]{24,}$/.test(process.env.MCP_PATH_TOKEN || '')) { console.error('MCP_PATH_TOKEN ausente o demasiado corto (mín. 24 caracteres alfanuméricos).'); process.exit(1); }
    serveHttp(+process.env.MCP_HTTP_PORT, process.env.MCP_PATH_TOKEN);
  } else serveStdio();
}

module.exports = { withTitle, appendBody, excerpt, folderPath, pickFolder, folderTree, fmtDate, handle, TOOLS };
