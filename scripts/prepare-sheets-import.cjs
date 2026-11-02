const fs = require('node:fs');
const path = require('node:path');
const { prepare, sha256, uuid } = require('./lib/sheets-import.cjs');

function sql(plan) {
  if (plan.errors.length) throw new Error('No se genera SQL con errores de validación.');
  const data = JSON.stringify({ source_system: plan.source_system, categories: plan.categories, aromas: plan.aromas, products: plan.products });
  let tag = '$snapshot_' + sha256(data).slice(0, 16) + '$';
  while (data.includes(tag)) tag = tag.replace('$snapshot_', '$snapshot_x');
  const template = fs.readFileSync(path.join(__dirname, 'lib/catalog-import.sql'), 'utf8');
  let bodyTag = '$body_' + sha256(data).slice(0, 24) + '$';
  while (data.includes(bodyTag)) bodyTag = bodyTag.replace('$body_', '$body_x');
  return template.replaceAll('$calefica_import$', () => bodyTag).replace('__CALEFICA_PAYLOAD__', () => tag + data + tag + '::jsonb');
}

async function downloadImages(plan, output) {
  const directory = path.join(output, 'imagenes');
  fs.mkdirSync(directory, { recursive: true });
  const items = [], errors = [];
  for (const image of plan.images) {
    try {
      const response = await fetch('https://drive.google.com/uc?export=download&id=' + encodeURIComponent(image.drive_id), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Drive respondió HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get('content-type')?.split(';')[0];
      const extension = path.extname(image.filename).slice(1).toLowerCase();
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[extension];
      const signature = mime === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
        : mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === 'image/webp' ? bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
        : mime === 'image/avif' ? bytes.toString('ascii',4,8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii',8,32)) : false;
      if (type !== mime || image.mime_type !== mime || !signature || bytes.length !== image.expected_size || bytes.length > 5242880) throw new Error('El original no coincide en formato/tamaño con el inventario, o supera 5 MiB.');
      const hash = sha256(bytes);
      fs.writeFileSync(path.join(directory, image.filename), bytes);
      items.push({ ...image, size: bytes.length, sha256: hash, image_id: uuid(`${plan.source_system}:image:${image.product_id}:${hash}`),
        storage_path: `products/${image.product_id}/${hash}.${extension}` });
    } catch (error) { errors.push({ external_id: image.external_id, filename: image.filename, message: error.message }); }
  }
  return { schema_version: 1, kind: 'calefica-images', source_system: plan.source_system, source_hash: plan.source_hash, items, errors };
}

async function main(args) {
  const input = args[0];
  if (!input) throw new Error('Uso: node scripts/prepare-sheets-import.cjs <export.json> [--download-images] [--out <carpeta>]');
  const outIndex = args.indexOf('--out');
  const output = path.resolve(outIndex < 0 ? 'imports/calefica' : args[outIndex + 1]);
  const snapshot = JSON.parse(fs.readFileSync(input, 'utf8'));
  const overridesIndex = args.indexOf('--phone-overrides');
  const phoneOverrides = overridesIndex < 0 ? {} : JSON.parse(fs.readFileSync(args[overridesIndex + 1], 'utf8'));
  const plan = prepare(snapshot, { phoneOverrides });
  fs.mkdirSync(output, { recursive: true });
  const destination = path.join(output, path.basename(input));
  if (path.resolve(input) !== destination) fs.copyFileSync(input, destination);
  fs.writeFileSync(path.join(output, 'informe.json'), JSON.stringify(plan, null, 2));
  if (plan.errors.length) { console.log(JSON.stringify({ errors: plan.errors, warnings: plan.warnings })); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(output, 'importar-catalogo.sql'), sql(plan));
  let images;
  if (args.includes('--download-images')) {
    images = await downloadImages(plan, output);
    fs.writeFileSync(path.join(output, 'manifiesto-imagenes.json'), JSON.stringify(images, null, 2));
    if (images.errors.length) process.exitCode = 1;
  }
  console.log(JSON.stringify({ output, ...plan.summary, errors: plan.errors.length, warnings: plan.warnings.length,
    downloaded_images: images?.items.length, image_errors: images?.errors || [] }, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { sql, downloadImages };
