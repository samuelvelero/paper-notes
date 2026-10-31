/* ═══════════════ md.js — Markdown → derivados ═══════════════

   Un solo archivo, tres sitios: el navegador (global `MD`), los hooks de
   PocketBase (`require` desde pb_hooks/notes.pb.js) y el MCP. Así la web, el
   servidor y Claude derivan EXACTAMENTE lo mismo de un cuerpo:

     MD.derive(body) → { title, plain, tags, links }

   - title: la primera línea con texto, ya sin marcas (un `# Título` o, si la
     nota empieza por cuerpo, sus primeras palabras). Máx. 120 caracteres.
   - plain: el texto sin ninguna marca, para los índices de búsqueda. El
     contenido de los bloques de código SÍ queda (se busca); las vallas no.
   - tags: `#etiqueta` fuera de código; `# Título` (con espacio) no es etiqueta.
   - links: lo que hay dentro de `[[…]]`, sin el alias (`[[nota|texto]]` → nota).

   Sin dependencias y sin sintaxis que goja (el motor JS de PocketBase) no
   entienda: nada de lookbehind ni de \p{…}. */
(function (root) {
  'use strict';

  const TITLE_MAX = 120;
  // Etiqueta: # pegado a texto, precedido por inicio, espacio o paréntesis.
  // No empieza por dígito (para que "#1" no sea etiqueta) y corta en
  // puntuación. Acepta tildes y ñ por rango Latin-1 / Latin Extended.
  const TAG_RE = /(^|[\s(\[])#([A-Za-z_À-ɏ][\w\-\/À-ɏ]{0,59})/g;
  const WIKILINK_RE = /\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g;

  function norm(md) {
    return String(md == null ? '' : md).replace(/\r\n?/g, '\n');
  }

  /* Quita bloques ```…``` y `código` inline (para tags/links). */
  function stripCode(md) {
    return md.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  }

  /* Una línea sin marcas de bloque ni inline. */
  function plainLine(line) {
    /* Un carácter escapado (`\*`, `\#`: los pone el serializador de la web,
       mdpm.js) es texto literal: se aparta a un código privado para que
       ninguna regla de abajo lo tome por marca, y se restaura al final. */
    let s = line.replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, function (m, c) { return String.fromCharCode(0xE000 + c.charCodeAt(0)); });
    s = s.replace(/^\s{0,3}#{1,6}\s+/, '');                       // encabezado
    s = s.replace(/^\s*>\s?/, '');                                 // cita
    s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/, '');     // to-do
    s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');                 // lista
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(s)) return '';       // separador
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');                // imagen → alt
    s = s.replace(/\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/g, function (m, a, b) { return b || a; });
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                 // enlace → texto
    s = s.replace(/(\*\*|__|~~|\+\+)(\S(?:[\s\S]*?\S)?)\1/g, '$2'); // negrita, tachado, subrayado
    s = s.replace(/(\*|_)(\S(?:[\s\S]*?\S)?)\1/g, '$2');            // cursiva
    s = s.replace(/`([^`]*)`/g, '$1');                             // código inline
    s = s.replace(/[-]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xE000); });
    return s;
  }

  /* Texto sin marcas, línea a línea. Las vallas de código desaparecen y su
     contenido se queda tal cual (sin pasar por plainLine). */
  function plain(md) {
    const out = [];
    let inFence = false;
    norm(md).split('\n').forEach(function (line) {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      out.push(inFence ? line : plainLine(line));
    });
    return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function title(md) {
    const lines = norm(md).split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      const t = (inFence ? line : plainLine(line)).trim();
      if (t) return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX).replace(/\s+\S*$/, '') : t;
    }
    return '';
  }

  /* ¿La nota empieza por una línea con formato Título? (para el ajuste
     "título automático" y para saber si hay que pintar título en la lista). */
  function hasTitle(md) {
    const first = norm(md).split('\n').find(function (l) { return l.trim(); }) || '';
    return /^\s{0,3}#\s+\S/.test(first);
  }

  function tags(md) {
    const seen = {}, out = [];
    const src = stripCode(norm(md));
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(src))) {
      const t = m[2].replace(/[-\/]+$/, '').toLowerCase();
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    }
    return out;
  }

  function links(md) {
    const seen = {}, out = [];
    const src = stripCode(norm(md));
    let m;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(src))) {
      const t = m[1].trim();
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    }
    return out;
  }

  function derive(md) {
    return { title: title(md), plain: plain(md), tags: tags(md), links: links(md) };
  }

  const MD = { derive: derive, title: title, plain: plain, tags: tags, links: links, hasTitle: hasTitle, TITLE_MAX: TITLE_MAX };
  root.MD = MD;
  if (typeof module !== 'undefined' && module.exports) module.exports = MD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
