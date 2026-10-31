/// <reference path="../pb_data/types.d.ts" />
/* ═══════════════ notes · dueño, derivados, versiones, papelera ═══════════════

   Corre DENTRO de PocketBase (goja). Cada handler corre en un runtime
   aparte y NO ve nada definido fuera de él: por eso cada uno hace su propio
   `require` de notes_lib.js (lección de tareas).

   Dos capas de hooks, a propósito:

   - Hooks de PETICIÓN (`onRecord*Request`): saben quién pide (`e.auth`) y qué
     mandó (`e.requestInfo().body`). PocketBase comprueba la regla de creación
     EN SECO antes de llamarlos, por eso la regla no puede exigir un `owner`
     que todavía no está puesto (ver pb_migrations).
   - Hooks de MODELO (`onRecordCreate` / `onRecordUpdate`): corren al guardar,
     con el registro ya cargado con todo lo que mandó el cliente. Aquí se
     calculan los derivados y la versión, así lo que mande el cliente en esos
     campos no cuenta, venga por la API, por el MCP o por un script.

   1. `owner`: lo pone el servidor con el usuario autenticado, en TODAS las
      colecciones con dueño. Si el cliente manda el de otro, la API Rule lo
      rechaza antes.
   2. Derivados de `notes` (`title`, `plain`, `tags`, `links`): salen SIEMPRE
      del `body` con pb_public/js/md.js, el mismo archivo que usa la web.
   3. Versiones: cada cambio de `body` sube `version`. El cliente manda en el
      cuerpo `base_version` (la versión sobre la que editó). Si es menor que
      la del servidor hubo edición cruzada: gana la que llega (última
      escritura real) y la que estaba se guarda en `note_versions` con
      reason=conflict; la respuesta avisa con `X-Note-Conflict: <versión>`.
      Cada SNAPSHOT_EVERY versiones se guarda además un snapshot.
   4. Papelera: un cron borra de verdad lo que lleva más de TRASH_DAYS días
      con `trashed_at`. Versiones y adjuntos caen en cascada. */

/* ── 1. owner (petición) ──────────────────────────────────────────── */
onRecordCreateRequest((e) => {
  if (e.auth && !e.hasSuperuserAuth()) e.record.set('owner', e.auth.id);
  e.next();
}, 'notes', 'folders', 'tags', 'attachments');

/* ── 3. conflicto (petición: necesita base_version) ───────────────── */
onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/notes_lib.js`);
  const info = e.requestInfo();
  const data = (info && info.body) || {};
  if (typeof data.body === 'string') {
    const orig = e.record.original();
    const cur = orig.getInt('version');
    const base = data.base_version == null ? cur : parseInt(data.base_version, 10);
    if (data.body !== orig.getString('body') && !isNaN(base) && base < cur) {
      lib.saveVersion(e.app, orig, 'conflict');
      lib.setHeader(e, 'X-Note-Conflict', String(cur));
    }
  }
  e.next();
}, 'notes');

/* ── 2 y 3. derivados y versión (modelo) ──────────────────────────── */
onRecordCreate((e) => {
  const lib = require(`${__hooks}/notes_lib.js`);
  lib.applyDerived(e.record);
  e.record.set('version', 1);
  e.next();
}, 'notes');

onRecordUpdate((e) => {
  const lib = require(`${__hooks}/notes_lib.js`);
  const orig = e.record.original();
  const cur = orig.getInt('version');
  if (e.record.getString('body') !== orig.getString('body')) {
    lib.applyDerived(e.record);
    const next = cur + 1;
    if (next % lib.SNAPSHOT_EVERY === 0) {
      try { lib.saveVersion(e.app, orig, 'snapshot'); } catch (err) { console.log('[notes] snapshot falló', orig.id, err); }
    }
    e.record.set('version', next);
  } else {
    e.record.set('version', cur);   // mover, fijar, papelera: no es una versión nueva
  }
  e.next();
}, 'notes');

/* ── 4. papelera ──────────────────────────────────────────────────── */
cronAdd('papelera', '0 4 * * *', () => {
  const lib = require(`${__hooks}/notes_lib.js`);
  const lim = new Date(Date.now() - lib.TRASH_DAYS * 864e5).toISOString().replace('T', ' ');
  let rows;
  try {
    rows = $app.findRecordsByFilter('notes', "trashed_at != '' && trashed_at < {:lim}", '', 500, 0, { lim: lim });
  } catch (err) {
    console.log('[papelera] no pude listar', err);
    return;
  }
  rows.forEach((r) => {
    try { $app.delete(r); } catch (err) { console.log('[papelera] no pude borrar', r.id, err); }
  });
  if (rows.length) console.log('[papelera] borradas', rows.length, 'notas de hace más de', lib.TRASH_DAYS, 'días');
});
