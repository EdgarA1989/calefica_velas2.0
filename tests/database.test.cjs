const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// PostgreSQL real en WASM, solo en memoria. Auth/Storage son contratos mínimos
// simulados: no certifica JWT, GoTrue ni la API HTTP de Storage en Supabase.
let db;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = uuid(1), member = uuid(2);
const category = uuid(10), hiddenCategory = uuid(11);
const published = uuid(20), hidden = uuid(21), inHiddenCategory = uuid(22), soldOut = uuid(23);
const activeAroma = uuid(30), inactiveAroma = uuid(31), unusedAroma = uuid(32);
const imagePath = id => `products/${id}/fixture.jpg`;

async function asActor(role, userId, action) {
  assert.ok(['anon', 'authenticated', 'postgres'].includes(role));
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    return await action();
  } finally {
    await db.exec('rollback');
  }
}

const count = async table => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const ids = async table => (await db.query(`select id from ${table} order by id`)).rows.map(row => row.id);
const rejectedAs = (role, id, sql, params, code) => assert.rejects(
  asActor(role, id, () => db.query(sql, params)),
  error => (Array.isArray(code) ? code : [code]).includes(error.code),
);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null,
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  const folder = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(folder, name), 'utf8'));
  }
  await db.query('insert into auth.users (id) values ($1), ($2)', [admin, member]);
  await db.query('insert into public.admin_users (user_id) values ($1)', [admin]);
  await db.query(`insert into public.categories(id, name, slug, is_active)
    values ($1, 'Visible', 'visible', true), ($2, 'Oculta', 'oculta', false)`, [category, hiddenCategory]);
  for (const [id, c, active, available] of [
    [published, category, true, true], [hidden, category, false, true],
    [inHiddenCategory, hiddenCategory, true, true], [soldOut, category, true, false],
  ]) {
    await db.query(`insert into public.products
      (id, name, slug, price, category_id, is_active, is_available)
      values ($1, 'Producto', $2, 1000, $3, $4, $5)`, [id, `producto-${id}`, c, active, available]);
    await db.query('insert into public.product_images(product_id, storage_path, is_primary) values ($1, $2, true)', [id, imagePath(id)]);
    await db.query("insert into storage.objects(bucket_id, name) values ('product-images', $1)", [imagePath(id)]);
  }
  await db.query("insert into public.product_inventory(product_id, quantity, legacy_quantity_text) values ($1, null, 'Pedido interno')", [published]);
  await db.query(`insert into public.aromas(id, name, color, is_active) values
    ($1, 'Lavanda', '#B7A0D4', true), ($2, 'Retirado', null, false), ($3, 'Otro', null, true)`, [activeAroma, inactiveAroma, unusedAroma]);
  await db.query(`insert into public.product_aromas(product_id, aroma_id, legacy_aroma_id, is_active) values
    ($1, $4, 'lavanda', true), ($1, $5, 'retirado', true), ($1, $6, 'baja', false),
    ($2, $4, 'lavanda', true), ($3, $4, 'lavanda', true)`, [published, hidden, inHiddenCategory, activeAroma, inactiveAroma, unusedAroma]);
  await db.exec(`insert into public.site_settings(key, value) values ('business_name', '"Calefica"');
    insert into storage.buckets(id, name) values ('other-bucket', 'other-bucket');
    insert into storage.objects(bucket_id, name) values
      ('product-images', 'orphan.jpg'), ('other-bucket', 'private.jpg');`);
});

after(async () => { if (db) await db.close(); });

test('visitante: publicados y agotados visibles; categoría/productos ocultos no aparecen ni por join', async () => {
  await asActor('anon', null, async () => {
    assert.deepEqual(await ids('public.products'), [published, soldOut]);
    assert.deepEqual(await ids('public.categories'), [category]);
    assert.equal(await count('public.product_images'), 2);
    assert.equal(await count('public.product_aromas'), 1);
    const joined = await db.query(`select p.id from public.products p
      join public.product_images i on i.product_id = p.id
      join public.categories c on c.id = p.category_id order by p.id`);
    assert.deepEqual(joined.rows.map(row => row.id), [published, soldOut]);
    assert.deepEqual(await ids('public.aromas'), [activeAroma, unusedAroma]);
    assert.equal(await count('public.site_settings'), 1);
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, false);
  });
  await rejectedAs('anon', null, 'select * from public.product_inventory', [], '42501');
  await rejectedAs('anon', null, 'select * from public.admin_users', [], '42501');
});

test('autenticado sin membresía: lectura pública sin acceso a inventario ni altas de admin', async () => {
  await asActor('authenticated', member, async () => {
    assert.deepEqual(await ids('public.products'), [published, soldOut]);
    assert.equal(await count('public.product_inventory'), 0);
    assert.equal(await count('public.admin_users'), 0);
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, false);
  });
  await rejectedAs('authenticated', member, 'insert into public.admin_users(user_id) values ($1)', [member], '42501');
});

test('visitantes no escriben; autenticados sin rol no insertan ni actualizan/borran filas visibles', async () => {
  await rejectedAs('anon', null, "insert into public.categories(name, slug) values ('Intruso', 'intruso')", [], '42501');
  await rejectedAs('authenticated', member, "insert into public.categories(name, slug) values ('Intruso', 'intruso')", [], '42501');
  await asActor('authenticated', member, async () => {
    assert.equal((await db.query("update public.products set name = 'Alterado' where id = $1 returning id", [published])).rows.length, 0);
    assert.equal((await db.query('delete from public.products where id = $1 returning id', [published])).rows.length, 0);
    assert.equal((await db.query("update public.site_settings set value = '\"Alterado\"' returning key")).rows.length, 0);
  });
});

test('administrador: lee ocultos e inventario, CRUD completo y permisos sin recursión', async () => {
  await asActor('authenticated', admin, async () => {
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, true);
    assert.equal(await count('public.products'), 4);
    assert.equal(await count('public.product_inventory'), 1);
    assert.equal(await count('public.admin_users'), 1);
    assert.equal(await count('public.product_aromas'), 5);
    await db.query("insert into public.categories(id, name, slug) values ($1, 'Nueva', 'nueva')", [uuid(80)]);
    await db.query(`insert into public.products(id, name, slug, price, category_id)
      values ($1, 'Nuevo', 'nuevo', 1500, $2)`, [uuid(81), uuid(80)]);
    await db.query('insert into public.product_inventory(product_id, quantity) values ($1, 5)', [uuid(81)]);
    await db.query('insert into public.aromas(id, name) values ($1, $2)', [uuid(82), 'Nuevo aroma']);
    await db.query('insert into public.product_aromas(product_id, aroma_id) values ($1, $2)', [uuid(81), uuid(82)]);
    await db.query('insert into public.product_images(product_id, storage_path) values ($1, $2)', [uuid(81), imagePath(uuid(81))]);
    await db.exec(`insert into public.site_settings(key, value) values ('currency', '"ARS"');
      update public.site_settings set value = '"Calefica editada"' where key = 'business_name';`);
    await db.query('update public.products set price = 2000, is_active = true where id = $1', [uuid(81)]);
    assert.equal((await db.query('select price from public.products where id = $1', [uuid(81)])).rows[0].price, '2000.00');
    await db.query('delete from public.products where id = $1', [uuid(81)]);
    assert.equal((await db.query('select * from public.product_inventory where product_id = $1', [uuid(81)])).rows.length, 0);
    await db.query('delete from public.aromas where id = $1', [uuid(82)]);
    await db.query('delete from public.categories where id = $1', [uuid(80)]);
    await db.exec("delete from public.site_settings where key = 'currency'");
  });
});

test('ni un administrador puede otorgar, modificar o revocar membresías desde el cliente', async () => {
  await rejectedAs('authenticated', admin, 'insert into public.admin_users(user_id) values ($1)', [member], '42501');
  await rejectedAs('authenticated', admin, "update public.admin_users set role = 'admin'", [], '42501');
  await rejectedAs('authenticated', admin, 'delete from public.admin_users where user_id = $1', [admin], '42501');
});

test('membresía revocada y sesión sin uid pierden permisos inmediatamente en PostgreSQL', async () => {
  await asActor('postgres', null, async () => {
    await db.query('delete from public.admin_users where user_id = $1', [admin]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin]);
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, false);
    assert.equal(await count('public.product_inventory'), 0);
    assert.deepEqual(await ids('public.products'), [published, soldOut]);
  });
  await asActor('authenticated', null, async () => {
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, false);
    assert.equal(await count('public.admin_users'), 0);
    assert.equal(await count('public.product_inventory'), 0);
  });
});

test('Storage: público ve solo imágenes vinculadas a productos publicados; admin ve huérfanos del bucket', async () => {
  for (const [role, user] of [['anon', null], ['authenticated', member]]) {
    await asActor(role, user, async () => {
      const result = await db.query('select name from storage.objects order by name');
      assert.deepEqual(result.rows.map(row => row.name), [imagePath(published), imagePath(soldOut)]);
    });
  }
  await asActor('authenticated', admin, async () => {
    assert.equal(await count('storage.objects'), 5);
    assert.equal((await db.query("select * from storage.objects where bucket_id = 'other-bucket'")).rows.length, 0);
  });
});

test('Storage: escritura solo por admin, rutas válidas y producto existente; otros buckets bloqueados', async () => {
  for (const [role, user] of [['anon', null], ['authenticated', member]]) {
    await rejectedAs(role, user, "insert into storage.objects(bucket_id, name) values ('product-images', $1)", [`products/${published}/new.png`], '42501');
    await asActor(role, user, async () => {
      assert.equal((await db.query("update storage.objects set name = 'stolen.jpg' returning id")).rows.length, 0);
      assert.equal((await db.query('delete from storage.objects returning id')).rows.length, 0);
    });
  }
  await asActor('authenticated', admin, async () => {
    const object = await db.query("insert into storage.objects(bucket_id, name) values ('product-images', $1) returning id", [`products/${hidden}/new.png`]);
    await db.query('update storage.objects set name = $1 where id = $2', [`products/${hidden}/renamed.webp`, object.rows[0].id]);
    assert.equal((await db.query('delete from storage.objects where id = $1 returning id', [object.rows[0].id])).rows.length, 1);
    assert.equal((await db.query("delete from storage.objects where name = 'orphan.jpg' returning id")).rows.length, 1);
  });
  for (const invalid of ['invalid.jpg', `products/${uuid(999)}/missing.jpg`, `products/${published}/../bad.jpg`, `products/${published}/bad.svg`]) {
    await rejectedAs('authenticated', admin, "insert into storage.objects(bucket_id, name) values ('product-images', $1)", [invalid], '42501');
  }
  await rejectedAs('authenticated', admin, "insert into storage.objects(bucket_id, name) values ('other-bucket', $1)", [imagePath(published)], '42501');
  await rejectedAs('authenticated', admin, "update storage.objects set bucket_id = 'other-bucket' where name = $1", [imagePath(published)], '42501');
});

test('ocultar producto o categoría retira también acceso a sus metadatos y objetos Storage', async () => {
  for (const sql of [
    `update public.products set is_active = false where id = '${published}'`,
    `update public.categories set is_active = false where id = '${category}'`,
  ]) {
    await asActor('postgres', null, async () => {
      await db.exec(sql);
      await db.exec('set local role anon');
      assert.equal((await db.query('select * from public.products where id = $1', [published])).rows.length, 0);
      assert.equal((await db.query('select * from public.product_images where product_id = $1', [published])).rows.length, 0);
      assert.equal((await db.query('select * from public.product_aromas where product_id = $1', [published])).rows.length, 0);
      assert.equal((await db.query('select * from storage.objects where name = $1', [imagePath(published)])).rows.length, 0);
    });
  }
});

test('restricciones: precio/cantidad/color/identidad/primaria/predeterminado y configuración pública', async () => {
  const invalids = [
    ['update public.products set price = -1 where id = $1', [published], '23514'],
    ["update public.products set price = 'NaN' where id = $1", [published], '23514'],
    ['update public.product_inventory set quantity = -1 where product_id = $1', [published], '23514'],
    ["update public.products set source_system = 'sheets:fixture' where id = $1", [published], '23514'],
    ["update public.aromas set color = 'red' where id = $1", [activeAroma], '23514'],
    ["insert into public.site_settings(key, value) values ('secret_key', '\"private\"')", [], '23514'],
    ["insert into public.site_settings(key, value) values ('business_description', '{\"secret\":true}')", [], '23514'],
    ["insert into public.site_settings(key, value) values ('instagram_url', '\"javascript:alert(1)\"')", [], '23514'],
    ["insert into public.site_settings(key, value) values ('currency', '\"USD\"')", [], '23514'],
    ['insert into public.product_images(product_id, storage_path, is_primary) values ($1, $2, true)', [published, `products/${published}/second.jpg`], '23505'],
    ['insert into public.product_images(product_id, storage_path) values ($1, $2)', [published, imagePath(hidden)], '23514'],
    // PostgreSQL 18 distingue restrict_violation (23001); versiones anteriores
    // usan foreign_key_violation (23503). Ambas deben impedir el borrado.
    ['delete from public.categories where id = $1', [category], ['23001', '23503']],
    ['delete from public.aromas where id = $1', [activeAroma], ['23001', '23503']],
  ];
  for (const [sql, params, code] of invalids) await rejectedAs('authenticated', admin, sql, params, code);
  await assert.rejects(asActor('authenticated', admin, async () => {
    await db.query('update public.product_aromas set is_default = true where product_id = $1 and aroma_id = $2', [published, activeAroma]);
    await db.query('update public.product_aromas set is_default = true where product_id = $1 and aroma_id = $2', [published, inactiveAroma]);
  }), error => error.code === '23505');
  await assert.rejects(asActor('authenticated', admin, async () => {
    await db.query("update public.products set source_system = 'sheets:fixture', external_id = 'same' where id = $1", [published]);
    await db.query("update public.products set source_system = 'sheets:fixture', external_id = 'same' where id = $1", [hidden]);
  }), error => error.code === '23505');
});

test('cantidad interna y disponibilidad comercial independientes; updated_at se actualiza', async () => {
  await asActor('authenticated', admin, async () => {
    await db.query('update public.product_inventory set quantity = 0 where product_id = $1', [published]);
    assert.equal((await db.query('select is_available from public.products where id = $1', [published])).rows[0].is_available, true);
    const result = await db.query("update public.products set updated_at = '2000-01-01', name = 'Editado' where id = $1 returning updated_at", [published]);
    assert.ok(new Date(result.rows[0].updated_at).getUTCFullYear() > 2000);
  });
});

test('todas las tablas de catálogo tienen RLS; helpers privados con search_path fijo y bucket privado', async () => {
  const result = await db.query("select relname, relrowsecurity from pg_class join pg_namespace n on n.oid = relnamespace where n.nspname = 'public' and relkind = 'r'");
  assert.equal(result.rows.length, 8);
  assert.ok(result.rows.every(row => row.relrowsecurity));
  const helper = (await db.query("select prosecdef, proconfig from pg_proc join pg_namespace n on n.oid = pronamespace where n.nspname = 'private' and proname = 'is_admin'")).rows[0];
  assert.equal(helper.prosecdef, true);
  assert.ok(helper.proconfig.some(value => value.startsWith('search_path=')));
  const bucket = (await db.query("select * from storage.buckets where id = 'product-images'")).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 5242880);
  assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
});

test('script de verificación estructural funciona y no cambia datos', async () => {
  const previous = await count('public.products');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'manual', 'verify_setup.sql'), 'utf8');
  await db.exec(sql);
  assert.equal(await count('public.products'), previous);
});

test('alta manual de admin: exige UUID existente, se puede repetir y solo se ejecuta con privilegios', async () => {
  // El usuario puede haber completado su UUID en el archivo manual. Las pruebas
  // siempre sustituyen esa asignación por un marcador y usan fixtures en memoria.
  const template = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'manual', 'grant_admin.sql'), 'utf8')
    .replace(/target_user_text text := '[^']*'/, "target_user_text text := 'REEMPLAZAR_UUID_DEL_USUARIO_AUTH'");
  const forUser = id => template.replace(
    "target_user_text text := 'REEMPLAZAR_UUID_DEL_USUARIO_AUTH'",
    `target_user_text text := '${id}'`,
  );
  await assert.rejects(asActor('postgres', null, () => db.exec(template)), /Reemplazar el marcador/);
  await assert.rejects(asActor('postgres', null, () => db.exec(forUser(uuid(999)))), /no existe en auth.users/);
  await asActor('postgres', null, async () => {
    await db.exec(forUser(member));
    await db.exec(forUser(member));
    assert.equal(await count('public.admin_users'), 2);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [member]);
    assert.equal((await db.query('select private.is_admin() as allowed')).rows[0].allowed, true);
  });
  await assert.rejects(asActor('authenticated', admin, () => db.exec(forUser(member))), error => error.code === '42501');
});

const productPayload = extra => ({ name: 'Vela nueva', slug: 'vela-nueva', price: 12000, category_id: category,
  sort_order: 5, is_active: true, is_available: true, is_featured: false, quantity: 3,
  aroma_ids: [activeAroma], default_aroma_id: activeAroma, ...extra });

test('RPC producto: permisos, creación atómica, edición sin perder identidad y conflicto de otra sesión', async () => {
  await rejectedAs('anon', null, 'select public.admin_save_product($1)', [productPayload()], '42501');
  await rejectedAs('authenticated', member, 'select public.admin_save_product($1)', [productPayload()], '42501');
  await asActor('authenticated', admin, async () => {
    const id = (await db.query('select public.admin_save_product($1) as id', [productPayload()])).rows[0].id;
    const row = (await db.query('select *, updated_at::text as exact_updated_at from public.products where id = $1', [id])).rows[0];
    assert.equal(row.price, '12000.00');
    assert.equal((await db.query('select quantity from public.product_inventory where product_id = $1', [id])).rows[0].quantity, 3);
    assert.equal((await db.query('select is_default from public.product_aromas where product_id = $1', [id])).rows[0].is_default, true);
    await db.query("update public.product_aromas set legacy_aroma_id = 'old-lavanda', name_override = 'Nombre particular' where product_id = $1", [id]);
    await db.query('select public.admin_save_product($1)', [productPayload({ id, expected_updated_at: row.exact_updated_at, quantity: 0, aroma_ids: [], default_aroma_id: null })]);
    const link = (await db.query('select * from public.product_aromas where product_id = $1', [id])).rows[0];
    assert.equal(link.is_active, false); assert.equal(link.legacy_aroma_id, 'old-lavanda');
    assert.equal(link.name_override, 'Nombre particular');
    const updated = (await db.query('select *, updated_at::text as exact_updated_at from public.products where id = $1', [id])).rows[0];
    await db.query('select public.admin_save_product($1)', [productPayload({ id, expected_updated_at: updated.exact_updated_at })]);
    const restored = (await db.query('select * from public.product_aromas where product_id = $1', [id])).rows[0];
    assert.equal(restored.is_active, true); assert.equal(restored.legacy_aroma_id, 'old-lavanda');
    const latest = (await db.query('select updated_at::text as exact from public.products where id = $1', [id])).rows[0];
    await db.query('select public.admin_save_product($1)', [productPayload({ id, expected_updated_at: latest.exact, default_aroma_id: '' })]);
    assert.equal((await db.query('select is_default from public.product_aromas where product_id = $1', [id])).rows[0].is_default, false);
  });
  await assert.rejects(asActor('authenticated', admin, () => db.query('select public.admin_save_product($1)',
    [productPayload({ id: published, expected_updated_at: '2000-01-01' })])), error => error.code === '40001');
});

test('RPC producto: un error en inventario/aromas revierte también la creación del producto', async () => {
  for (const extra of [{ quantity: -1 }, { aroma_ids: [uuid(999)] }, { aroma_ids: [], default_aroma_id: activeAroma }]) {
    await asActor('authenticated', admin, async () => {
      await db.exec('savepoint invalid_product');
      await assert.rejects(db.query('select public.admin_save_product($1)', [productPayload(extra)]));
      await db.exec('rollback to savepoint invalid_product');
      assert.equal((await db.query("select * from public.products where slug = 'vela-nueva'")).rows.length, 0);
    });
  }
});

test('RPC imagen primaria: comprueba permisos y pertenencia y mantiene una sola primaria', async () => {
  await rejectedAs('authenticated', member, 'select public.admin_set_primary_image($1, $2)', [published, uuid(900)], '42501');
  await asActor('authenticated', admin, async () => {
    const image = (await db.query('insert into public.product_images(product_id, storage_path) values ($1, $2) returning id', [published, `products/${published}/second.png`])).rows[0];
    await db.query('select public.admin_set_primary_image($1, $2)', [published, image.id]);
    const primary = (await db.query('select id from public.product_images where product_id = $1 and is_primary', [published])).rows;
    assert.deepEqual(primary.map(row => row.id), [image.id]);
    await db.exec('savepoint wrong_image');
    await assert.rejects(db.query('select public.admin_set_primary_image($1, $2)', [hidden, image.id]), error => error.code === '22023');
    await db.exec('rollback to savepoint wrong_image');
    assert.equal((await db.query('select is_primary from public.product_images where id = $1', [image.id])).rows[0].is_primary, true);
  });
});

test('RPC configuración: valida todas las claves y revierte el lote entero si una es inválida', async () => {
  await rejectedAs('authenticated', member, 'select public.admin_save_settings($1)', [{ business_name: 'Intruso' }], '42501');
  await asActor('authenticated', admin, async () => {
    await db.query('select public.admin_save_settings($1)', [{ business_name: 'Editada', currency: 'ARS' }]);
    assert.equal((await db.query("select value from public.site_settings where key = 'business_name'")).rows[0].value, 'Editada');
    await db.exec('savepoint bad_settings');
    await assert.rejects(db.query('select public.admin_save_settings($1)', [{ business_name: 'Incorrecta', whatsapp_number: 'NO' }]));
    await db.exec('rollback to savepoint bad_settings');
    assert.equal((await db.query("select value from public.site_settings where key = 'business_name'")).rows[0].value, 'Editada');
    await db.query('select public.admin_save_settings($1)', [{ currency: null }]);
    assert.equal((await db.query("select value from public.site_settings where key = 'currency'")).rows.length, 0);
  });
});
