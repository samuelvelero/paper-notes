/// <reference path="../pb_data/types.d.ts" />
/* Un campo de texto sin `max` explícito vale 5 000 caracteres en PocketBase
   (se vio importando desde iCloud: las notas largas daban
   validation_max_text_constraint). Una nota no tiene por qué caber en 5 000:
   se sube el tope de `notes.body`, `notes.plain` y `note_versions.body` a dos
   millones de caracteres (unos 2 MB de texto). */
migrate((app) => {
  const notes = app.findCollectionByNameOrId('notes');
  notes.fields.getByName('body').max = 2000000;
  notes.fields.getByName('plain').max = 2000000;
  app.save(notes);
  const versions = app.findCollectionByNameOrId('note_versions');
  versions.fields.getByName('body').max = 2000000;
  app.save(versions);
}, (app) => {
  const notes = app.findCollectionByNameOrId('notes');
  notes.fields.getByName('body').max = 0;
  notes.fields.getByName('plain').max = 0;
  app.save(notes);
  const versions = app.findCollectionByNameOrId('note_versions');
  versions.fields.getByName('body').max = 0;
  app.save(versions);
});
