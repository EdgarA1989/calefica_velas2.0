const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(files, window = {}) {
  const context = vm.createContext({ window, URL, console });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return window;
}
const domainFile = 'js/domain/validation.js', productsFile = 'js/services/productsService.js';
const clientFile = 'js/lib/supabaseClient.js', adminFile = 'js/services/adminService.js';

test('validaciones: precio argentino sin miles, stock interno, slugs y archivos', () => {
  const v = setup([domainFile]).CaleficaValidation;
  assert.equal(v.price('15000,50'), 15000.5);
  assert.equal(v.price('0'), 0);
  for (const value of ['22.000', '1,000.50', '-1', 'NaN', '', '99999999999']) assert.throws(() => v.price(value));
  assert.equal(v.integer('', 'Cantidad', true), null);
  assert.throws(() => v.integer('1.5', 'Cantidad'));
  assert.equal(v.slugify('Vela Cálida'), 'vela-calida');
  assert.throws(() => v.slug('mal slug'));
  assert.equal(v.phone('+54 9 (11) 1234-5678'), '5491112345678');
  assert.throws(() => v.phone('549XXXXXXXXXX'));
  assert.equal(v.image({ name: 'imagen.png', type: 'image/png', size: 1024 }), 'png');
  for (const file of [{ name: 'x.svg', type: 'image/svg+xml', size: 10 }, { name: 'x.jpg', type: 'image/png', size: 10 }, { name: 'x.png', type: 'image/png', size: 6 * 1024 * 1024 }]) assert.throws(() => v.image(file));
});

test('cliente: rechaza secretos y usa sesiones separadas para catálogo y admin', () => {
  const calls = [];
  const root = setup([clientFile], { CALEFICA_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_secret_bad' }, supabase: { createClient(...args) { calls.push(args); return {}; } } });
  assert.throws(() => root.CaleficaSupabase.getClient(), /publicable/);
  root.CALEFICA_CONFIG.supabasePublishableKey = 'sb_publishable_test';
  root.CaleficaSupabase.getClient(); root.CaleficaSupabase.getClient(); root.CaleficaSupabase.getPublicClient();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].auth.persistSession, true);
  assert.equal(calls[1][2].auth.persistSession, false);
  assert.notEqual(calls[0][2].auth.storageKey, calls[1][2].auth.storageKey);
});

test('proveedores: selección explícita, Sheets conserva contrato y Supabase no vuelve a Sheets al fallar', async () => {
  let fetches = 0;
  const root = setup([productsFile], { CALEFICA_CONFIG: { dataProvider: 'sheets' }, fetch: async () => { fetches++; return { ok: true, json: async () => ({ ok: true, productos: [] }) }; } });
  assert.equal((await root.CaleficaProductsService.loadCatalog({ sheetsUrl: 'fixture' })).ok, true);
  root.CALEFICA_CONFIG.dataProvider = 'supabase';
  root.CaleficaSupabase = { getPublicClient() { throw new Error('Sin conexión'); } };
  await assert.rejects(root.CaleficaProductsService.loadCatalog({ sheetsUrl: 'fixture' }), /Sin conexión/);
  assert.equal(fetches, 1);
  root.CALEFICA_CONFIG.dataProvider = 'invalid';
  assert.throws(() => root.CaleficaProductsService.loadCatalog({}), /Proveedor/);
});

function fakePublic(fixtures, signed) {
  return { from(table) {
    return { select(value) { assert.equal(value.includes('product_inventory'), false); return this; }, order() { return this; },
      async range(start, end) { return { data: fixtures[table].slice(start, end + 1) }; },
      then(resolve) { return Promise.resolve({ data: fixtures[table] }).then(resolve); } };
  }, storage: { from(bucket) { assert.equal(bucket, 'product-images'); return { async createSignedUrl(path, seconds) { signed.push([path, seconds]); return { data: { signedUrl: 'https://example.supabase.co/image-signed' } }; } }; } } };
}

test('Supabase: mapea identidad, categorías, disponibilidad y aromas efectivos; nunca lee inventario', async () => {
  const signed = [];
  const fixtures = { products: [{ id: 'p1', external_id: 'vela-antigua', is_active: true, category_id: 'c1', price: '15000.50', sort_order: 0,
    name: 'Vela', description: 'Texto', is_available: false, is_featured: true,
    product_images: [{ id: 'i1', storage_path: 'path1', is_primary: true, sort_order: 1 }],
    product_aromas: [{ aroma_id: 'a1', legacy_aroma_id: 'lavanda-antigua', is_active: true, is_default: true, sort_order: 0, name_override: 'Especial', use_neutral_color: true, aromas: { name: 'Lavanda', color: '#123456', is_active: true } },
      { aroma_id: 'a2', is_active: true, aromas: { name: 'Baja', is_active: false } }] },
    { id: 'p2', is_active: false, category_id: 'c1' }, { id: 'p3', is_active: true, category_id: 'c-hidden' }],
    categories: [{ id: 'c1', name: 'Velas', slug: 'velas', is_active: true, show_when_empty: false }, { id: 'c-hidden', is_active: false }],
    site_settings: [{ key: 'whatsapp_number', value: '5491112345678' }] };
  const root = setup([productsFile], { CALEFICA_CONFIG: { dataProvider: 'supabase' }, CaleficaSupabase: { getPublicClient: () => fakePublic(fixtures, signed), unwrap: result => result.data } });
  const data = await root.CaleficaProductsService.loadCatalog({});
  assert.equal(data.productos.length, 1);
  const product = data.productos[0];
  assert.equal(product.id, 'vela-antigua'); assert.equal(product.stock, 'NO'); assert.equal(product.orden, 0);
  assert.equal(product.precio, 15000.5); assert.equal(product.categoriaId, 'velas');
  assert.equal(product.aromas.length, 1); assert.equal(product.aromas[0].id, 'lavanda-antigua');
  assert.equal(product.aromas[0].nombre, 'Especial'); assert.equal(product.aromas[0].color, null);
  assert.equal(product.whatsapp, '5491112345678'); assert.equal(signed[0][1], 900);
});

test('consultas de catálogo recorren más de una página de Supabase', async () => {
  const fixtures = { products: Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, is_active: true, name: `Producto ${i}`, price: '0', category_id: 'c', product_images: [], product_aromas: [] })), categories: [{ id: 'c', is_active: true }], site_settings: [] };
  const root = setup([productsFile], { CALEFICA_CONFIG: { dataProvider: 'supabase' }, CaleficaSupabase: { getPublicClient: () => fakePublic(fixtures, []), unwrap: result => result.data } });
  assert.equal((await root.CaleficaProductsService.loadCatalog({})).productos.length, 501);
});

test('autorización: una sesión sin membresía no recibe datos administrativos', async () => {
  const sdk = { auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) }, from: table => {
    assert.equal(table, 'admin_users'); return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null }) };
  } };
  const root = setup([adminFile], { CaleficaSupabase: { getClient: () => sdk, unwrap: result => result.data } });
  await assert.rejects(root.CaleficaAdminService.authorize(), error => error.code === '42501');
  await assert.rejects(root.CaleficaAdminService.load(), error => error.code === '42501');
});

test('imagen: si falla el registro después de subir, limpia el archivo y reporta fallo parcial', async () => {
  let removed = false;
  const sdk = { storage: { from: () => ({ upload: async () => ({ data: {} }), remove: async paths => { removed = paths.length === 1; return { data: {} }; } }) },
    from: () => ({ insert() { return this; }, select() { return this; }, single: async () => ({ error: new Error('base caída') }) }) };
  const root = setup([domainFile, adminFile], { crypto: { randomUUID: () => 'new-image' }, CaleficaSupabase: { getClient: () => sdk, unwrap(result) { if (result.error) throw result.error; return result.data; } } });
  await assert.rejects(root.CaleficaAdminService.upload('product', { name: 'x.png', type: 'image/png', size: 10 }, 0), /Se retiró el archivo/);
  assert.equal(removed, true);
});

test('imagen dañada: no se sube si el navegador no puede decodificarla', async () => {
  let uploads = 0;
  const root = setup([domainFile, adminFile], { createImageBitmap: async () => { throw new Error('decode'); },
    CaleficaSupabase: { getClient: () => { uploads++; } } });
  await assert.rejects(root.CaleficaAdminService.upload('product', { name: 'x.png', type: 'image/png', size: 10 }, 0), /archivo no esté dañado/);
  assert.equal(uploads, 0);
});

test('recuperación: URL propia sin tokens, validación de clave y cambio mediante Auth', async () => {
  const calls = [];
  const sdk = { auth: {
    resetPasswordForEmail: async (email, options) => { calls.push(['request', email, options.redirectTo]); return { data: {} }; },
    getUser: async () => ({ data: { user: { id: 'u1' } } }),
    updateUser: async values => { calls.push(['update', values.password]); return { data: {} }; },
    signOut: async () => ({ data: {} }),
  } };
  const root = setup(['js/services/recoveryService.js'], { location: { href: 'http://127.0.0.1:8086/admin/recover.html?x=1#access_token=NO_COMPARTIR' },
    CaleficaSupabase: { getClient: () => sdk, unwrap(result) { if (result.error) throw result.error; return result.data; } } });
  const service = root.CaleficaRecoveryService;
  assert.equal(calls.length, 0);
  await service.request(' admin@example.test ');
  assert.deepEqual(calls[0], ['request', 'admin@example.test', 'http://127.0.0.1:8086/admin/recover.html']);
  await assert.rejects(service.change('corta', 'corta'), /12 caracteres/);
  await assert.rejects(service.change('Nueva-clave-123!', 'diferente'), /no coinciden/);
  await service.change('Nueva-clave-123!', 'Nueva-clave-123!');
  assert.deepEqual(calls[1], ['update', 'Nueva-clave-123!']);
  sdk.auth.getUser = async () => ({ data: { user: null }, error: new Error('expired') });
  await assert.rejects(service.change('Nueva-clave-123!', 'Nueva-clave-123!'), /venció/);
  assert.equal(calls.length, 2);
});

test('detección de sesión en URL habilitada solo para la página de recuperación', () => {
  const calls = [];
  const root = setup([clientFile], { location: { pathname: '/admin/recover.html' },
    CALEFICA_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_fixture' },
    supabase: { createClient(url, key, options) { calls.push(options); return {}; } } });
  root.CaleficaSupabase.getClient(); root.CaleficaSupabase.getPublicClient();
  assert.equal(calls[0].auth.detectSessionInUrl, true);
  assert.equal(calls[1].auth.detectSessionInUrl, false);
});
