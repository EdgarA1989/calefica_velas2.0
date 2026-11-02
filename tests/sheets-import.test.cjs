const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { prepare, uuid } = require('../scripts/lib/sheets-import.cjs');
const { sql } = require('../scripts/prepare-sheets-import.cjs');
const headers = ['id','activo','orden','categoria','nombre','descripcion','aroma','precio','nombreImagen','whatsapp','stock','cantidadStock','destacado'];
function snapshot() {
  const row = (id, category, active, stock, quantity, index) => ({ row_number: index + 2,
    values: [id,active,index+1,category,`Vela ${id}`,'Descripción','Lavanda',index?12000:0,`${id}.jpg`,'5491112345678',stock,quantity,'NO'],
    aroma_validation: { type: 'VALUE_IN_LIST', options: ['Lavanda', 'Coco', 'Frutos Rojos'] } });
  return { schema_version: 1, exported_at: '2026-11-02T00:00:00Z', source: { spreadsheet_id: 'sheet-fixture' }, warnings: [],
    sheets: { productos: { headers, rows: [row('p1','Velas aromáticas','SI','SI',0,0),row('p2','Velas clásicas','SI','SI','A pedido',1),row('p3','Souvenir','NO','NO','',2)] }, aromas: null },
    images: { status: 'complete', files: ['p1','p2','p3'].map((id,i) => ({ id: 'drive'+i, name: id+'.jpg', mime_type: 'image/jpeg', size: 123 })) } };
}

test('plan: conserva ceros/ocultos, excluye Clásicas por categoría y mantiene todas las opciones e IDs anteriores', () => {
  const plan = prepare(snapshot());
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.summary.products, 3); assert.equal(plan.summary.published, 1);
  assert.equal(plan.products[0].price, 0); assert.equal(plan.products[0].inventory.quantity, 0);
  assert.equal(plan.products[1].inventory.quantity, null); assert.equal(plan.products[1].inventory.legacy_quantity_text, 'A pedido');
  assert.equal(plan.categories.find(c => c.slug === 'velas-clasicas').is_active, false);
  assert.equal(plan.categories.find(c => c.slug === 'souvenir').show_when_empty, true);
  assert.equal(plan.products[0].aromas.length, 3);
  assert.equal(plan.products[0].aromas[2].legacy_aroma_id, 'frutos rojos');
  assert.equal(plan.aromas[0].color, null);
  assert.equal(prepare(snapshot()).products[0].id, plan.products[0].id);
});

test('plan: rechaza IDs repetidos, precios ambiguos, nombres de imagen repetidos y teléfonos de ejemplo', () => {
  const d = snapshot();
  d.sheets.productos.rows[1].values[0] = 'p1';
  d.sheets.productos.rows[0].values[7] = '22.000';
  d.sheets.productos.rows[0].values[9] = '549XXXXXXXXXX';
  d.images.files.push({ ...d.images.files[0], id: 'duplicate' });
  const plan = prepare(d);
  for (const field of ['id','precio','nombreImagen','whatsapp']) assert.ok(plan.errors.some(error => error.field === field));
  assert.throws(() => sql(plan), /errores/);
});

test('plan: correcciones explícitas sin cambiar el snapshot; formatos heredados y aromas retirados se preservan', () => {
  const d = snapshot(); d.sheets.productos.rows[0].values[9] = '549XXXXXXXXXX';
  d.sheets.productos.rows[0].aroma_validation = null;
  d.sheets.productos.rows[0].values[6] = 'Lavanda|#112233|SI|1|SI|old;Retirado|#445566|NO|2|NO|retirado';
  const plan = prepare(d, { phoneOverrides: { p1: '5491198765432' } });
  assert.equal(plan.errors.length, 0); assert.equal(plan.corrections.length, 1);
  assert.equal(d.sheets.productos.rows[0].values[9], '549XXXXXXXXXX');
  assert.equal(plan.products[0].whatsapp_override, '5491198765432');
  assert.equal(plan.products[0].aromas[0].legacy_aroma_id, 'old');
  assert.equal(plan.products[0].aromas[0].is_default, true);
  assert.equal(plan.products[0].aromas[1].is_active, false);
});

test('plan: conserva maestro inactivo y sus asociaciones sin publicarlo', () => {
  const d = snapshot();
  d.sheets.aromas = { headers: ['nombre','color','activo','orden','predeterminado','id'], rows: [
    { values: ['Lavanda','#112233','NO',0,'SI','lavanda'] }, { values: ['Coco','#445566','SI',1,'NO','coco'] },
  ] };
  const plan = prepare(d);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.aromas.find(a => a.legacy_id === 'lavanda').is_active, false);
  assert.equal(plan.products[0].aromas[0].legacy_aroma_id, 'lavanda');
  assert.equal(plan.products[0].aromas[0].is_default, false);
});

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261030000100_catalog_schema.sql'), 'utf8'));
});
after(async () => { if (db) await db.close(); });
const count = async table => Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n);

test('SQL: importa todo, segunda ejecución no duplica ni altera timestamps; variantes y datos privados se conservan', async () => {
  const plan = prepare(snapshot());
  await db.exec(sql(plan));
  const before = await db.query('select id, updated_at::text as stamp from public.products order by id');
  await db.exec(sql(plan));
  assert.equal(await count('products'), 3); assert.equal(await count('categories'), 3); assert.equal(await count('aromas'), 3);
  assert.equal(await count('product_inventory'), 3); assert.equal(await count('product_aromas'), 9);
  assert.deepEqual((await db.query('select id, updated_at::text as stamp from public.products order by id')).rows, before.rows);
  await db.exec('set role anon');
  assert.equal(await count('products'), 1);
  assert.equal(await count('product_aromas'), 3);
  await db.exec('reset role');
});

test('SQL: un cambio del administrador detiene el lote y no lo sobrescribe; tampoco deja filas nuevas parciales', async () => {
  const d = snapshot();
  const newRow = structuredClone(d.sheets.productos.rows[0]); newRow.values[0] = 'extra'; newRow.values[8] = 'p1.jpg';
  d.sheets.productos.rows.unshift(newRow);
  await db.exec("update public.products set price = 999 where external_id = 'p1'");
  await assert.rejects(db.exec(sql(prepare(d))), /ya existe con datos/);
  await db.exec('rollback');
  assert.equal(await count('products'), 3);
  assert.equal((await db.query("select price from public.products where external_id = 'p1'")).rows[0].price, '999.00');
  await db.exec("update public.products set price = 0 where external_id = 'p1'");
});

test('SQL: reutiliza categorías/aromas iguales con otros UUID y no duplica productos manuales por slug', async () => {
  const d = snapshot(); d.source.spreadsheet_id = 'other-sheet';
  await db.exec(`insert into public.products(name, slug, price, category_id) select 'Manual', 'new-slug', 100, id from public.categories limit 1`);
  d.sheets.productos.rows[0].values[0] = 'new-slug';
  await assert.rejects(db.exec(sql(prepare(d))), /ya pertenece a un producto/);
  await db.exec('rollback');
  assert.equal(await count('products'), 4);
  await db.exec("delete from public.products where slug = 'new-slug'");
  // Fuente diferente: mismas categorías y aromas, nuevos productos e IDs de origen.
  d.sheets.productos.rows[0].values[0] = 'other-p1';
  d.sheets.productos.rows[1].values[0] = 'other-p2';
  d.sheets.productos.rows[2].values[0] = 'other-p3';
  await db.exec(sql(prepare(d)));
  assert.equal(await count('categories'), 3); assert.equal(await count('aromas'), 3); assert.equal(await count('products'), 6);
});

test('SQL: textos con comillas y delimitadores SQL se importan como datos', async () => {
  const d = snapshot(); d.source.spreadsheet_id = 'escaping-sheet';
  d.sheets.productos.rows.forEach((row,i) => { row.values[0] = i ? 'escaping-'+i : 'escaping'; });
  const description = `O'Brien $calefica_import$; drop table public.products; -- $$ 🕯️`;
  d.sheets.productos.rows[0].values[5] = description;
  await db.exec(sql(prepare(d)));
  assert.equal((await db.query("select description from public.products where external_id = 'escaping'")).rows[0].description, description);
  assert.equal(await count('products'), 9);
  assert.match(uuid('same-source'), /^[0-9a-f-]{36}$/);
});
