#!/usr/bin/env node
/* Casos de oro para el núcleo de Android: cada Markdown de la lista pasa por
   el mdpm.js y el md.js DE LA WEB y se guarda su forma canónica y sus
   derivados en core/src/test/resources/golden/md.json. BlocksTest comprueba
   que Kotlin devuelve exactamente lo mismo. No se edita el JSON a mano:

     node android/scripts/oro-md.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const MDPM = require(path.join(root, 'pb_public/js/mdpm.js'));
const MD = require(path.join(root, 'pb_public/js/md.js'));

const casos = [
  '', '# ', 'Hola', '# Título\n\nUn párrafo.\n\nOtro con\nsalto simple.\n\n---\n\nFin.',
  '## Subtítulo\n\n### Encabezado', '#### Cuatro', 'Hola   \n\n\nMundo',
  '- uno\n- dos\n  - dos punto uno\n  - dos punto dos\n- tres', '1. a\n2. b\n3. c', '3. empieza en tres\n4. sigue',
  '- [ ] pasaporte\n- [x] cargador\n- [ ] equipaje', '- [ ] padre\n  - [x] hijo\n  - [ ] otro hijo',
  '- elemento con dos párrafos\n\n  segundo párrafo del elemento\n- siguiente', '1. paso\n   - detalle\n   - detalle\n2. paso dos',
  '* a\n+ b', '- a\n\n- b', '- a\n- b\n\n1. uno\n2. dos\n\n- [ ] c',
  '# T\n\n- uno\n\n\n\ncuerpo', '- [ ] tarea\n\n\n\n\n\ncuerpo', '\n\nempieza vacío', 'termina\n\n', 'a\n\n\n\nb\n\n\n\nc',
  '> una cita\n> de dos líneas', '> cita con lista\n>\n> - a\n> - b', '> uno\n\n> dos',
  '```js\nconst x = **no es negrita**;\n\n# ni título\n```', '```\nsin lenguaje\n```', '```\n```', 'antes\n\n```py\nprint(1)\n```\n\ndespués',
  '![foto](attachments/abc123def456ghi)', 'texto\n\n![](attachments/abc123def456ghi)\n\nmás texto',
  '**negrita** *cursiva* ~~tachado~~ ++subrayado++ `código`', 'un [enlace](https://example.com/a_b) y **[otro](https://x.y)**',
  '***las dos*** y `a*b*c` y snake_case y 2*3*4', 'Ir a [[Otra nota]] y [[nota|con alias]] #viaje #trabajo/cliente (#entre-parentesis)',
  '\\# no es título', '\\- no es lista', '1\\. no es lista', 'precio: 5\\*3 \\_x\\_ y \\[no enlace\\](x)', '\\> no es cita',
  'barra \\\\ suelta y `código con \\ barra`',
  '- [x] hecho con **negrita**\n- [ ] por hacer con `código`\n  1. sub uno\n  2. sub dos\n     - profundo',
  '- a\n  - b\n    - c\n  - d\n- e', '- elemento\n\n  ```\n  código dentro\n  ```\n- otro', '- elemento\n\n  ![img](attachments/abc123def456ghi)',
  '1. uno\n\n   párrafo dentro\n\n   otro más\n2. dos', '-\n- b', '- \n- [ ] \n1. ',
  '# Lista del viaje\n\n- [x] pasaporte\n- [ ] cargador\n\n\n\nTexto del cuerpo con **negrita**, #viaje y [[Otra nota]].\n\n## Enlaces\n\n> Una cita\n\n- [web](https://example.com)\n\n```\ncódigo <b>no html</b>\n```',
  'Título sin formato\nsegunda línea\n\n- [ ] cosa', '# Uno\n# Dos\ntexto pegado\n- lista pegada\n> cita pegada\n---\nfin',
  '   sangrado raro\n\n\ttab', 'línea con dos espacios al final  \nsiguiente', '***', '___', '- - -', '+ con más\n\n  continuación',
  '10. diez\n11. once', '1) con paréntesis\n2) dos', '> > anidada', '>sin espacio', '# Título con #etiqueta y `código`\n\nCuerpo #otra.',
];

const out = casos.map(md => {
  const canon = MDPM.serialize(MDPM.parse(md));
  const d = MD.derive(canon);
  return { md, canon, estable: MDPM.serialize(MDPM.parse(canon)) === canon, title: d.title, plain: d.plain, tags: d.tags, hasTitle: MD.hasTitle(canon) };
});
const dest = path.join(__dirname, '..', 'core/src/test/resources/golden/md.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} casos → ${path.relative(root, dest)}; inestables en la web: ${out.filter(c => !c.estable).length}`);
