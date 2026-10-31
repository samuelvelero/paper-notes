/* ═══════════════ search_lib.js — el aviso al buscador ═══════════════ */

/* POST al buscador con lo que indexa de la nota. Nunca lanza: un fallo se
   registra y ya (el sync periódico del buscador lo recupera). */
function notify(record, deleted) {
  const base = $os.getenv('BUSCADOR_URL');
  const token = $os.getenv('INDEX_TOKEN');
  if (!base || !token) return;
  let body;
  if (deleted) {
    body = { id: record.id, deleted: true };
  } else {
    let tags = [];
    try { tags = JSON.parse(record.getString('tags') || '[]'); } catch (_) { tags = []; }
    body = {
      id: record.id,
      owner: record.getString('owner'),
      folder: record.getString('folder'),
      title: record.getString('title'),
      plain: record.getString('plain'),
      tags: tags,
      trashed_at: record.getString('trashed_at'),
      updated: record.getString('updated'),
    };
  }
  try {
    const res = $http.send({
      url: base.replace(/\/$/, '') + '/search/index',
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Index-Token': token },
      timeout: 8,
    });
    if (res.statusCode >= 300) console.log('[buscador] respondió', res.statusCode, 'para', record.id);
  } catch (err) {
    console.log('[buscador] no pude avisar de', record.id, String(err));
  }
}

module.exports = { notify: notify };
