/// <reference path="../pb_data/types.d.ts" />
/* ═══════════════ Notas compartidas (solo lectura, por enlace) ═══════════════

   `notes.share` es un token aleatorio (≥ 128 bits, base64url) que pone el
   cliente al pulsar «Compartir enlace». Con token, la nota se lee sin cuenta
   en /shared/<token> (pb_hooks/share.pb.js); vacío = no compartida. Cambiarlo
   no toca `body`, así que no sube `version`. Índice único solo sobre los
   no vacíos. */
migrate((app) => {
  const notes = app.findCollectionByNameOrId('notes');
  notes.fields.add(new TextField({ name: 'share', max: 64, pattern: '^[A-Za-z0-9_-]*$' }));
  notes.addIndex('idx_notes_share', true, 'share', "share != ''");
  app.save(notes);
}, (app) => {
  const notes = app.findCollectionByNameOrId('notes');
  notes.removeIndex('idx_notes_share');
  notes.fields.removeByName('share');
  app.save(notes);
});
