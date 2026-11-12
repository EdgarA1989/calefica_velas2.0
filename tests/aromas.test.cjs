const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function app() {
  const data = new Map();
  const context = vm.createContext({
    console, Intl, encodeURIComponent,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) },
  });
  vm.runInContext(read('js/aromas.js') + '\n' + read('js/main.js'), context);
  return { context, run: code => vm.runInContext(code, context), data };
}

const aromas = 'Floral|#B7A0D4|SI|2|NO|floral;Cítrico|#E5CB72|SI|1|SI|citrico;Retirado|#FFFFFF|NO|0';

test('aromas: orden, activo, predeterminado, edición y compatibilidad', () => {
  const { context, run } = app();
  context.raw = aromas;
  assert.equal(run('normalizeAromas(raw).map(a => a.nombre).join(",")'), 'Cítrico,Floral');
  assert.equal(run('getDefaultAroma(normalizeProduct({ aroma: raw })).id'), 'citrico');
  assert.equal(run('normalizeAromas("Lavanda")[0].nombre'), 'Lavanda');
  assert.equal(run('normalizeAromas("Lavanda")[0].color'), null);
  assert.equal(run('normalizeAromas("").length'), 0);
  assert.equal(run('normalizeAromas("[{malformado]").length'), 0);
  assert.equal(run('normalizeAromas("Nuevo|#123456|SI|3")[0].color'), '#123456');
  assert.equal(run('normalizeAromas("Nuevo|red;Otra|#123456").length'), 2);
  assert.equal(run('normalizeAromas("Nuevo|red")[0].color'), null);
  assert.equal(run('normalizeProduct({ aroma: "Anterior", aromas: [] }).aromas.length'), 0);
  assert.equal(run('normalizeAromas("Floral|#B7A0D4|NO|1").length'), 0);
  assert.equal(run('normalizeAromas("Floral|#112233|SI|1")[0].color'), '#112233');
  assert.equal(run('normalizeAromas("Floral|#112233|SI|1;Nuevo|#445566|SI|2").length'), 2);
});

test('carrito: variantes separadas, agrupación, controles y mensajes', () => {
  const { run, context } = app();
  context.raw = aromas;
  run('const p = normalizeProduct({id:"vela", nombre:"Vela", precio:100, aroma:raw, stock:"SI"}); addToCart(p,2,p.aromas[0]); addToCart(p,3,p.aromas[1]); addToCart(p,1,p.aromas[0]);');
  assert.equal(run('getCart().length'), 2);
  assert.equal(run('getCart()[0].cantidad'), 3);
  assert.equal(run('calculateCartTotal()'), 600);
  run('increaseCartItem(getCart()[1].cartKey); decreaseCartItem(getCart()[0].cartKey)');
  assert.equal(run('getCart()[0].cantidad'), 2);
  assert.equal(run('getCart()[1].cantidad'), 4);
  assert.match(run('buildWhatsAppOrderMessage(getCart())'), /Aroma\/variante: Cítrico/);
  assert.match(run('buildWhatsAppOrderMessage(getCart())'), /Aroma\/variante: Floral/);
  assert.match(decodeURIComponent(run('getProductWhatsappUrl(p,1,p.aromas[1])')), /Aroma: Floral/);
  run('removeFromCart(getCart()[0].cartKey)');
  assert.equal(run('getCart().length'), 1);
  assert.equal(run('getCart()[0].aroma'), 'Floral');
});

test('sin aromas, pedidos anteriores y sincronización de variantes editadas o retiradas', () => {
  const { run, context } = app();
  context.raw = aromas;
  run('const p = normalizeProduct({id:"vela", aroma:raw, stock:"SI"}); addToCart(p,1,p.aromas[0]); addToCart(p,1,p.aromas[1]);');
  run('const updated = normalizeProduct({ id:"vela", stock:"SI", aroma:"Nombre nuevo|#123456|SI|1|NO|floral" }); syncCartWithProducts([updated])');
  assert.equal(run('getCart().length'), 1);
  assert.equal(run('getCart()[0].aroma'), 'Nombre nuevo');
  run('clearCart(); const noAroma = normalizeProduct({id:"simple", aroma:"", stock:"SI"}); addToCart(noAroma,1); syncCartWithProducts([noAroma]);');
  assert.equal(run('getCart()[0].aroma'), '');
  assert.equal(run('getCart().length'), 1);
  run('saveCart([{ id:"legacy", aroma:"Lavanda", cantidad:2, precio:10 }]); syncCartWithProducts([normalizeProduct({id:"legacy", stock:"SI", aroma:"Lavanda"})]);');
  assert.equal(run('getCart().length'), 1);
  assert.equal(run('getCart()[0].aroma'), 'Lavanda');
});
