const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function sheet(name, grid, validations = []) {
  return { getName: () => name, getLastRow: () => grid.length, getLastColumn: () => grid[0].length,
    getDataRange: () => ({ getValues: () => grid, getDisplayValues: () => grid.map(row => row.map(value => String(value))),
      getFormulas: () => grid.map(row => row.map(() => '')), getDataValidations: () => validations }) };
}
function spreadsheet(products, aromas = null) {
  return { getId: () => '1AvIPysHm531nCfZ0ynotGB2ZzZDGHHqf5ILwhtStq44', getName: () => 'Catálogo privado',
    getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', getSpreadsheetLocale: () => 'es_AR',
    getSheetByName: name => name === 'productos' ? products : name === 'aromas' ? aromas : null,
    getSheets: () => [products, aromas].filter(Boolean) };
}
function exporter() {
  const context = vm.createContext({ Utilities: { Charset: { UTF_8: 'UTF-8' }, base64Encode: value => Buffer.from(value, 'utf8').toString('base64') } });
  vm.runInContext(read('google-apps-script/exportar-calefica.gs'), context);
  return { context, api: context.CaleficaExportacion };
}
const noDrive = () => { throw new Error('No se debe consultar Drive'); };

test('exportador: conserva productos ocultos, ceros, texto libre, columnas y aromas inactivos', () => {
  const p = sheet('productos', [['id', 'activo', 'precio', 'cantidadStock', 'aroma'],
    ['vela', 'SI', 0, 0, 'Lavanda + Vainilla'], ['oculta', 'NO', 12000, 'A pedido', ''], ['','','','','']]);
  const a = sheet('aromas', [['nombre', 'color', 'activo'], ['Retirado', '#112233', 'NO']]);
  const result = exporter().api.build(spreadsheet(p, a), noDrive);
  assert.equal(result.sheets.productos.rows.length, 3);
  assert.equal(result.sheets.productos.rows[0].values[2], 0);
  assert.equal(result.sheets.productos.rows[0].values[3], 0);
  assert.equal(result.sheets.productos.rows[0].values[4], 'Lavanda + Vainilla');
  assert.equal(result.sheets.productos.rows[1].values[1], 'NO');
  assert.equal(result.sheets.productos.rows[1].values[3], 'A pedido');
  assert.equal(result.sheets.productos.rows[1].row_number, 3);
  assert.equal(result.sheets.aromas.rows[0].values[2], 'NO');
  assert.equal(result.images.status, 'not_needed');
});

test('exportador: incluye todas las opciones del desplegable incluso con celda vacía y el intervalo original', () => {
  const list = { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [['Lavanda', 'Vainilla', '']] };
  const range = { getSheet: () => ({ getName: () => 'Opciones' }), getA1Notation: () => 'A2:A4', getValues: () => [['Coco'], ['Rosa'], ['']] };
  const fromRange = { getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [range] };
  const p = sheet('productos', [['id', 'aromas'], ['p1', ''], ['p2', 'Coco']], [[null, null], [null, list], [null, fromRange]]);
  const result = exporter().api.build(spreadsheet(p), noDrive);
  assert.deepEqual(Array.from(result.sheets.productos.rows[0].aroma_validation.options), ['Lavanda', 'Vainilla']);
  const rule = result.sheets.productos.rows[1].aroma_validation;
  assert.deepEqual(Array.from(rule.options), ['Coco', 'Rosa']);
  assert.equal(rule.range.sheet, 'Opciones'); assert.equal(rule.range.a1, 'A2:A4');
  assert.equal(rule.range.values.length, 3);
  assert.equal(result.warnings[0].code, 'aromas_sheet_absent');
});

test('exportador: archivos homónimos se conservan por ID; no cambia permisos ni descarga imágenes', () => {
  const p = sheet('productos', [['id', 'aroma', 'nombreImagen'], ['p1', 'Lavanda', 'vela.jpg']]);
  let index = 0;
  const files = ['f1', 'f2'].map(id => ({ getId: () => id, getName: () => 'vela.jpg', getMimeType: () => 'image/jpeg',
    getSize: () => 125, getLastUpdated: () => new Date('2026-01-01'),
    setSharing() { throw new Error('No se permite escribir'); }, getBlob() { throw new Error('No se permite descargar'); } }));
  const folder = { getFiles: () => ({ hasNext: () => index < files.length, next: () => files[index++] }) };
  const result = exporter().api.build(spreadsheet(p), () => folder);
  assert.equal(result.images.files.length, 2);
  assert.equal(result.images.files[0].id, 'f1'); assert.equal(result.images.files[1].id, 'f2');
  assert.deepEqual(Array.from(result.images.duplicate_names), ['vela.jpg']);
  assert.equal(result.images.status, 'complete');
});

test('exportador: error de permisos Drive deja catálogo completo con alerta; falta de productos falla claramente', () => {
  const p = sheet('productos', [['id', 'nombreImagen'], ['oculta', 'vela.jpg']]);
  const result = exporter().api.build(spreadsheet(p), () => { throw new Error('Sin acceso'); });
  assert.equal(result.images.status, 'incomplete');
  assert.equal(result.sheets.productos.rows.length, 1);
  assert.ok(result.warnings.some(warning => warning.code === 'drive_read_error'));
  assert.throws(() => exporter().api.build(spreadsheet(null), noDrive), /No existe la pestaña productos/);
});

test('exportador: JSON UTF-8 se transporta como base64, sin insertar HTML del catálogo en el diálogo', () => {
  const api = exporter().api;
  const text = '</script><script>alert(1)</script> · Vela cálida 🕯️';
  const result = api.build(spreadsheet(sheet('productos', [['id', 'nombre'], ['p1', text]])), noDrive);
  const html = api.downloadHtml(result);
  assert.equal(html.includes(text), false);
  const base64 = html.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1];
  assert.equal(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')).sheets.productos.rows[0].values[1], text);
});

test('exportador: convive con la API original y abre descarga manual sin publicar ni crear archivos', () => {
  const { context, api } = exporter();
  vm.runInContext(read('google-apps-script/catalogo-productos.gs'), context);
  const original = context.doGet;
  const p = sheet('productos', [['id', 'aroma'], ['p1', 'Lavanda']]);
  let opened = false;
  context.SpreadsheetApp = { openById: id => { assert.equal(id, '1AvIPysHm531nCfZ0ynotGB2ZzZDGHHqf5ILwhtStq44'); return spreadsheet(p); },
    getUi: () => ({ showModalDialog(html, title) { assert.match(html.content, /Descargar JSON/); assert.match(title, /Exportar/); opened = true; } }) };
  context.HtmlService = { createHtmlOutput: content => ({ content, setWidth() { return this; }, setHeight() { return this; } }) };
  api.run();
  assert.equal(opened, true);
  assert.equal(context.doGet, original);
});
