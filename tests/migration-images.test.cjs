const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto, createHash } = require('node:crypto');
const bytes = new Uint8Array([255,216,255,0]);
const sha = createHash('sha256').update(bytes).digest('hex');
const id = '00000000-0000-4000-8000-000000000001';
const image = { product_id: id, image_id: '00000000-0000-4000-8000-000000000002', filename: 'vela.jpg', sha256: sha,
  size: 4, mime_type: 'image/jpeg', sort_order: 0, source_system: 'sheets:fixture', external_id: 'vela', product_name: 'Vela', storage_path: `products/${id}/${sha}.jpg` };
const manifest = () => ({ schema_version: 1, kind: 'calefica-images', source_system: 'sheets:fixture', source_hash: 'a'.repeat(64), items: [{ ...image }], errors: [] });
const file = () => ({ name: 'vela.jpg', type: 'image/jpeg', size: 4, arrayBuffer: async () => bytes.buffer });
function setup(options = {}) {
  const state = { objects: new Map(), rows: [], uploads: 0, inserts: 0 };
  if (options.orphan) state.objects.set(image.storage_path, new Blob([bytes]));
  const storage = {
    async upload(name, blob, config) {
      assert.equal(config.upsert, false); state.uploads++;
      if (state.objects.has(name)) return { error: new Error('Duplicate') };
      state.objects.set(name, new Blob([await blob.arrayBuffer()])); return { data: {} };
    },
    async download(name) { return state.objects.has(name) ? { data: state.objects.get(name) } : { error: new Error('Missing') }; },
    async createSignedUrl() { return { data: { signedUrl: 'https://example.test/signed' } }; },
  };
  const sdk = { storage: { from(bucket) { assert.equal(bucket, 'product-images'); return storage; } }, from(table) {
    let filters = {}, insertion;
    const query = { select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      insert(row) { insertion = row; return this; },
      async in() { return { data: options.missingProduct ? [] : [{ id, source_system: 'sheets:fixture', external_id: 'vela' }] }; },
      async maybeSingle() { return { data: state.rows.find(row => Object.entries(filters).every(([key,value]) => row[key] === value)) || null }; },
      then(resolve, reject) {
        assert.equal(table, 'product_images'); state.inserts++;
        state.rows.push({ ...insertion }); return Promise.resolve({ data: insertion }).then(resolve, reject);
      },
    }; return query;
  } };
  const root = { crypto: webcrypto, CaleficaSupabase: { getClient: () => sdk, unwrap(result) { if (result.error) throw result.error; return result.data; } },
    CaleficaAdminService: { authorize: async () => options.denied ? null : { id: 'admin' } },
    fetch: async () => ({ ok: true, blob: async () => state.objects.get(image.storage_path) }) };
  const context = vm.createContext({ window: root, AbortSignal });
  for (const name of ['js/domain/validation.js','js/services/migrationImagesService.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context);
  return { service: root.CaleficaMigrationImages, state };
}

test('imágenes: valida contenido y manifiesto antes de escribir; rechaza faltantes, duplicados y rutas incorrectas', async () => {
  const { service, state } = setup();
  assert.equal((await service.prepare(manifest(), [file()])).jobs.length, 1);
  await assert.rejects(service.prepare(manifest(), []), /Falta/);
  await assert.rejects(service.prepare(manifest(), [file(),file()]), /dos archivos/);
  await assert.rejects(service.prepare(manifest(), [{ ...file(), arrayBuffer: async () => new Uint8Array([1,2,3,4]).buffer }]), /no coincide/);
  const bad = manifest(); bad.items[0].storage_path = '../escape.jpg';
  assert.throws(() => service.manifest(bad), /rutas/);
  assert.equal(state.uploads, 0);
});

test('imágenes: exige administrador y todos los productos importados antes de la primera subida', async () => {
  for (const options of [{ denied: true }, { missingProduct: true }]) {
    const { service, state } = setup(options);
    await assert.rejects(service.run(await service.prepare(manifest(), [file()])));
    assert.equal(state.uploads, 0); assert.equal(state.rows.length, 0);
  }
});

test('imágenes: sube, asocia y verifica URL; reintento conserva archivo/metadatos sin duplicarlos', async () => {
  const { service, state } = setup();
  const job = await service.prepare(manifest(), [file()]);
  const report = await service.run(job);
  assert.equal(report[0].ok, true); assert.equal(state.uploads, 1); assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].is_primary, true);
  state.rows[0].sort_order = 42;
  const repeated = await service.run(job);
  assert.equal(repeated[0].ok, true); assert.equal(state.uploads, 1); assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].sort_order, 42);
});

test('imágenes: recupera huérfanos verificados y rechaza objetos remotos alterados sin sobrescribirlos', async () => {
  const { service, state } = setup({ orphan: true });
  const job = await service.prepare(manifest(), [file()]);
  assert.equal((await service.run(job))[0].ok, true); assert.equal(state.rows.length, 1);
  state.objects.set(image.storage_path, new Blob(['contenido distinto']));
  assert.equal((await service.run(job))[0].ok, false);
  assert.equal(state.objects.get(image.storage_path).size, 'contenido distinto'.length);
  assert.equal(state.uploads, 1);
});
