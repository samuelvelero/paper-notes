/* ═══════════════ importers/icloud-extract.js — sacar las notas de icloud.com ═══════════════

   Se pega en la consola del navegador con la sesión abierta en
   https://www.icloud.com/notes/ (la app corre dentro de un iframe del mismo
   origen; este script lo busca). No usa el DOM: el cuerpo de cada nota se
   dibuja en un <canvas>, así que no hay texto que leer. Usa el modelo en
   memoria de la app (`NotesApp.dataManager.allNotes`), carga el texto con
   atributos de cada nota (`getTopoText()`) y lo serializa a párrafos y
   tramos con formato. Cada nota se manda por POST a un receptor local
   (`RECEIVER`, un Node de veinte líneas que guarda un JSON por nota); desde
   una página https se puede llamar a 127.0.0.1 sin bloqueo de contenido
   mixto. Luego `importers/icloud.mjs` convierte y sube.

   OJO: la CSP de icloud.com bloquea `connect-src` y `frame-src` hacia
   127.0.0.1, así que el POST al receptor no llega. Lo que funcionó fue
   guardar las notas en memoria (`window.__notas`) y descargarlas en un solo
   JSON con un `<a download>` (como hace `icloud-adjuntos-extract.js`), y
   luego partirlo en un JSON por nota. Las carpetas y el texto de las
   etiquetas inline no están en el modelo de la nota: se sacan aparte
   (`folder.getAllNotes()` y `note.getSearchableContent()`) a un `maps.json`
   junto a la carpeta de notas. Los adjuntos (imágenes, dibujos, enlaces) son
   la segunda pasada: `icloud-adjuntos-extract.js`.

   Progreso en `window.__exp` ({done, total, errors}). */
(async function () {
  const RECEIVER = 'http://127.0.0.1:8795/nota';
  const CONCURRENCY = 3;
  const frame = document.querySelector('iframe');
  const w = frame && frame.contentWindow && frame.contentWindow.NotesApp ? frame.contentWindow : window;
  const N = w.NotesApp;
  if (!N) { console.error('No encuentro NotesApp: ¿estás en icloud.com/notes con la sesión abierta?'); return; }
  const dm = N.dataManager;
  const notes = dm.allNotes.filter(n => !n.Deleted && !n.isInTrashOrDeleted);
  const exp = window.__exp = { done: 0, total: notes.length, errors: [], skipped: [] };

  const folderPath = f => {
    const parts = []; let cur = f, g = 0;
    while (cur && g++ < 20) { if (!(cur.isBuiltIn && /^Notes$/i.test(cur.Title || ''))) parts.unshift(cur.Title || cur.displayTitle || ''); cur = cur.parent || null; }
    return parts.filter(Boolean).join(' / ');
  };
  const iso = ms => (ms ? new Date(+ms).toISOString() : '');
  const plainObj = (v, depth) => {
    if (v == null || typeof v !== 'object') return v == null ? null : (typeof v === 'string' ? v.slice(0, 2000) : v);
    if (depth > 2) return undefined;
    const o = {};
    for (const k of Object.keys(v)) { if (/^(_|isFreed|refCount|uniqueID|dbg_)/.test(k) || typeof v[k] === 'function') continue; const x = plainObj(v[k], depth + 1); if (x !== undefined && x !== null) o[k] = x; }
    return o;
  };
  const inlineSig = a => JSON.stringify([a.fontHints || 0, !!a.underlined, !!a.strikethrough, a.link || '', a.attachmentInfo ? a.attachmentInfo.attachmentIdentifier : '', a.font && a.font.name && /mono|menlo|courier/i.test(a.font.name) ? 1 : 0]);

  function serialize(tt) {
    const paragraphs = [];
    let para = null, run = null;
    const newPara = ps => { para = { style: ps ? ps.style : null, indent: ps ? ps.indent || 0 : 0, done: !!(ps && ps.toDo && ps.toDo.done), quote: !!(ps && ps.blockQuoteLevel), start: ps ? ps.startingListItemNumber : null, runs: [] }; run = null; paragraphs.push(para); };
    tt.forEachWithAttributes((cp, attrs) => {
      const ps = attrs.paragraphStyle || null;
      if (!para) newPara(ps);
      if (cp === 10) { para.style = ps ? ps.style : para.style; para.indent = ps ? ps.indent || 0 : para.indent; para.done = !!(ps && ps.toDo && ps.toDo.done); para.quote = !!(ps && ps.blockQuoteLevel); para = null; return; }
      const sig = inlineSig(attrs);
      if (!run || run.sig !== sig) {
        run = { sig, text: '', bold: (attrs.fontHints & 1) === 1, italic: (attrs.fontHints & 2) === 2, underline: !!attrs.underlined, strike: !!attrs.strikethrough, link: attrs.link ? String(attrs.link.href || attrs.link.url || attrs.link) : '', code: !!(attrs.font && attrs.font.name && /mono|menlo|courier/i.test(attrs.font.name)) };
        if (attrs.attachmentInfo) run.attachment = { id: attrs.attachmentInfo.attachmentIdentifier, uti: attrs.attachmentInfo.typeUTI, cls: attrs.attachmentInfo.systemAttachmentClassName, data: plainObj(attrs.attachmentInfo.systemAttachmentData, 0) };
        para.runs.push(run);
      }
      if (cp !== 65532) run.text += String.fromCodePoint(cp);
    });
    paragraphs.forEach(p => p.runs.forEach(r => { delete r.sig; }));
    return paragraphs;
  }

  let idx = 0;
  async function worker() {
    while (idx < notes.length) {
      const n = notes[idx++];
      try {
        if (n.isLocked) { exp.skipped.push(n.Title); exp.done++; continue; }
        const tt = await n.getTopoText();
        const out = {
          id: n.id, title: n.Title || '', folderPath: folderPath(n.Folder), pinned: !!n.isPinnedByUser,
          created: iso(n.CreationDate), modified: iso(n.ModificationDate), deleted: !!n.Deleted,
          text: tt.toString(), paragraphs: serialize(tt),
          attachments: (typeof n.getOrderedAttachmentInfo === 'function') ? plainObj(n.getOrderedAttachmentInfo(), 0) : null,
        };
        const r = await fetch(RECEIVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
        if (!r.ok) throw new Error('receptor ' + r.status);
      } catch (e) { exp.errors.push({ title: n.Title, error: String(e && e.message || e) }); }
      exp.done++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('listo', exp);
})();
