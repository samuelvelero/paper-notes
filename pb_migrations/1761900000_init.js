/// <reference path="../pb_data/types.d.ts" />
/* ═══════════════ Esquema inicial de samukis-notes ═══════════════

   Se aplica solo al arrancar PocketBase (--migrationsDir). Es la fuente de
   verdad del esquema: NO se crean colecciones a mano en el panel.

   Lección del plan multitenant de tareas, aplicada desde el día uno:
   - la app se autentica con la colección `users`, nunca con `_superusers`
     (los superusuarios se saltan TODAS las API Rules);
   - cada colección lleva `owner` y sus reglas exigen `owner = @request.auth.id`.
   Una regla vacía ("") es PÚBLICA; una regla `null` es solo superusuario. */

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');

  // ── users: ajustes de la app y reglas cerradas ─────────────────────
  // settings: { autoTitle: true, theme: 'system', sort: 'updated' … }
  users.fields.add(new JSONField({ name: 'settings', maxSize: 20000 }));
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  users.createRule = null;            // las cuentas las crea el superusuario
  users.updateRule = 'id = @request.auth.id';
  users.deleteRule = null;
  app.save(users);

  const OWN = 'owner = @request.auth.id';
  // La regla de creación se comprueba EN SECO antes de los hooks de petición, así
  // que no puede exigir un `owner` que todavía no está puesto: acepta que no
  // venga (el hook lo pone) o que sea el propio usuario.
  const OWN_CREATE = "@request.auth.id != '' && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)";
  const owner = () => ({
    name: 'owner', type: 'relation', required: true, maxSelect: 1,
    collectionId: users.id, cascadeDelete: true,
  });
  const created = () => ({ name: 'created', type: 'autodate', onCreate: true, onUpdate: false });
  const updated = () => ({ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true });

  // ── folders ────────────────────────────────────────────────────────
  const folders = new Collection({
    type: 'base', name: 'folders',
    listRule: OWN, viewRule: OWN, createRule: OWN_CREATE, updateRule: OWN, deleteRule: OWN,
    fields: [
      owner(),
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'order', type: 'text', max: 64 },   // orden fraccional (cadena), como tareas
      { name: 'icon', type: 'text', max: 40 },
      created(), updated(),
    ],
    indexes: ['CREATE INDEX idx_folders_owner ON folders (owner)'],
  });
  app.save(folders);
  // `parent` apunta a la misma colección: necesita el id, que existe tras el save.
  folders.fields.add(new RelationField({
    name: 'parent', maxSelect: 1, collectionId: folders.id, cascadeDelete: true,
  }));
  app.save(folders);

  // ── tags ───────────────────────────────────────────────────────────
  // La verdad de qué etiquetas tiene una nota es `notes.tags` (derivado del
  // cuerpo). Esta colección solo guarda color y orden.
  const tags = new Collection({
    type: 'base', name: 'tags',
    listRule: OWN, viewRule: OWN, createRule: OWN_CREATE, updateRule: OWN, deleteRule: OWN,
    fields: [
      owner(),
      { name: 'name', type: 'text', required: true, max: 60 },
      { name: 'color', type: 'text', max: 20 },
      { name: 'order', type: 'text', max: 64 },
      created(), updated(),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_tags_owner_name ON tags (owner, name)'],
  });
  app.save(tags);

  // ── notes ──────────────────────────────────────────────────────────
  // `body` es Markdown y es lo único que escribe el cliente. `title`,
  // `plain`, `tags` y `links` los deriva el hook (pb_hooks/notes.pb.js) con
  // pb_public/js/md.js, el mismo archivo que usa la web.
  const notes = new Collection({
    type: 'base', name: 'notes',
    listRule: OWN, viewRule: OWN, createRule: OWN_CREATE, updateRule: OWN, deleteRule: OWN,
    fields: [
      owner(),
      { name: 'folder', type: 'relation', maxSelect: 1, collectionId: folders.id, cascadeDelete: false },
      { name: 'body', type: 'text' },
      { name: 'title', type: 'text', max: 300 },
      { name: 'plain', type: 'text' },
      { name: 'tags', type: 'json', maxSize: 20000 },
      { name: 'links', type: 'json', maxSize: 20000 },
      { name: 'pinned', type: 'bool' },
      { name: 'trashed_at', type: 'date' },
      { name: 'version', type: 'number', onlyInt: true, min: 0 },
      { name: 'client_updated', type: 'date' },
      { name: 'device', type: 'text', max: 80 },
      { name: 'imported_from', type: 'text', max: 200 },  // p. ej. obsidian:<ruta> para reimportar sin duplicar
      created(), updated(),
    ],
    indexes: [
      'CREATE INDEX idx_notes_owner_updated ON notes (owner, updated)',
      'CREATE INDEX idx_notes_owner_folder ON notes (owner, folder)',
      'CREATE INDEX idx_notes_owner_trashed ON notes (owner, trashed_at)',
      'CREATE INDEX idx_notes_imported ON notes (owner, imported_from)',
    ],
  });
  app.save(notes);

  // ── note_versions ──────────────────────────────────────────────────
  // Solo escribe el servidor (hook): la versión perdedora de un conflicto y
  // un snapshot cada N guardados. El cliente lista y puede borrar las suyas.
  const versions = new Collection({
    type: 'base', name: 'note_versions',
    listRule: OWN, viewRule: OWN, createRule: null, updateRule: null, deleteRule: OWN,
    fields: [
      owner(),
      { name: 'note', type: 'relation', required: true, maxSelect: 1, collectionId: notes.id, cascadeDelete: true },
      { name: 'body', type: 'text' },
      { name: 'version', type: 'number', onlyInt: true, min: 0 },
      { name: 'device', type: 'text', max: 80 },
      { name: 'reason', type: 'select', maxSelect: 1, values: ['conflict', 'snapshot', 'manual'] },
      created(),
    ],
    indexes: ['CREATE INDEX idx_versions_note ON note_versions (note, created)'],
  });
  app.save(versions);

  // ── attachments ────────────────────────────────────────────────────
  // Imágenes hoy; `kind = ink` queda reservado para trazos de lápiz.
  const attachments = new Collection({
    type: 'base', name: 'attachments',
    listRule: OWN, viewRule: OWN,
    createRule: OWN_CREATE + ' && note.owner = @request.auth.id',
    updateRule: OWN, deleteRule: OWN,
    fields: [
      owner(),
      { name: 'note', type: 'relation', required: true, maxSelect: 1, collectionId: notes.id, cascadeDelete: true },
      {
        name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 26214400,
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/svg+xml'],
        thumbs: ['200x200', '800x0'],
      },
      { name: 'kind', type: 'select', maxSelect: 1, values: ['image', 'ink'] },
      { name: 'width', type: 'number', onlyInt: true, min: 0 },
      { name: 'height', type: 'number', onlyInt: true, min: 0 },
      created(), updated(),
    ],
    indexes: ['CREATE INDEX idx_attachments_note ON attachments (note)'],
  });
  app.save(attachments);
}, (app) => {
  // Deshacer: primero lo que referencia, luego lo referenciado.
  for (const name of ['attachments', 'note_versions', 'notes', 'tags', 'folders']) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('settings');
  users.listRule = null; users.viewRule = null; users.createRule = ''; users.updateRule = null; users.deleteRule = null;
  app.save(users);
});
