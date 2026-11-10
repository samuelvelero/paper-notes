/// <reference path="../pb_data/types.d.ts" />
/* ═══════════════ share · notas de solo lectura por enlace ═══════════════

   Una nota con `share` (token aleatorio) se lee SIN cuenta:

     GET /shared/<token>       → pb_public/shared.html (la pinta en el navegador)
     GET /api/shared/<token>   → { title, body, updated, files: { <id>: url } }

   Aquí se usa $app (sin API Rules) a propósito: la llave es el token, que
   solo conoce quien recibió el enlace. Nunca se devuelve el dueño ni nada
   más de la nota. En la papelera = deja de verse. Las imágenes son archivos
   de `attachments` (campo no protegido): se devuelven sus URLs, solo las que
   el cuerpo referencia y que son del mismo dueño.

   Cada handler corre en su propio runtime: todo va dentro. */

routerAdd('GET', '/shared/{token}', (e) => {
  const html = toString($os.readFile(`${__hooks}/../pb_public/shared.html`));
  e.response.header().set('Cache-Control', 'no-cache');
  e.response.header().set('X-Robots-Tag', 'noindex, nofollow');
  e.response.header().set('Referrer-Policy', 'no-referrer');
  return e.html(200, html);
});

routerAdd('GET', '/api/shared/{token}', (e) => {
  const token = e.request.pathValue('token') || '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundError('Esta nota no existe o ya no se comparte.');
  let note;
  try {
    note = $app.findFirstRecordByFilter('notes', "share = {:t} && trashed_at = ''", { t: token });
  } catch (_) {
    throw new NotFoundError('Esta nota no existe o ya no se comparte.');
  }
  const body = note.getString('body');
  const owner = note.getString('owner');
  const files = {};
  const re = /attachments\/([a-z0-9]{15})/g;
  let m, guard = 0;
  while ((m = re.exec(body)) && guard++ < 300) {
    const id = m[1];
    if (files[id] !== undefined) continue;
    files[id] = '';
    try {
      const a = $app.findRecordById('attachments', id);
      if (a.getString('owner') !== owner || !a.getString('file')) continue;
      files[id] = `/api/files/attachments/${a.id}/${a.getString('file')}`;
    } catch (_) { /* adjunto borrado: la imagen sale rota */ }
  }
  e.response.header().set('Cache-Control', 'no-store');
  e.response.header().set('X-Robots-Tag', 'noindex, nofollow');
  return e.json(200, {
    title: note.getString('title'),
    body,
    updated: note.getString('updated'),
    files,
  });
});
