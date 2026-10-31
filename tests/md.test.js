// node --test tests/md.test.js  (sin npm: node:test viene con Node ≥ 18)
const test = require('node:test');
const assert = require('node:assert/strict');
const MD = require('../pb_public/js/md.js');

test('título: la primera línea con formato título', () => {
  assert.equal(MD.title('# Lista del súper\n\n- leche'), 'Lista del súper');
  assert.equal(MD.hasTitle('# Lista'), true);
});

test('título: una nota que empieza por cuerpo usa su primera línea', () => {
  assert.equal(MD.title('\n\nLlamar al **dentista** mañana\nmás texto'), 'Llamar al dentista mañana');
  assert.equal(MD.hasTitle('Llamar al dentista'), false);
});

test('título: se recorta en una palabra entera a 120', () => {
  const t = MD.title('palabra '.repeat(40));
  assert.ok(t.length <= 120);
  assert.ok(!t.endsWith(' '));
});

test('plain: quita marcas de bloque e inline y conserva el código', () => {
  const md = [
    '# Título', '', '> una cita', '- [ ] por hacer', '- [x] hecho', '1. uno', '---',
    'Con **negrita**, *cursiva*, ~~tachado~~, ++subrayado++ y `código`.',
    '![foto](attachments/abc)', '[enlace](https://x.y)', '[[otra nota|alias]]',
    '```', 'const x = 1;', '```',
  ].join('\n');
  assert.equal(MD.plain(md), [
    'Título', '', 'una cita', 'por hacer', 'hecho', 'uno', '',   // el separador deja una línea vacía
    'Con negrita, cursiva, tachado, subrayado y código.',
    'foto', 'enlace', 'alias', 'const x = 1;',
  ].join('\n'));
});

test('tags: #etiqueta sí, # título no, ni dentro de código, sin repetir, en minúscula', () => {
  const md = '# Título\nHola #Viaje y #viaje, (#Compras) #2026 no\n`#nocode`\n```\n#tampoco\n```\n#año-nuevo.';
  assert.deepEqual(MD.tags(md), ['viaje', 'compras', 'año-nuevo']);
});

test('links: [[…]] sin alias, sin repetir, fuera de código', () => {
  assert.deepEqual(MD.links('ver [[Router casa]] y [[Router casa|el router]], `[[no]]`'), ['Router casa']);
});

test('derive: devuelve los cuatro campos y aguanta null', () => {
  assert.deepEqual(MD.derive(null), { title: '', plain: '', tags: [], links: [] });
  const d = MD.derive('# Hola #tag\n[[x]]');
  assert.deepEqual(d, { title: 'Hola #tag', plain: 'Hola #tag\nx', tags: ['tag'], links: ['x'] });
});
