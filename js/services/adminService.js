(function (root) {
  'use strict';
  const client = () => root.CaleficaSupabase.getClient();
  const unwrap = result => root.CaleficaSupabase.unwrap(result);
  async function all(queryFactory) {
    const result = [];
    for (let start = 0; ; start += 500) {
      const rows = unwrap(await queryFactory().range(start, start + 499));
      result.push(...rows);
      if (rows.length < 500) return result;
    }
  }
  async function authorize() {
    const result = await client().auth.getUser();
    if (result.error || !result.data.user) return null;
    const row = unwrap(await client().from('admin_users').select('user_id, role').eq('user_id', result.data.user.id).maybeSingle());
    if (row?.role !== 'admin') throw Object.assign(new Error('Tu usuario no tiene acceso administrativo. Revisá su membresía en Supabase.'), { code: '42501' });
    return result.data.user;
  }
  async function login(email, password) {
    unwrap(await client().auth.signInWithPassword({ email: email.trim(), password }));
    return authorize();
  }
  async function logout() { unwrap(await client().auth.signOut({ scope: 'local' })); }
  async function load() {
    if (!await authorize()) throw Object.assign(new Error('La sesión venció. Volvé a ingresar.'), { code: '42501' });
    const [products, categories, aromas, settings] = await Promise.all([
      all(() => client().from('products').select('*, product_inventory(*), product_aromas(*), product_images(*)').order('sort_order').order('id')),
      all(() => client().from('categories').select('*').order('sort_order').order('id')),
      all(() => client().from('aromas').select('*').order('sort_order').order('id')),
      client().from('site_settings').select('key,value').then(unwrap),
    ]);
    return { products, categories, aromas, settings: Object.fromEntries(settings.map(row => [row.key, row.value])) };
  }
  async function saveProduct(payload) { return unwrap(await client().rpc('admin_save_product', { payload: root.CaleficaValidation.product(payload) })); }
  async function saveRecord(table, values, id) {
    if (!['categories', 'aromas'].includes(table)) throw new Error('Operación no permitida.');
    const record = { ...values, name: root.CaleficaValidation.required(values.name, 'Nombre', 160), sort_order: root.CaleficaValidation.integer(values.sort_order, 'Orden') };
    if (table === 'categories') record.slug = root.CaleficaValidation.slug(values.slug);
    if (table === 'aromas' && record.color && !/^#[0-9a-f]{6}$/i.test(record.color)) throw new Error('Color: usá un código como #B7A0D4.');
    const query = id ? client().from(table).update(record).eq('id', id) : client().from(table).insert(record);
    return unwrap(await query.select().single());
  }
  async function toggle(table, id, is_active) {
    if (!['products', 'categories', 'aromas'].includes(table)) throw new Error('Operación no permitida.');
    unwrap(await client().from(table).update({ is_active }).eq('id', id).select('id').single());
  }
  async function removeProduct(id) { unwrap(await client().from('products').delete().eq('id', id).select('id').single()); }
  async function settings(value) { unwrap(await client().rpc('admin_save_settings', { settings: value })); }
  async function signedUrl(path) {
    if (!path) return '';
    return unwrap(await client().storage.from('product-images').createSignedUrl(path, 900)).signedUrl;
  }
  async function upload(productId, file, order) {
    const extension = root.CaleficaValidation.image(file);
    if (root.createImageBitmap) {
      try { const bitmap = await root.createImageBitmap(file); bitmap.close(); }
      catch { throw new Error('No se pudo abrir la imagen. Verificá que el archivo no esté dañado.'); }
    }
    const storagePath = `products/${productId}/${root.crypto.randomUUID()}.${extension}`;
    unwrap(await client().storage.from('product-images').upload(storagePath, file, { upsert: false, contentType: file.type }));
    const result = await client().from('product_images').insert({ product_id: productId, storage_path: storagePath,
      original_filename: file.name, sort_order: order, is_primary: false }).select().single();
    if (result.error) {
      const cleanup = await client().storage.from('product-images').remove([storagePath]);
      throw new Error(cleanup.error ? 'Falló el registro de imagen. Quedó un archivo sin asociar; revisar Storage.' : 'No se pudo registrar la imagen. Se retiró el archivo subido.');
    }
    return result.data;
  }
  async function removeImage(image) {
    // Primero quitar asociación: si la API Storage falla, queda un huérfano privado,
    // no un producto publicado apuntando a un archivo inexistente.
    unwrap(await client().from('product_images').delete().eq('id', image.id).select('id').single());
    const result = await client().storage.from('product-images').remove([image.storage_path]);
    if (result.error) throw new Error('Se quitó la imagen del producto, pero falló la limpieza del archivo. Revisá Storage.');
  }
  async function primary(productId, imageId) { unwrap(await client().rpc('admin_set_primary_image', { target_product: productId, target_image: imageId })); }
  async function imageOrder(id, order) { unwrap(await client().from('product_images').update({ sort_order: root.CaleficaValidation.integer(order, 'Orden de imagen') }).eq('id', id).select('id').single()); }
  root.CaleficaAdminService = Object.freeze({ authorize, login, logout, load, saveProduct, saveRecord, toggle, removeProduct, settings,
    signedUrl, upload, removeImage, primary, imageOrder, onAuthChange: callback => client().auth.onAuthStateChange(callback) });
})(window);
