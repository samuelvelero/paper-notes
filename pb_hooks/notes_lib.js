/* ═══════════════ notes_lib.js — lo que comparten los handlers ═══════════════

   En PocketBase cada handler de notes.pb.js corre en su propio runtime de
   goja y NO ve las funciones definidas en el nivel superior del archivo. Lo
   compartido vive aquí y cada handler lo carga con
   `require(`${__hooks}/notes_lib.js`)`. */

const SNAPSHOT_EVERY = 20;   // cada cuántas versiones se guarda un snapshot
const TRASH_DAYS = 30;       // días en la papelera antes del borrado real

/* Derivados de `body` con el mismo md.js que usa la web. */
function applyDerived(record) {
  const MD = require(`${__hooks}/../pb_public/js/md.js`);
  const d = MD.derive(record.getString('body'));
  record.set('title', d.title);
  record.set('plain', d.plain);
  record.set('tags', d.tags);
  record.set('links', d.links);
}

/* Guarda en note_versions el estado `orig` (el del servidor antes de este guardado). */
function saveVersion(app, orig, reason) {
  const col = app.findCollectionByNameOrId('note_versions');
  const v = new Record(col);
  v.set('note', orig.id);
  v.set('owner', orig.getString('owner'));
  v.set('body', orig.getString('body'));
  v.set('version', orig.getInt('version'));
  v.set('device', orig.getString('device'));
  v.set('reason', reason);
  app.save(v);
}

/* Cabecera en la respuesta de un hook de registro. En las rutas (`routerAdd`)
   es `e.response`, pero en `onRecord*Request` el evento embebe RequestEvent,
   que a su vez embebe router.Event, y goja no promueve dos niveles: hay que
   bajar por el campo embebido (`e.requestEvent.response`, verificado en
   PocketBase 0.39.6). Las demás rutas quedan por si cambia en una versión. */
function setHeader(e, name, value) {
  const paths = [
    function () { return e.requestEvent.response; },
    function () { return e.response; },
    function () { return e.requestEvent.event.response; },
    function () { return e.event.response; },
  ];
  for (let i = 0; i < paths.length; i++) {
    try {
      const w = paths[i]();
      if (w) { w.header().set(name, value); return i; }
    } catch (_) { /* siguiente */ }
  }
  console.log('[notes] no encontré e.response para la cabecera', name);
  return -1;
}

module.exports = { SNAPSHOT_EVERY, TRASH_DAYS, applyDerived, saveVersion, setHeader };
