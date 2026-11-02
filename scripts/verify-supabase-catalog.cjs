// Solo lecturas públicas: catálogo, permisos y URLs de imágenes. No escribe en Supabase.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = path.resolve(process.argv[2] || path.join(root, 'imports/calefica'));
  const expected = JSON.parse(fs.readFileSync(path.join(directory, 'informe.json'), 'utf8'));
  const images = JSON.parse(fs.readFileSync(path.join(directory, 'manifiesto-imagenes.json'), 'utf8'));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), context);
  const config = context.window.CALEFICA_CONFIG;
  const db = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const get = result => { if (result.error) throw new Error(result.error.message); return result.data; };
  const [products, categories] = await Promise.all([
    db.from('products').select('*,product_images(*),product_aromas(*,aromas(*))').order('sort_order').limit(1000).then(get),
    db.from('categories').select('*').order('sort_order').then(get),
  ]);
  const checks = [], priceDifferences = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  const expectedPublic = expected.products.filter(p => p.is_active && expected.categories.find(c => c.id === p.category_id)?.is_active);
  check('Cantidad de productos publicados', products.length === expectedPublic.length);
  check('Categorías publicadas', categories.length === expected.categories.filter(c => c.is_active).length);
  let verifiedImages = 0;
  for (const p of expected.products) {
    const row = products.find(product => product.id === p.id);
    if (!expectedPublic.some(product => product.id === p.id)) { check(`Oculto: ${p.external_id}`, !row); continue; }
    const priceChanged = row && Number(row.price) !== p.price;
    if (priceChanged) priceDifferences.push({ product: p.external_id, snapshot: p.price, current: Number(row.price) });
    const categoryMatches = row && categories.find(c => c.id === row.category_id)?.slug === expected.categories.find(c => c.id === p.category_id)?.slug;
    check(`Datos: ${p.external_id}`, row && categoryMatches && ['external_id','name','description','sort_order','is_available','is_featured','whatsapp_override'].every(field => row[field] === p[field]) && Number.isFinite(Number(row.price)) && Number(row.price) >= 0 && (!priceChanged || process.argv.includes('--allow-price-edits')));
    check(`Aromas: ${p.external_id}`, row && row.product_aromas.length === p.aromas.filter(a => a.is_active).length && p.aromas.every(a => {
      const link = row.product_aromas.find(link => link.legacy_aroma_id === a.legacy_aroma_id);
      return !a.is_active || link && link.is_default === a.is_default && link.is_active && link.aromas?.is_active;
    }));
    const original = images.items.find(image => image.product_id === p.id);
    const reference = row?.product_images.find(image => image.storage_path === original?.storage_path);
    let imageOK = false;
    if (reference) {
      try {
        const signed = get(await db.storage.from('product-images').createSignedUrl(reference.storage_path, 60));
        const response = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(15000) });
        const hash = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
        imageOK = response.ok && hash === original.sha256;
      } catch { imageOK = false; }
    }
    check(`Imagen pública: ${p.external_id}`, imageOK);
    if (imageOK) verifiedImages++;
  }
  for (const table of ['product_inventory','admin_users']) {
    const result = await db.from(table).select('*').limit(1);
    check(`Acceso anónimo denegado: ${table}`, result.error?.code === '42501');
  }
  const hidden = images.items.find(image => !expectedPublic.some(p => p.id === image.product_id));
  if (hidden) check('Firma anónima de imagen oculta denegada', !!(await db.storage.from('product-images').createSignedUrl(hidden.storage_path, 60)).error);
  const settings = await fetch(config.supabaseUrl + '/auth/v1/settings', { headers: { apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(15000) });
  check('Registro público deshabilitado', settings.ok && (await settings.json()).disable_signup === true);
  const report = { checked_at: new Date().toISOString(), public_products: products.length, verified_public_images: verifiedImages, price_differences: priceDifferences,
    failed_checks: checks.filter(c => !c.ok), checks };
  fs.writeFileSync(path.join(directory, 'verificacion-publica.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ public_products: products.length, verified_public_images: verifiedImages, checks: checks.length, price_differences: priceDifferences, failed: report.failed_checks }, null, 2));
  if (report.failed_checks.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
