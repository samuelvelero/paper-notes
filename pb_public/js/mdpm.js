/* ═══════════════ mdpm.js — Markdown ↔ documento ProseMirror ═══════════════

   El cuerpo de una nota se GUARDA en Markdown (el contrato con el servidor,
   el MCP y Android) pero se EDITA como documento ProseMirror. Este archivo es
   la traducción en los dos sentidos, para exactamente nuestro dialecto
   (CLAUDE.md → «Dialecto Markdown»), sin markdown-it ni prosemirror-markdown:
   el dialecto es pequeño y controlamos las dos puntas, así que un parser
   propio línea a línea es más corto, más predecible y se prueba en Node sin
   navegador (tests/mdpm.test.js carga prosemirror.js en un vm y hace el viaje
   de ida y vuelta con el esquema real).

     MDPM.schemaSpec          → { nodes, marks } para new PM.model.Schema
     MDPM.parse(markdown)     → JSON de doc (schema.nodeFromJSON lo valida)
     MDPM.serialize(docJSON)  → markdown

   Reglas del viaje de ida y vuelta:
   - Párrafos separados por línea en blanco; un salto SIMPLE dentro de un
     párrafo es un `hard_break` (Shift+Enter) y vuelve como "\n".
   - Listas: `- `, `1. `, `- [ ] ` / `- [x] `. Lo anidado va con 2 espacios
     (3 en numeradas). Un elemento puede tener varios bloques.
   - `#etiqueta` y `[[enlace]]` se quedan como TEXTO: los pinta el editor con
     decoraciones y los deriva el servidor (md.js). Aquí no son nodos.
   - Un párrafo que empezaría por sintaxis de bloque (`# `, `- `, `> `, `1. `,
     ```) se escapa con `\` al serializar; el parser quita los escapes. */
(function (root) {
  'use strict';

  /* ─── Esquema ─── */
  const schemaSpec = {
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
      heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block', defining: true,
        parseDOM: [1, 2, 3].map(l => ({ tag: 'h' + l, attrs: { level: l } })).concat([{ tag: 'h4', attrs: { level: 3 } }, { tag: 'h5', attrs: { level: 3 } }, { tag: 'h6', attrs: { level: 3 } }]),
        toDOM: n => ['h' + n.attrs.level, 0] },
      blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
      code_block: { attrs: { lang: { default: '' } }, content: 'text*', marks: '', group: 'block', code: true, defining: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: n => ({ lang: (n.getAttribute('data-lang') || '') }) }],
        toDOM: n => ['pre', { 'data-lang': n.attrs.lang || null }, ['code', 0]] },
      horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
      image: { attrs: { src: {}, alt: { default: '' } }, group: 'block', draggable: true, atom: true,
        parseDOM: [{ tag: 'img[src]', getAttrs: n => ({ src: n.getAttribute('data-src') || n.getAttribute('src'), alt: n.getAttribute('alt') || '' }) }],
        toDOM: n => ['img', { src: n.attrs.src, alt: n.attrs.alt, 'data-src': n.attrs.src }] },
      bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul:not([data-todo])' }], toDOM: () => ['ul', 0] },
      ordered_list: { attrs: { order: { default: 1 } }, content: 'list_item+', group: 'block',
        parseDOM: [{ tag: 'ol', getAttrs: n => ({ order: n.hasAttribute('start') ? +n.getAttribute('start') : 1 }) }],
        toDOM: n => ['ol', n.attrs.order === 1 ? {} : { start: n.attrs.order }, 0] },
      todo_list: { content: 'todo_item+', group: 'block', parseDOM: [{ tag: 'ul[data-todo]' }], toDOM: () => ['ul', { 'data-todo': '1' }, 0] },
      list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li:not([data-checked])' }], toDOM: () => ['li', 0] },
      todo_item: { attrs: { checked: { default: false } }, content: 'paragraph block*', defining: true,
        parseDOM: [{ tag: 'li[data-checked]', getAttrs: n => ({ checked: n.getAttribute('data-checked') === 'true' }) }],
        toDOM: n => ['li', { 'data-checked': n.attrs.checked ? 'true' : 'false' }, 0] },
      text: { group: 'inline' },
      hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    },
    marks: {
      link: { attrs: { href: {} }, inclusive: false,
        parseDOM: [{ tag: 'a[href]', getAttrs: n => ({ href: n.getAttribute('href') }) }],
        toDOM: m => ['a', { href: m.attrs.href, rel: 'noopener', target: '_blank' }, 0] },
      code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
      strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: v => /^(bold|[6-9]00)$/.test(v) && null }], toDOM: () => ['strong', 0] },
      em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
      underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
      strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
    },
  };

  /* ─── Parser: bloques ─── */
  const RE = {
    heading: /^ {0,3}(#{1,6})\s+(.*)$/,
    hr: /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/,
    fence: /^ {0,3}```(.*)$/,
    quote: /^ {0,3}>\s?(.*)$/,
    todo: /^( *)[-*+] \[([ xX])\]\s?(.*)$/,
    bullet: /^( *)[-*+] (.*)$/,
    bulletEmpty: /^( *)[-*+]\s*$/,
    ordered: /^( *)(\d{1,9})[.)] (.*)$/,
    image: /^ {0,3}!\[([^\]]*)\]\(([^)\s]+)\)\s*$/,
  };
  const isBlank = l => !l.trim();
  const startsBlock = l => RE.heading.test(l) || RE.hr.test(l) || RE.fence.test(l) || RE.quote.test(l) ||
    RE.todo.test(l) || RE.bullet.test(l) || RE.ordered.test(l) || RE.image.test(l);

  function parse(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    const content = parseBlocks(lines);
    return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
  }

  function parseBlocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (isBlank(line)) { i++; continue; }
      if ((m = RE.fence.exec(line))) {
        const lang = m[1].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^ {0,3}```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;   // la valla de cierre (o el final)
        const node = { type: 'code_block', attrs: { lang } };
        if (buf.length) node.content = [{ type: 'text', text: buf.join('\n') }];
        out.push(node);
        continue;
      }
      if ((m = RE.heading.exec(line))) {
        out.push({ type: 'heading', attrs: { level: Math.min(m[1].length, 3) }, content: inline(m[2].replace(/\s+#+\s*$/, '').trim()) });
        i++; continue;
      }
      if (RE.hr.test(line)) { out.push({ type: 'horizontal_rule' }); i++; continue; }
      if ((m = RE.image.exec(line))) { out.push({ type: 'image', attrs: { src: m[2], alt: m[1] } }); i++; continue; }
      if (RE.quote.test(line)) {
        const inner = [];
        while (i < lines.length && RE.quote.test(lines[i])) inner.push(RE.quote.exec(lines[i++])[1]);
        out.push({ type: 'blockquote', content: parseBlocks(inner).length ? parseBlocks(inner) : [{ type: 'paragraph' }] });
        continue;
      }
      if (RE.todo.test(line) || RE.bullet.test(line) || RE.ordered.test(line) || RE.bulletEmpty.test(line)) {
        const r = parseList(lines, i);
        out.push(r.node); i = r.next;
        continue;
      }
      /* Párrafo: hasta línea en blanco o hasta que empiece otro bloque. */
      const buf = [line];
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) buf.push(lines[i++]);
      out.push({ type: 'paragraph', content: inlineLines(buf) });
    }
    return out;
  }

  /* Una lista: elementos del mismo tipo y sangría. Cada elemento se lleva sus
     líneas de continuación (sangradas) y se analiza recursivamente. */
  function parseList(lines, start) {
    const first = lines[start];
    const kind = RE.todo.test(first) ? 'todo' : RE.ordered.test(first) ? 'ordered' : 'bullet';
    const indent = (/^( *)/.exec(first))[1].length;
    const items = [];
    let i = start, order = 1;
    while (i < lines.length) {
      const l = lines[i];
      const ind = (/^( *)/.exec(l))[1].length;
      let m, head, checked = false;
      if (ind !== indent) break;
      if (kind === 'todo' && (m = RE.todo.exec(l))) { checked = m[2] !== ' '; head = m[3]; }
      else if (kind === 'ordered' && (m = RE.ordered.exec(l))) { if (!items.length) order = +m[2]; head = m[3]; }
      else if (kind === 'bullet' && !RE.todo.test(l) && (m = RE.bullet.exec(l))) head = m[2];
      else if (kind === 'bullet' && RE.bulletEmpty.test(l)) head = '';
      else break;
      const markerW = kind === 'ordered' ? 3 : 2;
      const sub = [head];
      i++;
      /* Continuación: líneas con más sangría, y líneas en blanco si después
         sigue algo sangrado (otro bloque del mismo elemento). */
      while (i < lines.length) {
        const n = lines[i];
        const nind = (/^( *)/.exec(n))[1].length;
        if (isBlank(n)) {
          let j = i + 1;
          while (j < lines.length && isBlank(lines[j])) j++;
          const after = j < lines.length ? (/^( *)/.exec(lines[j]))[1].length : -1;
          if (after > indent) { sub.push(''); i++; continue; }
          break;
        }
        if (nind > indent) { sub.push(n.slice(Math.min(nind, indent + markerW))); i++; continue; }
        break;
      }
      const content = parseBlocks(sub);
      if (!content.length || content[0].type !== 'paragraph') content.unshift({ type: 'paragraph' });
      items.push(kind === 'todo' ? { type: 'todo_item', attrs: { checked }, content } : { type: 'list_item', content });
      /* Elementos separados por UNA línea en blanco siguen siendo la misma lista. */
      if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && (/^( *)/.exec(lines[i + 1]))[1].length === indent &&
        (kind === 'todo' ? RE.todo.test(lines[i + 1]) : kind === 'ordered' ? RE.ordered.test(lines[i + 1]) : (RE.bullet.test(lines[i + 1]) && !RE.todo.test(lines[i + 1])))) i++;
    }
    const node = kind === 'todo' ? { type: 'todo_list', content: items }
      : kind === 'ordered' ? { type: 'ordered_list', attrs: { order }, content: items }
      : { type: 'bullet_list', content: items };
    return { node, next: i };
  }

  /* ─── Parser: inline ─── */
  function inlineLines(lines) {
    const out = [];
    lines.forEach((l, k) => {
      if (k) out.push({ type: 'hard_break' });
      out.push(...inline(l.trim()));
    });
    return out;
  }

  const MARK_ORDER = ['link', 'code', 'strong', 'em', 'underline', 'strike'];
  const DELIMS = [['**', 'strong'], ['++', 'underline'], ['~~', 'strike'], ['*', 'em'], ['_', 'em']];
  const PUNCT = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

  function inline(text, marks) {
    marks = marks || [];
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push(textNode(buf, marks)); buf = ''; } };
    let i = 0;
    const s = String(text);
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (c === '`') {
        const run = /^`+/.exec(s.slice(i))[0];
        const close = s.indexOf(run, i + run.length);
        if (close > i + run.length) {
          flush();
          out.push(textNode(s.slice(i + run.length, close).replace(/^ (?=\S)|(?<=\S) $/g, ''), marks.concat('code')));
          i = close + run.length; continue;
        }
        buf += run; i += run.length; continue;
      }
      if (c === '[' && s[i + 1] !== '[') {
        const m = /^\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(s.slice(i));
        if (m) {
          flush();
          const inner = inline(m[1], marks.concat({ link: m[2] }));
          out.push(...inner);
          i += m[0].length; continue;
        }
      }
      let hit = null;
      for (const [d, mark] of DELIMS) {
        if (!s.startsWith(d, i) || marks.includes(mark)) continue;
        /* `_` y `*` abren solo al principio o tras espacio/puntuación: "a*b*c"
           y "snake_case" son texto. (Se pierde el énfasis intrapalabra de
           CommonMark; en notas no se echa de menos y evita escapar cada `*`.) */
        if (d.length === 1 && i > 0 && !PUNCT.test(s[i - 1])) continue;
        const next = s[i + d.length];
        if (next === undefined || /\s/.test(next) || (d.length === 1 && next === d)) continue;
        const close = findClose(s, i + d.length, d);
        if (close < 0) continue;
        hit = { d, mark, close };
        break;
      }
      if (hit) {
        flush();
        out.push(...inline(s.slice(i + hit.d.length, hit.close), marks.concat(hit.mark)));
        i = hit.close + hit.d.length; continue;
      }
      buf += c; i++;
    }
    flush();
    return out;
  }
  /* Cierre del delimitador: el mismo texto, no precedido por espacio ni por
     barra, y para `_` no seguido de letra. Salta los tramos de código. */
  function findClose(s, from, d) {
    let i = from;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') { const j = s.indexOf('`', i + 1); if (j < 0) return -1; i = j + 1; continue; }
      if (s.startsWith(d, i) && !/\s/.test(s[i - 1]) && (d !== '_' || i + 1 >= s.length || PUNCT.test(s[i + 1])) && (d.length === 2 || s[i + 1] !== d)) return i;
      i++;
    }
    return -1;
  }
  function textNode(text, marks) {
    const n = { type: 'text', text };
    if (marks.length) n.marks = marks.map(m => typeof m === 'string' ? { type: m } : { type: 'link', attrs: { href: m.link } });
    return n;
  }

  /* ─── Serializer ─── */
  const BLOCKISH = [/^ {0,3}#{1,6}\s/, /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/, /^ {0,3}>/, /^ {0,3}```/, /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/, /^ {0,3}!\[/];

  function serialize(doc) {
    return blocks(doc.content || []).join('\n\n').replace(/\n{3,}/g, '\n\n');
  }
  function blocks(list) {
    const out = [];
    for (const n of list) out.push(block(n));
    return out;
  }
  function block(n) {
    switch (n.type) {
      case 'paragraph': {
        const t = inlineOut(n.content || []);
        return BLOCKISH.some(r => r.test(t)) ? '\\' + t.replace(/^ +/, '') : t;
      }
      case 'heading': return '#'.repeat(n.attrs && n.attrs.level || 1) + ' ' + inlineOut(n.content || []).replace(/\n/g, ' ');
      case 'blockquote': return blocks(n.content || []).join('\n\n').split('\n').map(l => (l ? '> ' + l : '>')).join('\n');
      case 'code_block': {
        const txt = (n.content || []).map(t => t.text || '').join('');
        return '```' + ((n.attrs && n.attrs.lang) || '') + '\n' + txt + '\n```';
      }
      case 'horizontal_rule': return '---';
      case 'image': return `![${(n.attrs.alt || '').replace(/[\[\]]/g, '')}](${n.attrs.src})`;
      case 'bullet_list': return listOut(n.content || [], () => '- ', 2);
      case 'todo_list': return listOut(n.content || [], it => (it.attrs && it.attrs.checked ? '- [x] ' : '- [ ] '), 2);
      case 'ordered_list': {
        let k = (n.attrs && n.attrs.order) || 1;
        return listOut(n.content || [], () => `${k++}. `, 3);
      }
      default: return inlineOut(n.content || []);
    }
  }
  const LISTS = ['bullet_list', 'ordered_list', 'todo_list'];
  function listOut(items, marker, indent) {
    const pad = ' '.repeat(indent);
    return items.map(it => {
      const c = it.content || [];
      let s = marker(it) + (c.length ? block(c[0]) : '').split('\n').join('\n' + pad);
      for (let k = 1; k < c.length; k++) {
        /* una lista anidada va pegada a su párrafo; otro bloque, con línea en blanco */
        s += (LISTS.includes(c[k].type) ? '\n' : '\n\n') + block(c[k]).split('\n').map(l => (l ? pad + l : l)).join('\n');
      }
      return s;
    }).join('\n');
  }

  /* Inline: abre y cierra marcas en orden fijo, y saca los espacios de los
     extremos fuera de la marca («** hola**» no es negrita en Markdown). */
  const OPEN = { strong: '**', em: '*', underline: '++', strike: '~~', code: '`' };
  function inlineOut(nodes) {
    let s = '';
    let active = [];
    const marksOf = n => (n.marks || []).slice().sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const same = (a, b) => a.type === b.type && (a.type !== 'link' || a.attrs.href === b.attrs.href);
    const open = m => (m.type === 'link' ? '[' : OPEN[m.type]);
    const close = m => (m.type === 'link' ? `](${m.attrs.href})` : OPEN[m.type]);
    const prefix = (a, b) => { let k = 0; while (k < a.length && k < b.length && same(a[k], b[k])) k++; return k; };
    const closeTo = keep => { let r = ''; for (let k = active.length - 1; k >= keep; k--) r += close(active[k]); active = active.slice(0, keep); return r; };
    for (let idx = 0; idx < nodes.length; idx++) {
      const n = nodes[idx];
      if (n.type === 'hard_break') { s += closeTo(0) + '\n'; continue; }
      let text = n.text || '';
      const ms = marksOf(n);
      /* espacios de los bordes, fuera de las marcas que no continúan */
      let lead = '', trail = '';
      if (ms.length) { const m1 = /^\s+/.exec(text); const m2 = /\s+$/.exec(text); if (m1) { lead = m1[0]; text = text.slice(lead.length); } if (m2 && text) { trail = m2[0]; text = text.slice(0, -trail.length); } }
      s += closeTo(prefix(active, ms)) + lead;
      for (let k = active.length; k < ms.length; k++) { s += open(ms[k]); active.push(ms[k]); }
      s += ms.some(m => m.type === 'code') ? text : escapeInline(text);
      if (trail) {
        const nx = nodes[idx + 1];
        const nextMs = nx && nx.type === 'text' ? marksOf(nx) : [];
        s += closeTo(prefix(ms, nextMs)) + trail;
      }
    }
    s += closeTo(0);
    return s;
  }
  /* Lo mínimo para que el texto plano vuelva igual: los delimitadores que el
     parser entendería como marca. `#` y `[[` no se escapan (son etiqueta y
     enlace a propósito); `_` solo donde abriría una cursiva. */
  function escapeInline(t) {
    return t.replace(/\\/g, '\\\\').replace(/[*`]/g, '\\$&').replace(/(\+\+|~~)/g, '\\$1')
      .replace(/(^|[^A-Za-z0-9À-ɏ])_(?=\S)/g, '$1\\_').replace(/\[(?!\[)([^\]]*)\]\(/g, '\\[$1](');
  }

  const MDPM = { schemaSpec, parse, serialize };
  root.MDPM = MDPM;
  if (typeof module !== 'undefined' && module.exports) module.exports = MDPM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
