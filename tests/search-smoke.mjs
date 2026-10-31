// Prueba de humo del buscador contra un servidor vivo (PocketBase + buscador
// detrás de Caddy):
//
//   PB_URL=http://127.0.0.1:8093 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/search-smoke.mjs
//
// Crea un usuario ficticio con cinco notas, espera a que el hook las indexe y
// comprueba prefijos, tildes, errores tipográficos, semántica, filtros y el
// aislamiento por usuario. Al final borra el usuario (y sus notas con él).
const BASE = (process.env.PB_URL || 'http://127.0.0.1:8093').replace(/\/$/, '');
const ADMIN = { identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD };
if (!ADMIN.identity || !ADMIN.password) { console.error('faltan PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(2); }

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const admin = (await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: ADMIN })).json.token;
if (!admin) { console.error('no pude autenticar al superusuario en', BASE); process.exit(2); }

const health = (await api('/search/health')).json;
ok(health.ok && health.ready, `buscador listo (modelo ${health.model}, ${health.notes} notas indexadas)`);
if (!health.ready) { console.log('el buscador aún carga el modelo; reintenta en un rato'); process.exit(1); }

for (const email of ['smoke-s@notes.test', 'smoke-t@notes.test']) {
  const r = await api(`/api/collections/users/records?filter=${encodeURIComponent(`email="${email}"`)}`, { token: admin });
  for (const u of r.json.items || []) await api(`/api/collections/users/records/${u.id}`, { method: 'DELETE', token: admin });
}
async function mkUser(email) {
  const pw = 'smoke-' + Math.random().toString(36).slice(2) + 'Xx1!';
  const c = await api('/api/collections/users/records', { method: 'POST', token: admin, body: { email, password: pw, passwordConfirm: pw } });
  const a = await api('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email, password: pw } });
  return { id: c.json.id, token: a.json.token };
}
const S = await mkUser('smoke-s@notes.test');
const T = await mkUser('smoke-t@notes.test');

const folder = (await api('/api/collections/folders/records', { method: 'POST', token: S.token, body: { name: 'Viajes' } })).json;
const NOTES = [
  { body: '# Reunión con el dentista\nEl martes a las 10 en la clínica de Miraflores. Llevar la radiografía.' },
  { body: '# Lista para el viaje a Cusco #viaje\n- [ ] pasaporte\n- [ ] cargador\n- [ ] equipaje de mano\n- [ ] bloqueador', folder: folder.id },
  { body: '# Router de casa #redes\nLa clave del wifi está pegada debajo del aparato. Usuario admin.' },
  { body: '# Receta de lentejas\nRemojar la noche anterior. Sofreír cebolla, ajo y zanahoria. Cocer 40 minutos.' },
  { body: '# Nota vieja\nEsto ya no sirve.', trashed_at: new Date().toISOString() },
];
const ids = [];
for (const n of NOTES) {
  const r = await api('/api/collections/notes/records', { method: 'POST', token: S.token, body: { ...n, device: 'smoke' } });
  if (r.status !== 200) { console.error('no pude crear nota', r.json); process.exit(1); }
  ids.push(r.json.id);
}
const [dentista, viaje, router, lentejas, vieja] = ids;
await api('/api/collections/notes/records', { method: 'POST', token: T.token, body: { body: '# Dentista de T\nOtra persona, otro dentista.' } });

async function search(q, extra = '', token = S.token) {
  const r = await api(`/search?q=${encodeURIComponent(q)}${extra}`, { token });
  return r.json.results || [];
}
// el hook indexa en el momento; se espera a que las cinco estén
let indexed = false;
for (let i = 0; i < 30 && !indexed; i++) {
  const r = await search('lentejas');
  indexed = r.some((x) => x.id === lentejas);
  if (!indexed) await sleep(1000);
}
ok(indexed, 'el hook indexó las notas nuevas');

const first = (rs) => (rs[0] || {}).id;
let r;
r = await search('dentis');            ok(first(r) === dentista, `prefijo: "dentis" → dentista (${r.map((x) => x.title).join(' | ')})`);
r = await search('REUNION');           ok(first(r) === dentista, 'sin tildes ni mayúsculas: "REUNION" → Reunión');
r = await search('reunon');            ok(first(r) === dentista, `error tipográfico: "reunon" → Reunión (${r.map((x) => x.title).join(' | ')})`);
r = await search('lentejs');           ok(first(r) === lentejas, 'error tipográfico: "lentejs" → lentejas');
r = await search('cosas que llevar al viaje'); ok(r.some((x) => x.id === viaje) && first(r) === viaje, `semántica+léxica: "cosas que llevar al viaje" → viaje (${r.map((x) => x.title).join(' | ')})`);
r = await search('contraseña del wifi'); ok(first(r) === router, `semántica: "contraseña del wifi" → router (${r.map((x) => x.title).join(' | ')})`);
r = await search('radiografía');       ok(first(r) === dentista && /<mark>radiograf/i.test(r[0].fragment_html || ''), `fragmento resaltado: ${r[0] && r[0].fragment_html}`);
r = await search('cocer 40 minutos');  ok(first(r) === lentejas && !/<mark>/.test(r[0].fragment), 'fragment sin marcas, fragment_html con marcas');
r = await search('pasaporte', `&folder=${folder.id}`); ok(r.length === 1 && r[0].id === viaje, 'filtro por carpeta');
r = await search('pasaporte', '&folder=xxxxxxxxxxxxxxx'); ok(r.length === 0, 'filtro por carpeta ajena: nada');
r = await search('cargador', '&tag=viaje'); ok(first(r) === viaje && r[0].tags.includes('viaje'), 'filtro por etiqueta');
r = await search('cargador', '&tag=%23redes'); ok(r.length === 0, 'etiqueta que no está: nada');
r = await search('sirve');             ok(r.length === 0, 'la papelera no sale por defecto');
r = await search('sirve', '&trashed=1'); ok(first(r) === vieja, 'con trashed=1 sí sale');
r = await search('dentista', '', T.token); ok(r.length === 1 && r[0].id !== dentista, 'T solo ve su dentista, no el de S');
const anon = await api('/search?q=dentista');
ok(anon.status === 401, `sin token: 401 (${anon.status})`);
const lex = await search('cargador', '&semantic=0'); ok(first(lex) === viaje, 'semantic=0 sigue encontrando por léxico');

// edición: cambia el cuerpo y la búsqueda lo refleja
await api(`/api/collections/notes/records/${lentejas}`, { method: 'PATCH', token: S.token, body: { body: '# Receta de garbanzos\nRemojar y cocer.', base_version: 1 } });
let moved = false;
for (let i = 0; i < 20 && !moved; i++) { r = await search('garbanzos'); moved = first(r) === lentejas; if (!moved) await sleep(1000); }
ok(moved, 'editar la nota actualiza el índice');
r = await search('lentejas'); ok(!r.some((x) => x.id === lentejas && /lentejas/i.test(x.title)), 'el título viejo ya no está');

// borrar usuario → cascada → el hook de borrado saca las notas del índice
for (const u of [S, T]) await api(`/api/collections/users/records/${u.id}`, { method: 'DELETE', token: admin });
const h2 = (await api('/search/health')).json;
ok(h2.notes <= health.notes, `tras borrar, el índice no creció (${health.notes} → ${h2.notes})`);

console.log(fails ? `\n${fails} fallos` : '\ntodo en verde');
process.exit(fails ? 1 : 0);
