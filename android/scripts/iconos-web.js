#!/usr/bin/env node
/* Los iconos de Android SON los de la web: este guion lee pb_public/js/icons.js
   y escribe ui/Iconos.kt (GENERADO: no se edita a mano). Cada icono es un
   ImageVector de trazo fino hecho con las mismas rutas SVG.

     node android/scripts/iconos-web.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'pb_public/js/icons.js'), 'utf8');

const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const out = [];
const re = /^\s+(\w+): \(\) => _svg\('(.*?)'(?:, '([^']*)')?\),?\s*$/gm;
let m;
while ((m = re.exec(src))) {
  const [, name, body, extra] = m;
  const w = extra && attr(extra, 'stroke-width') ? attr(extra, 'stroke-width') + 'f' : null;
  const parts = [];
  for (const t of body.match(/<[^>]+>/g) || []) {
    const filled = attr(t, 'fill') === 'currentColor';
    const op = attr(t, 'opacity');
    const opts = [w && !filled ? `w = ${w}` : null, op ? `alfa = ${parseFloat(op)}f` : null].filter(Boolean).join(', ');
    if (t.startsWith('<path')) parts.push(`p("${attr(t, 'd')}"${opts ? ', ' + opts : ''})`);
    else if (t.startsWith('<circle')) parts.push(`c(${attr(t, 'cx')}f, ${attr(t, 'cy')}f, ${attr(t, 'r')}f${filled ? ', relleno = true' : ''}${opts ? ', ' + opts : ''})`);
    else if (t.startsWith('<rect')) parts.push(`r(${attr(t, 'x')}f, ${attr(t, 'y')}f, ${attr(t, 'width')}f, ${attr(t, 'height')}f, ${attr(t, 'rx') || 0}f${opts ? ', ' + opts : ''})`);
  }
  out.push(`    val ${name}: ImageVector by lazy { icono { ${parts.join('; ')} } }`);
}
const kt = `// GENERADO por android/scripts/iconos-web.js desde pb_public/js/icons.js.
// No se edita a mano: cambia el icono en la web y vuelve a generar.
package com.samukis.papernotes.ui

import androidx.compose.ui.graphics.vector.ImageVector

object Ico {
${out.join('\n')}
}
`;
const dest = path.join(__dirname, '..', 'app/src/main/java/com/samukis/papernotes/ui/Iconos.kt');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, kt);
console.log(`${out.length} iconos → ${path.relative(root, dest)}`);
