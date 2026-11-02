// Ensayo local del SQL generado. No hay conexión con Supabase.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
async function main() {
  if (!process.argv[2]) throw new Error('Indicar el archivo SQL generado.');
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261030000100_catalog_schema.sql'), 'utf8'));
    const sql = fs.readFileSync(process.argv[2], 'utf8');
    await db.exec(sql);
    const tables = ['categories','aromas','products','product_inventory','product_aromas'];
    const first = {}, counts = {};
    for (const table of tables) {
      first[table] = (await db.query(`select * from public.${table} order by to_jsonb(${table})::text`)).rows;
      counts[table] = first[table].length;
    }
    await db.exec(sql);
    for (const table of tables) assert.deepEqual((await db.query(`select * from public.${table} order by to_jsonb(${table})::text`)).rows, first[table]);
    await db.exec('set role anon');
    const published = (await db.query('select count(*) as n from public.products')).rows[0].n;
    console.log(JSON.stringify({ local_only: true, counts, public_products: Number(published), repeat_without_changes: true }, null, 2));
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
