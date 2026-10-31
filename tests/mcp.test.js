/* Reglas puras del servidor MCP (mcp/server.js): cuerpo, carpetas y protocolo.
   Sin red: lo que habla con PocketBase y el buscador se prueba en
   tests/mcp-smoke.mjs contra un servidor vivo. */
const test = require('node:test');
const assert = require('node:assert');
const { withTitle, appendBody, excerpt, folderPath, pickFolder, folderTree, fmtDate, handle, TOOLS } = require('../mcp/server.js');

test('withTitle: antepone "# Título" solo si el contenido no empieza ya por uno', () => {
  assert.strictEqual(withTitle('Router', 'La clave está debajo.'), '# Router\n\nLa clave está debajo.');
  assert.strictEqual(withTitle('Otro', '# Ya tengo título\ncuerpo'), '# Ya tengo título\ncuerpo');
  assert.strictEqual(withTitle('', 'solo cuerpo'), 'solo cuerpo');
  assert.strictEqual(withTitle('# Con almohadilla', ''), '# Con almohadilla');
});

test('appendBody: al final separa con línea en blanco; al inicio respeta el título', () => {
  assert.strictEqual(appendBody('# T\n\nuno', 'dos', 'final'), '# T\n\nuno\n\ndos');
  assert.strictEqual(appendBody('# T\n\nuno', 'cero', 'inicio'), '# T\n\ncero\n\nuno');
  assert.strictEqual(appendBody('sin título\nmás', 'arriba', 'inicio'), 'arriba\n\nsin título\nmás');
  assert.strictEqual(appendBody('# Solo título', 'x', 'inicio'), '# Solo título\n\nx');
  assert.strictEqual(appendBody('', 'nuevo', 'final'), 'nuevo');
  assert.strictEqual(appendBody('a\r\nb\n\n', 'c\n', 'final'), 'a\nb\n\nc');
  assert.throws(() => appendBody('a', '  \n ', 'final'), /vacío/);
});

test('excerpt: quita el título, aplana líneas y corta en palabra', () => {
  assert.strictEqual(excerpt('Router\nLa clave del wifi\nestá debajo', 'Router'), 'La clave del wifi · está debajo');
  const largo = 'Título\n' + 'palabra '.repeat(60);
  const e = excerpt(largo, 'Título');
  assert.ok(e.length <= 161 && e.endsWith('…') && !/palabr…$/.test(e), e);
  assert.strictEqual(excerpt('Solo título', 'Solo título'), '');
});

const F = [
  { id: 'a', name: 'Trabajo', parent: '', order: '1' },
  { id: 'b', name: 'Clientes', parent: 'a', order: '1' },
  { id: 'c', name: 'Casa', parent: '', order: '2' },
  { id: 'd', name: 'Clientes', parent: 'c', order: '1' },
  { id: 'e', name: 'Viajes', parent: '', order: '0' },
];

test('folderPath y pickFolder: id, nombre, ruta, prefijo; ambigua e inexistente son errores con la lista', () => {
  assert.strictEqual(folderPath(F, 'b'), 'Trabajo / Clientes');
  assert.strictEqual(pickFolder(F, 'c').id, 'c');
  assert.strictEqual(pickFolder(F, 'trabajo').id, 'a');
  assert.strictEqual(pickFolder(F, 'Casa/Clientes').id, 'd');
  assert.strictEqual(pickFolder(F, 'via').id, 'e');
  assert.throws(() => pickFolder(F, 'clientes'), /ambigua.*Trabajo \/ Clientes.*Casa \/ Clientes/);
  assert.throws(() => pickFolder(F, 'Recetas'), /No existe.*"Viajes".*crear_carpeta/);
});

test('folderTree: anida, ordena por order y cuenta', () => {
  const t = folderTree(F, { a: 2, b: 5, d: 1 });
  assert.deepStrictEqual(t.map(x => x.nombre), ['Viajes', 'Trabajo', 'Casa']);
  assert.strictEqual(t[1].notas, 2);
  assert.deepStrictEqual(t[1].subcarpetas, [{ id: 'b', nombre: 'Clientes', notas: 5 }]);
  assert.strictEqual(t[0].subcarpetas, undefined);
  /* un padre que ya no existe no esconde a la hija */
  assert.strictEqual(folderTree([{ id: 'x', name: 'Huérfana', parent: 'zzz' }], {}).length, 1);
});

test('fmtDate: el formato de PocketBase en hora de Lima', () => {
  assert.strictEqual(fmtDate('2026-10-31 13:20:00.000Z'), '2026-10-31 08:20');
  assert.strictEqual(fmtDate(''), null);
});

test('protocolo: initialize, tools/list con las 7 herramientas, notificación muda, herramienta desconocida', async () => {
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.strictEqual(init.result.serverInfo.name, 'notas');
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepStrictEqual(list.result.tools.map(t => t.name),
    ['notas_buscar', 'nota_leer', 'nota_crear', 'nota_agregar', 'nota_actualizar', 'notas_recientes', 'carpetas_listar']);
  assert.ok(TOOLS.every(t => t.inputSchema.type === 'object'));
  assert.strictEqual(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const bad = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nota_borrar' } });
  assert.strictEqual(bad.error.code, -32602);
  const vacio = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'notas_buscar', arguments: { q: ' ' } } });
  assert.ok(vacio.result.isError && /vacío/.test(vacio.result.content[0].text));
});
