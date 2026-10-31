/// <reference path="../pb_data/types.d.ts" />
/* ═══════════════ notes → buscador ═══════════════

   Cada vez que una nota se crea, cambia o se borra, se le avisa al servicio
   `buscador` (índice FTS5 + vectores) con los campos que indexa. Es un aviso
   "best effort": si el buscador no contesta, no pasa nada aquí (la nota ya
   está guardada) y su sincronización periódica lo recoge después.

   Corre en los hooks *AfterSuccess*: después de que la transacción se
   confirmó, para no indexar algo que luego se revierta. Los handlers no
   comparten nada entre sí (cada uno corre en su runtime): por eso la
   función se repite dentro de cada uno vía require de search_lib.js. */

onRecordAfterCreateSuccess((e) => {
  require(`${__hooks}/search_lib.js`).notify(e.record, false);
  e.next();
}, 'notes');

onRecordAfterUpdateSuccess((e) => {
  require(`${__hooks}/search_lib.js`).notify(e.record, false);
  e.next();
}, 'notes');

onRecordAfterDeleteSuccess((e) => {
  require(`${__hooks}/search_lib.js`).notify(e.record, true);
  e.next();
}, 'notes');
