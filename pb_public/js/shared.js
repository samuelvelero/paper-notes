/* ═══════════════ shared.js — una nota compartida, de solo lectura ═══════════════
   Lo único que carga /shared/<token> además de mdpm.js. Pide la nota a
   /api/shared/<token> y pinta el documento de MDPM.parse como HTML estático
   con las mismas clases que el editor (.ed), sin ProseMirror. */
'use strict';
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = (location.pathname.match(/\/shared\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const $note = document.getElementById('sh-note');
  let files = {};

  const TAG_RE = /(^|[\s(\[])#([A-Za-z_À-ɏ][\w\-\/À-ɏ]{0,59})/g;
  const LINK_RE = /\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/g;
  /* #etiqueta y [[enlace]] se pintan como en el editor, pero sin acción: las
     otras notas no son públicas. */
  const decorate = t => esc(t)
    .replace(LINK_RE, (_, a, b) => `<span class="ed-wikilink sh-nolink">${b || a}</span>`)
    .replace(TAG_RE, (_, pre, tag) => `${pre}<span class="ed-tag">#${tag}</span>`);
  const safeHref = h => (/^(https?:|mailto:|tel:)/i.test(h) ? h : '#');

  function inline(nodes) {
    return (nodes || []).map(n => {
      if (n.type === 'hard_break') return '<br>';
      const marks = n.marks || [];
      const isCode = marks.some(m => m.type === 'code');
      let h = isCode ? esc(n.text) : decorate(n.text);
      for (const m of marks) {
        if (m.type === 'strong') h = `<strong>${h}</strong>`;
        else if (m.type === 'em') h = `<em>${h}</em>`;
        else if (m.type === 'underline') h = `<u>${h}</u>`;
        else if (m.type === 'strike') h = `<s>${h}</s>`;
        else if (m.type === 'code') h = `<code>${h}</code>`;
        else if (m.type === 'link') h = `<a href="${esc(safeHref(m.attrs.href))}" target="_blank" rel="noopener noreferrer">${h}</a>`;
      }
      return h;
    }).join('');
  }
  function imgSrc(src) {
    const m = /^attachments\/([a-z0-9]{15})$/.exec(src || '');
    if (m) return files[m[1]] ? files[m[1]] + '?thumb=800x0' : '';
    return /^https?:/i.test(src || '') ? src : '';
  }
  function block(n) {
    const kids = () => (n.content || []).map(block).join('');
    switch (n.type) {
      case 'paragraph': return `<p>${inline(n.content) || '<br>'}</p>`;
      case 'heading': return `<h${n.attrs.level}>${inline(n.content)}</h${n.attrs.level}>`;
      case 'blockquote': return `<blockquote>${kids()}</blockquote>`;
      case 'code_block': return `<pre><code>${esc((n.content || []).map(t => t.text).join(''))}</code></pre>`;
      case 'horizontal_rule': return '<hr>';
      case 'image': { const s = imgSrc(n.attrs.src); return `<figure class="ed-img${s ? '' : ' broken'}">${s ? `<img src="${esc(s)}" alt="${esc(n.attrs.alt)}" loading="lazy">` : ''}</figure>`; }
      case 'bullet_list': return `<ul>${kids()}</ul>`;
      case 'ordered_list': return `<ol${n.attrs && n.attrs.order > 1 ? ` start="${n.attrs.order}"` : ''}>${kids()}</ol>`;
      case 'todo_list': return `<ul data-todo="1">${kids()}</ul>`;
      case 'list_item': return `<li>${kids()}</li>`;
      case 'todo_item': {
        const on = n.attrs && n.attrs.checked;
        return `<li class="todo${on ? ' done' : ''}"><span class="todo-box">${on ? '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}</span><div class="todo-body">${kids()}</div></li>`;
      }
      default: return '';
    }
  }
  const niceDate = iso => {
    const d = new Date(String(iso || '').replace(' ', 'T'));
    return isNaN(d) ? '' : d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  async function load() {
    if (!token) return fail();
    try {
      const r = await fetch(`/api/shared/${token}`, { cache: 'no-store' });
      if (!r.ok) return fail();
      const d = await r.json();
      files = d.files || {};
      const doc = MDPM.parse(d.body || '');
      $note.innerHTML = (doc.content || []).map(block).join('');
      document.title = (d.title ? d.title + ' · ' : '') + 'Paper Notes';
      document.getElementById('sh-date').textContent = d.updated ? 'Actualizada el ' + niceDate(d.updated) : '';
    } catch (_) { fail('No se pudo cargar la nota. Revisa tu conexión.'); }
  }
  function fail(msg) {
    $note.innerHTML = `<p class="sh-gone">${esc(msg || 'Esta nota no existe o ya no se comparte.')}</p>`;
    document.title = 'Nota no disponible · Paper Notes';
  }
  load();
})();
