(function (root) {
  'use strict';
  const provider = () => {
    const name = root.CALEFICA_CONFIG?.dataProvider ?? 'sheets';
    if (!['sheets', 'supabase'].includes(name)) throw new Error('Proveedor de datos no válido. Usá sheets o supabase.');
    return name;
  };
  const unwrap = result => root.CaleficaSupabase.unwrap(result);
  async function all(client, table, select) {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const page = unwrap(await client.from(table).select(select).order('sort_order').order('id').range(start, start + 499));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function sheets(url) {
    const response = await root.fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('La API de Sheets no respondió correctamente.');
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.productos)) throw new Error(data.error || 'El catálogo de Sheets no es válido.');
    return data;
  }
  async function supabase() {
    const client = root.CaleficaSupabase.getPublicClient();
    const [products, categories, settingsRows] = await Promise.all([
      all(client, 'products', '*, product_images(*), product_aromas(*, aromas(*))'),
      all(client, 'categories', '*'),
      client.from('site_settings').select('key,value').then(unwrap),
    ]);
    const settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
    const categoryMap = new Map(categories.filter(c => c.is_active).map(c => [c.id, c]));
    const normalized = await Promise.all(products.filter(p => p.is_active && categoryMap.has(p.category_id)).map(async product => {
      const category = categoryMap.get(product.category_id);
      const images = [...(product.product_images || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
      let imageUrl = '';
      if (images.length) imageUrl = unwrap(await client.storage.from('product-images').createSignedUrl(images[0].storage_path, 900)).signedUrl;
      const aromas = (product.product_aromas || []).filter(link => link.is_active && link.aromas?.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.aroma_id.localeCompare(b.aroma_id))
        .map(link => ({ id: link.legacy_aroma_id || link.aroma_id,
          nombre: link.name_override || link.aromas.name,
          color: link.use_neutral_color ? null : link.color_override || link.aromas.color,
          activo: true, orden: link.sort_order, predeterminado: link.is_default }));
      return { id: product.external_id || product.id, activo: 'SI', nombre: product.name, descripcion: product.description,
        precio: Number(product.price), orden: product.sort_order, categoria: category.name, categoriaId: category.slug,
        stock: product.is_available ? 'SI' : 'NO', destacado: product.is_featured ? 'SI' : 'NO',
        whatsapp: product.whatsapp_override || settings.whatsapp_number || '', imagenUrl: imageUrl, aromas };
    }));
    return { ok: true, productos: normalized, categorias: [...categoryMap.values()], settings };
  }
  root.CaleficaProductsService = Object.freeze({ provider, loadCatalog: options => provider() === 'sheets' ? sheets(options.sheetsUrl) : supabase() });
})(window);
