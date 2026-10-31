// Prueba de humo del MCP contra un servidor vivo (PocketBase + buscador):
//
//   PB_URL=http://127.0.0.1:8093 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/mcp-smoke.mjs
//
// Crea un usuario ficticio, arranca mcp/server.js por stdio con esa cuenta y
// recorre las siete herramientas: crear, carpetas, buscar (semántica), leer,
// agregar, actualizar (mover, fijar, papelera, restaurar), recientes. Al
// final borra el usuario (y sus notas con él).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = (process.env.PB_URL || 'http://127.0.0.1:8093').replace(/\/$/, '');
const ADMIN = { identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD };
if (!ADMIN.identity || !ADMIN.password) { console.error('faltan PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(2); }

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = (await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: ADMIN })).json.token;
if (!admin) { console.error('no pude autenticar al superusuario en', BASE); process.exit(2); }

const EMAIL = 'smoke-mcp@notes.test';
for (const u of (await api(`/api/collections/users/records?filter=${encodeURIComponent(`email="${EMAIL}"`)}`, { token: admin })).json.items || [])
  await api(`/api/collections/users/records/${u.id}`, { method: 'DELETE', token: admin });
const pw = 'smoke-' + Math.random().toString(36).slice(2) + 'Xx1!';
const user = (await api('/api/collections/users/records', { method: 'POST', token: admin, body: { email: EMAIL, password: pw, passwordConfirm: pw } })).json;
if (!user.id) { console.error('no pude crear el usuario de prueba', user); process.exit(2); }

/* El servidor MCP, por stdio, con la cuenta ficticia. */
const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(here, '..', 'mcp', 'server.js')], {
  env: { ...process.env, NOTAS_URL: BASE, NOTAS_EMAIL: EMAIL, NOTAS_PASSWORD: pw, NOTAS_TZ: 'America/Lima' }, stdio: ['pipe', 'pipe', 'inherit'] });
let seq = 0; const pending = new Map(); let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; const m = JSON.parse(l); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } } });
const rpc = (method, params) => new Promise(r => { const id = ++seq; pending.set(id, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
async function call(name, args) {
  const m = await rpc('tools/call', { name, arguments: args || {} });
  const text = m.result?.content?.[0]?.text ?? JSON.stringify(m.error);
  if (m.result?.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  ok(init.result?.serverInfo?.name === 'notas', 'initialize');
  ok((await rpc('tools/list')).result.tools.length === 7, 'tools/list: 7 herramientas');

  /* carpetas: no existe → error sin crear; crear_carpeta → se crea */
  let r = await call('nota_crear', { contenido: '# Prueba\nhola', carpeta: 'Viajes' });
  ok(r.error && /No existe la carpeta/.test(r.error), `carpeta inexistente: error sin crear (${(r.error || '').slice(0, 60)}…)`);
  r = await call('nota_crear', { titulo: 'Lista para el viaje a Cusco', contenido: '- [ ] pasaporte\n- [ ] cargador\n- [ ] equipaje de mano #viaje', carpeta: 'Viajes', crear_carpeta: true });
  ok(r.creada && r.creada.carpeta === 'Viajes' && r.creada.titulo === 'Lista para el viaje a Cusco', `nota_crear con título aparte y carpeta nueva (${r.creada && r.creada.id})`);
  const viaje = r.creada.id;
  ok(r.creada.etiquetas?.includes('viaje') && r.creada.contenido.startsWith('# Lista para el viaje'), 'derivados del servidor: etiquetas y "# Título" delante');
  r = await call('nota_crear', { contenido: '# Router de casa #redes\nLa clave del wifi está pegada debajo del aparato.', fijada: true });
  const router = r.creada.id;
  ok(r.creada.fijada === true && !r.creada.carpeta, 'nota_crear fijada en "Notas"');
  r = await call('nota_crear', { contenido: '# Receta de lentejas\nRemojar la noche anterior. Cocer 40 minutos.' });
  const lentejas = r.creada.id;
  r = await call('nota_crear', { contenido: '   ' });
  ok(r.error && /vacía/.test(r.error), 'nota vacía: error');

  r = await call('carpetas_listar');
  ok(r.carpetas?.length === 1 && r.carpetas[0].nombre === 'Viajes' && r.carpetas[0].notas === 1 && r.sueltas_en_notas === 2 && r.fijadas === 1, `carpetas_listar: árbol y conteos (${JSON.stringify(r.carpetas)})`);
  ok(r.etiquetas?.some(e => e.nombre === 'viaje') && r.etiquetas?.some(e => e.nombre === 'redes'), 'carpetas_listar: etiquetas en uso');

  /* buscar: espera a que el hook indexe */
  let hit = null;
  for (let i = 0; i < 30 && !hit; i++) { r = await call('notas_buscar', { q: 'lentejas' }); hit = (r.notas || []).find(n => n.id === lentejas); if (!hit) await sleep(1000); }
  ok(hit, 'notas_buscar: el índice recibió las notas nuevas');
  r = await call('notas_buscar', { q: 'contraseña del wifi' });
  ok(r.notas?.[0]?.id === router && !r.aviso, `notas_buscar semántica: "contraseña del wifi" → router (${(r.notas || []).map(n => n.titulo).join(' | ')}; ${r.ms} ms)`);
  r = await call('notas_buscar', { q: 'reunon lentejs', solo_lexico: true });
  ok(r.notas?.[0]?.id === lentejas, `notas_buscar léxica con error tipográfico: "lentejs" → lentejas`);
  r = await call('notas_buscar', { q: 'cargador', carpeta: 'viajes' });
  ok(r.total === 1 && r.notas[0].id === viaje && r.notas[0].carpeta === 'Viajes', 'notas_buscar con carpeta por nombre');
  r = await call('notas_buscar', { q: 'cargador', etiqueta: '#redes' });
  ok(r.total === 0, 'notas_buscar con etiqueta que no está: nada');
  r = await call('notas_buscar', { q: 'radiografía dentista' });
  ok(r.total === 0 || !r.notas.some(n => n.fragmento && /<mark>/.test(n.fragmento)), 'fragmentos sin <mark> (la UI de resaltado va aparte)');

  /* leer */
  r = await call('nota_leer', { id: router });
  ok(r.contenido?.startsWith('# Router de casa') && r.version === 1 && r.etiquetas?.includes('redes') && r.creada && r.actualizada, 'nota_leer por id: Markdown y metadatos');
  r = await call('nota_leer', { titulo: 'receta de LENTEJAS' });
  ok(r.id === lentejas, 'nota_leer por título (sin mayúsculas)');
  r = await call('nota_leer', { titulo: 'no existe esto' });
  ok(r.error && /ninguna nota/.test(r.error), 'nota_leer título inexistente: error');
  r = await call('nota_leer', { id: 'xxxxxxxxxxxxxxx' });
  ok(r.error && /No existe esa nota/.test(r.error), 'nota_leer id ajeno o inexistente: error');

  /* agregar */
  r = await call('nota_agregar', { id: lentejas, contenido: 'Servir con arroz.' });
  ok(r.actualizada?.contenido === '# Receta de lentejas\nRemojar la noche anterior. Cocer 40 minutos.\n\nServir con arroz.' && r.actualizada.version === 2 && !r.aviso, 'nota_agregar al final sube la versión');
  r = await call('nota_agregar', { id: lentejas, contenido: 'Para 4 personas.', donde: 'inicio' });
  ok(r.actualizada?.contenido.startsWith('# Receta de lentejas\n\nPara 4 personas.\n\nRemojar') && r.actualizada.version === 3, 'nota_agregar al inicio, debajo del título');

  /* actualizar: mover, fijar, reemplazar, papelera, restaurar */
  r = await call('nota_actualizar', { id: lentejas, carpeta: 'Via', fijada: true });
  ok(r.actualizada?.carpeta === 'Viajes' && r.actualizada.fijada === true && r.actualizada.contenido === undefined, 'nota_actualizar: mover por prefijo y fijar (sin cuerpo en la respuesta)');
  r = await call('nota_leer', { id: lentejas });
  ok(r.version === 3, 'mover y fijar no suben la versión');
  r = await call('nota_actualizar', { id: lentejas, contenido: '# Receta de garbanzos\nRemojar y cocer.', carpeta: 'ninguna' });
  ok(r.actualizada?.titulo === 'Receta de garbanzos' && !r.actualizada.carpeta && r.actualizada.version === 4, 'nota_actualizar: cuerpo entero y fuera de la carpeta');
  r = await call('nota_actualizar', { id: lentejas, contenido: '' });
  ok(r.error && /vacío/.test(r.error), 'nota_actualizar con contenido vacío: error');
  r = await call('nota_actualizar', { id: lentejas });
  ok(r.error && /nada que cambiar/.test(r.error), 'nota_actualizar sin cambios: error');
  r = await call('nota_actualizar', { id: viaje, papelera: true });
  ok(r.en_papelera?.en_papelera === true, 'nota_actualizar papelera=true');
  r = await call('nota_agregar', { id: viaje, contenido: 'x' });
  ok(r.error && /papelera/.test(r.error), 'nota_agregar a una nota en la papelera: error');
  r = await call('notas_recientes', {});
  ok(!r.notas.some(n => n.id === viaje) && r.notas.length === 2, 'notas_recientes no lista la papelera');
  r = await call('notas_recientes', { incluir_papelera: true });
  ok(r.notas.length === 1 && r.notas[0].id === viaje, 'notas_recientes incluir_papelera');
  r = await call('nota_actualizar', { id: viaje, papelera: false });
  ok(r.restaurada && !r.restaurada.en_papelera, 'nota_actualizar papelera=false restaura');

  /* recientes */
  r = await call('notas_recientes', { limite: 1 });
  ok(r.notas.length === 1 && r.notas[0].id === viaje && r.ahora && r.zona_horaria === 'America/Lima', 'notas_recientes: la última editada primero, con límite');
  r = await call('notas_recientes', { fijadas_primero: true });
  ok(r.notas[0].fijada === true && r.notas.every(n => n.extracto !== undefined || n.titulo), 'notas_recientes fijadas primero, con extracto');
  r = await call('notas_recientes', { carpeta: 'ninguna' });
  ok(r.notas.every(n => !n.carpeta) && r.notas.length === 2, 'notas_recientes carpeta="ninguna": las sueltas');
  r = await call('notas_recientes', { etiqueta: 'viaje' });
  ok(r.notas.length === 1 && r.notas[0].id === viaje, 'notas_recientes por etiqueta');

  /* conflicto: alguien guarda entre la lectura y la escritura del MCP */
  const tok = (await api('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: EMAIL, password: pw } })).json.token;
  await api(`/api/collections/notes/records/${router}`, { method: 'PATCH', token: tok, body: { body: '# Router de casa #redes\nCambiado desde el teléfono.', base_version: 1 } });
  await api(`/api/collections/notes/records/${router}`, { method: 'PATCH', token: tok, body: { body: '# Router de casa #redes\nY otra vez.', base_version: 2 } });
  /* el MCP lee v3 y escribe con base 3: sin conflicto; simulamos uno mandando base vieja a mano */
  const old = await api(`/api/collections/notes/records/${router}`, { method: 'PATCH', token: tok, body: { body: '# Router de casa #redes\nDesde una copia vieja.', base_version: 1 } });
  ok(old.status === 200, 'el hook de conflicto sigue vivo (base_version vieja no falla, guarda historial)');

  /* aislamiento: el MCP no ve notas de otro usuario */
  const notesAdmin = (await api(`/api/collections/notes/records?filter=${encodeURIComponent(`owner="${user.id}"`)}`, { token: admin })).json;
  ok(notesAdmin.totalItems === 3, `el usuario de prueba tiene exactamente sus 3 notas (${notesAdmin.totalItems})`);
} finally {
  child.stdin.end();
  await api(`/api/collections/users/records/${user.id}`, { method: 'DELETE', token: admin });
}
console.log(fails ? `\n${fails} fallos` : '\ntodo en verde');
process.exit(fails ? 1 : 0);
