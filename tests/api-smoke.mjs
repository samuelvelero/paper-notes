// Prueba de humo de la API contra un PocketBase vivo (local o el servidor).
//
//   PB_URL=http://127.0.0.1:8790 PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… node tests/api-smoke.mjs
//
// Crea dos usuarios de prueba (smoke-a@notes.test, smoke-b@notes.test), comprueba
// que el hook pone el dueño y los derivados, que el versionado detecta un
// conflicto, que B no ve nada de A, y al final borra a los dos usuarios (sus
// notas caen en cascada). No toca nada que no haya creado.
const BASE = (process.env.PB_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');
const ADMIN = { identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD };
if (!ADMIN.identity || !ADMIN.password) { console.error('faltan PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(2); }

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✘ ') + msg); if (!cond) fails++; };

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return raw ? { res, json } : { status: res.status, json, headers: res.headers };
}

const admin = (await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: ADMIN })).json.token;
if (!admin) { console.error('no pude autenticar al superusuario en', BASE); process.exit(2); }

// limpieza de una corrida anterior
for (const email of ['smoke-a@notes.test', 'smoke-b@notes.test']) {
  const r = await api(`/api/collections/users/records?filter=${encodeURIComponent(`email="${email}"`)}`, { token: admin });
  for (const u of r.json.items || []) await api(`/api/collections/users/records/${u.id}`, { method: 'DELETE', token: admin });
}

async function mkUser(email) {
  const pw = 'smoke-' + Math.random().toString(36).slice(2) + 'Xx1!';
  const c = await api('/api/collections/users/records', { method: 'POST', token: admin, body: { email, password: pw, passwordConfirm: pw } });
  if (c.status !== 200) throw new Error('no pude crear ' + email + ': ' + JSON.stringify(c.json));
  const a = await api('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email, password: pw } });
  return { id: c.json.id, token: a.json.token };
}

const A = await mkUser('smoke-a@notes.test');
const B = await mkUser('smoke-b@notes.test');
ok(A.token && B.token, 'dos usuarios de prueba autenticados por la colección users');

// 0. sin sesión no se crea nada
const anon = await api('/api/collections/notes/records', { method: 'POST', body: { body: 'x' } });
ok(anon.status === 400 || anon.status === 403, `anónimo no puede crear notas (${anon.status})`);

// 1. crear sin mandar owner: lo pone el hook
const n1 = await api('/api/collections/notes/records', { method: 'POST', token: A.token, body: { body: '# Router de casa #redes\nClave en [[Contraseñas]]', device: 'smoke' } });
ok(n1.status === 200, `A crea una nota sin mandar owner (${n1.status}) ${n1.status !== 200 ? JSON.stringify(n1.json) : ''}`);
ok(n1.json.owner === A.id, 'owner = A (lo puso el servidor)');
ok(n1.json.title === 'Router de casa #redes', `title derivado: "${n1.json.title}"`);
ok(n1.json.plain === 'Router de casa #redes\nClave en Contraseñas', 'plain derivado');
ok(JSON.stringify(n1.json.tags) === '["redes"]', `tags derivados: ${JSON.stringify(n1.json.tags)}`);
ok(JSON.stringify(n1.json.links) === '["Contraseñas"]', `links derivados: ${JSON.stringify(n1.json.links)}`);
ok(n1.json.version === 1, `version inicial = 1 (${n1.json.version})`);

// 2. mandar owner ajeno: lo rechaza la regla
const bad = await api('/api/collections/notes/records', { method: 'POST', token: A.token, body: { body: 'robo', owner: B.id } });
ok(bad.status !== 200 || bad.json.owner === A.id, `owner ajeno no cuela (${bad.status}, owner=${bad.json.owner})`);
if (bad.status === 200 && bad.json.owner === A.id) await api(`/api/collections/notes/records/${bad.json.id}`, { method: 'DELETE', token: A.token });

// 3. los derivados que mande el cliente se ignoran
const n2 = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { body: '# Router de casa\nnuevo cuerpo', title: 'FALSO', tags: ['falso'], base_version: 1 } });
ok(n2.status === 200 && n2.json.title === 'Router de casa' && JSON.stringify(n2.json.tags) === '[]', 'title/tags del cliente se ignoran; se derivan del body');
ok(n2.json.version === 2, `version sube a 2 (${n2.json.version})`);
ok(!n2.headers.get('x-note-conflict'), 'sin conflicto cuando base_version es la actual');

// 4. cambio que no toca el cuerpo no sube la versión
const n3 = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { pinned: true } });
ok(n3.status === 200 && n3.json.pinned === true && n3.json.version === 2, `fijar no crea versión (version=${n3.json.version})`);

// 5. conflicto: edición sobre una versión vieja
const n4 = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { body: 'editado desde otro aparato', base_version: 1 } });
ok(n4.status === 200 && n4.json.version === 3, `gana la que llega, version=3 (${n4.json.version})`);
ok(n4.headers.get('x-note-conflict') === '2', `cabecera X-Note-Conflict: ${n4.headers.get('x-note-conflict')}`);
const vs = await api(`/api/collections/note_versions/records?filter=${encodeURIComponent(`note="${n1.json.id}"`)}`, { token: A.token });
ok(vs.json.totalItems === 1 && vs.json.items[0].reason === 'conflict' && vs.json.items[0].body === '# Router de casa\nnuevo cuerpo', 'la versión perdedora quedó en note_versions');
const vB = await api(`/api/collections/note_versions/records`, { token: B.token });
ok(vB.json.totalItems === 0, 'B no ve las versiones de A');
const vMk = await api('/api/collections/note_versions/records', { method: 'POST', token: A.token, body: { note: n1.json.id, owner: A.id, body: 'x' } });
ok(vMk.status !== 200, `el cliente no crea versiones a mano (${vMk.status})`);

// 6. aislamiento
const listB = await api('/api/collections/notes/records', { token: B.token });
ok(listB.json.totalItems === 0, 'B lista 0 notas');
const getB = await api(`/api/collections/notes/records/${n1.json.id}`, { token: B.token });
ok(getB.status === 404, `B no puede leer la nota de A (${getB.status})`);
const patchB = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: B.token, body: { body: 'pwned' } });
ok(patchB.status === 404, `B no puede editar la nota de A (${patchB.status})`);
const listA = await api('/api/collections/notes/records', { token: A.token });
ok(listA.json.totalItems === 1, 'A lista su nota');

// 7. carpetas anidadas y nota en carpeta
const f1 = await api('/api/collections/folders/records', { method: 'POST', token: A.token, body: { name: 'Casa' } });
const f2 = await api('/api/collections/folders/records', { method: 'POST', token: A.token, body: { name: 'Redes', parent: f1.json.id } });
ok(f1.status === 200 && f2.status === 200 && f2.json.parent === f1.json.id, 'carpeta dentro de carpeta');
const mv = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { folder: f2.json.id } });
ok(mv.status === 200 && mv.json.folder === f2.json.id, 'nota movida a la subcarpeta');
const fB = await api(`/api/collections/folders/records/${f2.json.id}`, { method: 'PATCH', token: B.token, body: { name: 'x' } });
ok(fB.status === 404, `B no toca carpetas de A (${fB.status})`);
const delF = await api(`/api/collections/folders/records/${f1.json.id}`, { method: 'DELETE', token: A.token });
const afterF = await api(`/api/collections/notes/records/${n1.json.id}`, { token: A.token });
ok(delF.status === 204 && afterF.status === 200 && !afterF.json.folder, 'borrar la carpeta padre borra la hija y la nota vuelve a la raíz');

// 7b. compartir por enlace (solo lectura, sin cuenta)
const tok = 'smokeShareToken_' + Math.random().toString(36).slice(2, 12);
const sh0 = await api(`/api/shared/${tok}`);
ok(sh0.status === 404, `token desconocido → 404 (${sh0.status})`);
const shSet = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { share: tok } });
ok(shSet.status === 200 && shSet.json.share === tok && shSet.json.version === afterF.json.version, `A comparte su nota sin subir versión (${shSet.status})`);
const sh1 = await api(`/api/shared/${tok}`);
ok(sh1.status === 200 && sh1.json.body === afterF.json.body && sh1.json.owner === undefined, `anónimo lee la nota compartida y nada más (${sh1.status})`);
const shPage = await fetch(`${BASE}/shared/${tok}`);
ok(shPage.status === 200 && (await shPage.text()).includes('shared.js'), `/shared/<token> sirve la página (${shPage.status})`);
const shBad = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { share: 'con espacios / raros' } });
ok(shBad.status === 400, `token con caracteres raros rechazado (${shBad.status})`);

// 8. papelera y usuarios
const tr = await api(`/api/collections/notes/records/${n1.json.id}`, { method: 'PATCH', token: A.token, body: { trashed_at: new Date().toISOString() } });
ok(tr.status === 200 && tr.json.trashed_at, 'a papelera (trashed_at)');
const sh2 = await api(`/api/shared/${tok}`);
ok(sh2.status === 404, `en la papelera deja de verse compartida (${sh2.status})`);
const uB = await api(`/api/collections/users/records/${A.id}`, { token: B.token });
ok(uB.status === 404, `B no ve el perfil de A (${uB.status})`);
const st = await api(`/api/collections/users/records/${A.id}`, { method: 'PATCH', token: A.token, body: { settings: { autoTitle: false } } });
ok(st.status === 200 && st.json.settings && st.json.settings.autoTitle === false, 'A guarda sus ajustes');
const signup = await api('/api/collections/users/records', { method: 'POST', body: { email: 'intruso@notes.test', password: 'x1234567890', passwordConfirm: 'x1234567890' } });
ok(signup.status !== 200, `el registro público está cerrado (${signup.status})`);

// limpieza: borrar usuarios → cascada
for (const u of [A, B]) await api(`/api/collections/users/records/${u.id}`, { method: 'DELETE', token: admin });
const left = await api(`/api/collections/notes/records?filter=${encodeURIComponent(`owner="${A.id}"`)}`, { token: admin });
ok(left.json.totalItems === 0, 'al borrar el usuario se van sus notas (cascada)');

console.log(fails ? `\n${fails} fallos` : '\ntodo en verde');
process.exit(fails ? 1 : 0);
