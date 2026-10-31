/* Markdown ↔ ProseMirror (pb_public/js/mdpm.js) con el ProseMirror REAL
   vendorizado: cada documento que sale del parser pasa por schema.nodeFromJSON
   + check(), y el viaje de ida y vuelta devuelve el mismo Markdown. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'pb_public', 'js', 'prosemirror.js'), 'utf8'));
const MDPM = require('../pb_public/js/mdpm.js');
const MD = require('../pb_public/js/md.js');
const schema = new PM.model.Schema(MDPM.schemaSpec);

const roundtrip = md => {
  const json = MDPM.parse(md);
  const node = schema.nodeFromJSON(json);
  node.check();
  return MDPM.serialize(node.toJSON());
};
const same = (md, msg) => assert.strictEqual(roundtrip(md), md, msg || md);

test('bloques básicos: título, párrafos, saltos, separador', () => {
  same('# Título\n\nUn párrafo.\n\nOtro con\nsalto simple.\n\n---\n\nFin.');
  same('## Subtítulo\n\n### Encabezado');
  assert.deepStrictEqual(MDPM.parse('').content, [{ type: 'paragraph' }]);
  assert.strictEqual(roundtrip('Hola   \n\n\n\nMundo'), 'Hola\n\nMundo', 'normaliza blancos');
  assert.strictEqual(roundtrip('#### Cuatro'), '### Cuatro', 'h4+ se queda en 3 niveles');
});

test('listas: viñetas, numeradas, to-do, anidadas y con varios bloques', () => {
  same('- uno\n- dos\n  - dos punto uno\n  - dos punto dos\n- tres');
  same('1. a\n2. b\n3. c');
  same('3. empieza en tres\n4. sigue');
  same('- [ ] pasaporte\n- [x] cargador\n- [ ] equipaje');
  same('- [ ] padre\n  - [x] hijo\n  - [ ] otro hijo');
  same('- elemento con dos párrafos\n\n  segundo párrafo del elemento\n- siguiente');
  same('1. paso\n   - detalle\n   - detalle\n2. paso dos');
  assert.strictEqual(roundtrip('* a\n+ b'), '- a\n- b', 'otros marcadores se normalizan a -');
  assert.strictEqual(roundtrip('- a\n\n- b'), '- a\n- b', 'una línea en blanco entre elementos no parte la lista');
});

test('cita, código, imagen', () => {
  same('> una cita\n> de dos líneas');
  same('> cita con lista\n>\n> - a\n> - b');
  same('```js\nconst x = **no es negrita**;\n\n# ni título\n```');
  same('```\nsin lenguaje\n```');
  same('![foto](attachments/abc123)');
  const j = MDPM.parse('```\nhola\n```');
  assert.strictEqual(j.content[0].content[0].text, 'hola');
  assert.strictEqual(MDPM.parse('```\nsin cerrar').content[0].content[0].text, 'sin cerrar');
});

test('inline: negrita, cursiva, subrayado, tachado, código, enlaces, combinadas', () => {
  same('**negrita** *cursiva* ++subrayado++ ~~tachado~~ `código`');
  same('**negrita con *cursiva* dentro**');
  same('[texto](https://ejemplo.com) y `a**b**c` literal');
  assert.strictEqual(roundtrip('_cursiva_ y snake_case_nombre'), '*cursiva* y snake_case_nombre', '_ solo entre palabras');
  const j = MDPM.parse('a **b** c');
  assert.deepStrictEqual(j.content[0].content.map(n => [n.text, (n.marks || []).map(m => m.type).join()]), [['a ', ''], ['b', 'strong'], [' c', '']]);
  const l = MDPM.parse('[x](http://u)').content[0].content[0];
  assert.deepStrictEqual(l.marks, [{ type: 'link', attrs: { href: 'http://u' } }]);
});

test('etiquetas y wikilinks siguen siendo texto; md.js deriva lo mismo tras el viaje', () => {
  const md = '# Viaje a Cusco #viaje\n\nVer [[Lista de equipaje]] y #redes.';
  same(md);
  const j = MDPM.parse(md);
  assert.strictEqual(j.content[1].content.length, 1, 'un solo nodo de texto, sin marcas');
  const d = MD.derive(roundtrip(md));
  assert.deepStrictEqual(d.tags, ['viaje', 'redes']);
  assert.deepStrictEqual(d.links, ['Lista de equipaje']);
});

test('escapes: texto que parece sintaxis vuelve igual y md.js lo lee limpio', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# no soy título' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '- no soy lista' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '2 * 3 = 6 y a*b*c y C++ y ~~ok~~' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'precio **real**' }] },
  ] };
  const md = MDPM.serialize(doc);
  assert.ok(md.startsWith('\\# no soy'), md);
  const back = schema.nodeFromJSON(MDPM.parse(md)).toJSON();
  assert.deepStrictEqual(back, doc, 'el texto literal sobrevive');
  assert.strictEqual(MD.plain(md).split('\n')[0], '# no soy título');
  assert.ok(MD.plain(md).includes('C++ y ~~ok~~'), MD.plain(md));
  assert.strictEqual(MD.title(md), '# no soy título');
});

test('espacios en los bordes de una marca salen fuera de ella', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'hola' }, { type: 'text', text: ' mundo ', marks: [{ type: 'strong' }] }, { type: 'text', text: 'fin' } ] }] };
  const md = MDPM.serialize(doc);
  assert.strictEqual(md, 'hola **mundo** fin');
});

test('un documento largo mezclado va y vuelve igual', () => {
  same(['# Receta de lentejas #cocina', '', 'Para **4 personas**. Ver [[Compras]].', '', '## Ingredientes', '', '- [ ] 500 g de lentejas', '- [x] cebolla', '  - [ ] *grande*', '', '> Remojar la noche anterior.', '', '1. Sofreír', '2. Cocer 40 min', '', '```', 'tiempo = 40', '```', '', '---', '', '![olla](attachments/xyz)', '', 'Fin.'].join('\n'));
});
