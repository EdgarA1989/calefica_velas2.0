const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const namespace = Buffer.from('987cae6a2cd34b998787b4668fe597fa', 'hex');
function uuid(value) {
  const bytes = crypto.createHash('sha1').update(namespace).update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const s = bytes.toString('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => String(value ?? '').trim();
const slug = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function prepare(snapshot, options = {}) {
  const errors = [], warnings = [...(snapshot.warnings || [])], corrections = [];
  const problem = (row, field, message) => errors.push({ row, field, message });
  if (snapshot.schema_version !== 1 || !snapshot.source?.spreadsheet_id || !snapshot.sheets?.productos?.rows) {
    return { errors: [{ message: 'Formato de exportación no válido.' }], warnings };
  }
  const source = `sheets:${snapshot.source.spreadsheet_id}`;
  const sheet = snapshot.sheets.productos;
  const headers = sheet.headers;
  if (!Array.isArray(headers) || new Set(headers).size !== headers.length) {
    return { errors: [{ message: 'Encabezados inválidos o repetidos.' }], warnings };
  }
  const required = ['id','activo','orden','categoria','nombre','descripcion','precio','nombreImagen','whatsapp','stock','cantidadStock','destacado'];
  required.forEach(header => { if (!headers.includes(header)) problem(1, header, 'Falta la columna requerida.'); });
  if (!headers.includes('aroma') && !headers.includes('aromas')) problem(1, 'aroma', 'Falta aroma/aromas.');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../google-apps-script/catalogo-productos.gs'), 'utf8'), context);
  let master = null;
  if (snapshot.sheets.aromas) {
    const a = snapshot.sheets.aromas;
    try { master = context.readAromaCatalog({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [a.headers, ...a.rows.map(row => row.values)] }) }) }); }
    catch (error) { problem(1, 'aromas', error.message); }
  }
  const categories = new Map(), aromas = new Map(), products = [], externalIds = new Set(), slugs = new Set();
  function bool(value, row, field) {
    const v = key(value).toUpperCase();
    if (['SI','YES','TRUE'].includes(v)) return true;
    if (['NO','FALSE'].includes(v)) return false;
    if (!v) { warnings.push({ row, field, code: 'blank_flag', message: 'Vacío: se conserva el NO efectivo de Apps Script.' }); return false; }
    problem(row, field, 'Usar SI o NO.'); return false;
  }
  function aromaBase(item) {
    const id = text(item.id);
    if (!aromas.has(id)) aromas.set(id, { id: uuid(`${source}:aroma:${id}`), legacy_id: id, name: item.nombre,
      color: item.color || null, is_active: item.activo !== false, sort_order: item.orden });
    return aromas.get(id);
  }
  if (master) master.forEach(aromaBase);
  for (const row of sheet.rows) {
    if (!Array.isArray(row.values)) { problem(row.row_number, '', 'Fila inválida.'); continue; }
    if (row.values.every(value => text(value) === '')) continue;
    const r = Object.fromEntries(headers.map((header, index) => [header, row.values[index]]));
    const number = row.row_number, externalId = text(r.id), name = text(r.nombre), productSlug = slug(externalId);
    if (!externalId || externalIds.has(externalId)) problem(number, 'id', 'ID vacío o duplicado.');
    externalIds.add(externalId);
    if (!productSlug || slugs.has(productSlug)) problem(number, 'id', 'El ID produce un identificador URL vacío o repetido.');
    slugs.add(productSlug);
    if (!name || name.length > 240) problem(number, 'nombre', 'Nombre requerido, máximo 240 caracteres.');
    const aliases = { aromaticas: 'Velas aromaticas', decorativas: 'Velas decorativas', combos: 'Combos / regalos', extras: 'Difusores y extras' };
    const categoryName = aliases[r.categoria] || text(r.categoria) || 'Sin categoria';
    const categorySlug = slug(categoryName);
    if (!categorySlug || categoryName.length > 160) problem(number, 'categoria', 'Categoría no válida.');
    if (categories.has(categorySlug) && categories.get(categorySlug).name !== categoryName) problem(number, 'categoria', 'Distintos nombres de categoría producen el mismo slug.');
    let order = Number(r.orden);
    if (!text(r.orden) || order === 0) { order = 9999; warnings.push({ row: number, field: 'orden', code: 'effective_order', message: 'Se conserva el orden efectivo 9999 de la web actual; valor original en snapshot.' }); }
    if (!Number.isInteger(order) || order < -2147483648 || order > 2147483647) problem(number, 'orden', 'Orden entero fuera de rango.');
    if (!categories.has(categorySlug)) categories.set(categorySlug, { id: uuid(`${source}:category:${categorySlug}`), name: categoryName,
      slug: categorySlug, sort_order: order, is_active: !['clasicas','velas-clasicas'].includes(categorySlug), show_when_empty: categorySlug === 'souvenir' });
    const priceText = text(r.precio), price = Number(priceText.replace(',', '.'));
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(priceText) || !Number.isFinite(price) || price > 9999999999.99) problem(number, 'precio', 'Precio inválido: no se aceptan miles ambiguos ni más de 2 decimales.');
    let phoneValue = r.whatsapp;
    if (Object.prototype.hasOwnProperty.call(options.phoneOverrides || {}, externalId)) {
      phoneValue = options.phoneOverrides[externalId];
      corrections.push({ external_id: externalId, field: 'whatsapp', original: r.whatsapp, value: phoneValue });
    }
    let phone = text(phoneValue).replace(/[\s+()-]/g, '') || null;
    if (phone && !/^[1-9][0-9]{7,14}$/.test(phone)) problem(number, 'whatsapp', 'Número internacional inválido.');
    const quantityText = text(r.cantidadStock);
    const quantity = /^\d+$/.test(quantityText) && Number(quantityText) <= 2147483647 ? Number(quantityText) : null;
    if (quantityText && quantity === null) warnings.push({ row: number, field: 'cantidadStock', code: 'quantity_text_preserved', message: 'Se conserva como nota interna; cantidad numérica sin definir.' });
    let links = [];
    try {
      const rule = row.aroma_validation;
      if (rule && ['VALUE_IN_LIST','VALUE_IN_RANGE'].includes(rule.type)) {
        if (!Array.isArray(rule.options)) throw new Error('El desplegable no tiene una lista de opciones válida.');
        r._aromaOptions = rule.options;
      }
      // Maestro temporal con inactivos habilitados para conservar también asociaciones
      // a aromas globales retirados. RLS seguirá ocultando esos aromas al visitante.
      const allMaster = master?.map(item => ({ ...item, activo: true })) || null;
      let effective = context.normalizeProduct(r, {}, allMaster).aromas;
      let inlineActive = null;
      const rawAroma = r.aroma ?? r.aromas;
      if (!Array.isArray(r._aromaOptions) && (Array.isArray(rawAroma) || text(rawAroma).startsWith('[') || text(rawAroma).includes('|'))) {
        let entries = rawAroma;
        if (!Array.isArray(entries)) {
          if (text(entries).startsWith('[')) {
            entries = JSON.parse(entries);
            if (!Array.isArray(entries)) throw new Error('El JSON de aromas debe ser una lista.');
          } else entries = text(entries).split(/[;\r\n]+/).filter(line => line.trim()).map(line => {
            const [nombre, color, activo, orden, predeterminado, id] = line.split('|').map(text);
            return { nombre, color, activo, orden, predeterminado, id };
          });
        }
        inlineActive = new Set(context.normalizeAromas(entries).map(a => a.id));
        effective = context.normalizeAromas(entries.map(entry => ({ ...(typeof entry === 'string' ? { nombre: entry } : entry), activo: 'SI' })));
      }
      links = effective.map(item => {
        const base = aromaBase(item);
        return { aroma_id: base.id, legacy_aroma_id: item.id, sort_order: item.orden, is_active: inlineActive ? inlineActive.has(item.id) : true,
          is_default: false, name_override: item.nombre === base.name ? null : item.nombre,
          color_override: item.color && item.color !== base.color ? item.color : null,
          use_neutral_color: !item.color && !!base.color, requested_default: item.predeterminado };
      });
      const defaultLink = links.find(link => link.is_active && link.requested_default && aromas.get(link.legacy_aroma_id)?.is_active);
      if (defaultLink) defaultLink.is_default = true;
      links.forEach(link => { delete link.requested_default; });
    } catch (error) { problem(number, 'aroma', error.message); }
    products.push({ id: uuid(`${source}:product:${externalId}`), source_system: source, external_id: externalId,
      name, slug: productSlug, description: String(r.descripcion ?? ''), price,
      category_id: categories.get(categorySlug)?.id, sort_order: order,
      is_active: bool(r.activo, number, 'activo'), is_available: bool(r.stock, number, 'stock'), is_featured: bool(r.destacado, number, 'destacado'),
      whatsapp_override: phone, inventory: { quantity, legacy_quantity_text: String(r.cantidadStock ?? '') },
      aromas: links, image_name: text(r.nombreImagen), source_row: number });
  }
  // Categorías se ordenan como aparecen en la web: primer producto por orden/nombre.
  const sorted = [...products].sort((a,b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  let categoryOrder = 0;
  const visited = new Set();
  sorted.forEach(p => { if (!visited.has(p.category_id)) { visited.add(p.category_id); [...categories.values()].find(c => c.id === p.category_id).sort_order = categoryOrder++; } });
  if (!categories.has('souvenir')) categories.set('souvenir', { id: uuid(`${source}:category:souvenir`), name: 'Souvenir', slug: 'souvenir', sort_order: categoryOrder, is_active: true, show_when_empty: true });
  // Souvenir se ofrece al final también en la web existente.
  categories.get('souvenir').sort_order = categoryOrder;
  const files = snapshot.images?.files || [];
  const images = [];
  for (const p of products) {
    if (!p.image_name) continue;
    const matches = files.filter(file => file.name === p.image_name);
    if (matches.length !== 1) { problem(p.source_row, 'nombreImagen', matches.length ? 'Nombre de imagen duplicado en Drive.' : 'Imagen no encontrada en el inventario de Drive.'); continue; }
    const file = matches[0];
    if (!/^[A-Za-z0-9_-]+$/.test(file.id) || path.basename(file.name) !== file.name || /[\\/]/.test(file.name)) { problem(p.source_row, 'nombreImagen', 'Identificador o nombre de archivo inválido.'); continue; }
    images.push({ product_id: p.id, external_id: p.external_id, source_system: source, product_name: p.name,
      drive_id: file.id, filename: file.name, mime_type: file.mime_type, expected_size: file.size, sort_order: 0 });
  }
  const list = [...categories.values()].sort((a,b) => a.sort_order - b.sort_order);
  return { schema_version: 1, source_system: source, source_exported_at: snapshot.exported_at,
    source_hash: sha256(JSON.stringify(snapshot)), categories: list, aromas: [...aromas.values()], products,
    images, errors, warnings, corrections, summary: { products: products.length, published: products.filter(p => p.is_active && list.find(c => c.id === p.category_id)?.is_active).length,
      unavailable: products.filter(p => !p.is_available).length, categories: list.length, aromas: aromas.size,
      relationships: products.reduce((n,p) => n+p.aromas.length,0), images: images.length } };
}

module.exports = { prepare, uuid, sha256 };
