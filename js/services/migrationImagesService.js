(function (root) {
  'use strict';
  const client = () => root.CaleficaSupabase.getClient();
  const unwrap = value => root.CaleficaSupabase.unwrap(value);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  async function hash(blob) {
    return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function manifest(value) {
    if (value.schema_version !== 1 || value.kind !== 'calefica-images' || !value.source_system?.startsWith('sheets:') || !/^[0-9a-f]{64}$/.test(value.source_hash) || !Array.isArray(value.items) || !value.items.length || value.items.length > 1000 || value.errors?.length) throw new Error('Manifiesto inválido o incompleto. Usá el archivo generado con la exportación.');
    const paths = new Set();
    for (const image of value.items) {
      if (!uuid.test(image.product_id) || !uuid.test(image.image_id) || !/^[0-9a-f]{64}$/.test(image.sha256) || typeof image.filename !== 'string' || /[\\/]/.test(image.filename)) throw new Error('El manifiesto contiene un identificador o nombre inválido.');
      const extension = image.filename.split('.').pop().toLowerCase();
      if (image.storage_path !== `products/${image.product_id}/${image.sha256}.${extension}` || !['jpg','jpeg','png','webp','avif'].includes(extension) || paths.has(image.storage_path) || image.source_system !== value.source_system) throw new Error('El manifiesto contiene rutas inválidas o repetidas.');
      if (!Number.isInteger(image.sort_order) || !Number.isInteger(image.size) || image.size <= 0 || image.size > 5242880) throw new Error('Tamaño u orden de imagen inválido.');
      paths.add(image.storage_path);
    }
    return value;
  }
  async function prepare(value, files) {
    manifest(value);
    const byName = new Map();
    for (const file of files) {
      if (byName.has(file.name)) throw new Error(`Hay dos archivos llamados ${file.name}. Seleccioná la carpeta de originales preparada.`);
      byName.set(file.name, file);
    }
    const jobs = [];
    for (const image of value.items) {
      const file = byName.get(image.filename);
      if (!file) throw new Error(`Falta ${image.filename}.`);
      root.CaleficaValidation.image(file);
      if (file.size !== image.size || file.type !== image.mime_type || await hash(file) !== image.sha256) throw new Error(`${image.filename} no coincide con el original verificado.`);
      if (root.createImageBitmap) {
        try { const bitmap = await root.createImageBitmap(file); bitmap.close(); }
        catch { throw new Error(`${image.filename} no se puede decodificar como imagen.`); }
      }
      jobs.push({ image: { ...image }, file });
    }
    return { source: value.source_system, jobs };
  }
  async function requireAdmin() {
    if (!await root.CaleficaAdminService.authorize()) throw new Error('Ingresá al panel como administrador antes de continuar.');
  }
  async function run(job, progress = () => {}) {
    await requireAdmin();
    // Verificar TODOS los productos antes de escribir el primer objeto.
    const ids = [...new Set(job.jobs.map(entry => entry.image.product_id))];
    const products = [];
    for (let i = 0; i < ids.length; i += 100) products.push(...unwrap(await client().from('products').select('id,source_system,external_id').in('id', ids.slice(i, i + 100))));
    for (const { image } of job.jobs) {
      if (!products.some(product => product.id === image.product_id && product.source_system === job.source && product.external_id === image.external_id)) throw new Error(`Falta importar ${image.external_id}. Ejecutá primero importar-catalogo.sql.`);
    }
    const storage = client().storage.from('product-images');
    const report = [];
    for (const { image, file } of job.jobs) {
      await requireAdmin();
      try {
        const existing = unwrap(await client().from('product_images').select('id,product_id,storage_path').eq('storage_path', image.storage_path).maybeSingle());
        if (existing && existing.product_id !== image.product_id) throw new Error('La ruta ya está asociada a otro producto.');
        if (existing) {
          const original = unwrap(await storage.download(image.storage_path));
          if (await hash(original) !== image.sha256) throw new Error('El archivo remoto difiere del original. No se sobrescribió.');
        } else {
          const uploaded = await storage.upload(image.storage_path, file, { contentType: image.mime_type, upsert: false });
          if (uploaded.error) {
            // Recuperar un objeto huérfano de una ejecución parcial, sin sobrescribirlo.
            const original = await storage.download(image.storage_path);
            if (original.error || await hash(original.data) !== image.sha256) throw new Error('No se pudo subir o el archivo remoto difiere. No se sobrescribió.');
          }
          const primary = unwrap(await client().from('product_images').select('id').eq('product_id', image.product_id).eq('is_primary', true).maybeSingle());
          const values = { id: image.image_id, product_id: image.product_id, storage_path: image.storage_path,
            original_filename: image.filename, alt_text: image.product_name, sort_order: image.sort_order, is_primary: !primary };
          let inserted = await client().from('product_images').insert(values);
          if (inserted.error?.code === '23505') {
            const concurrent = unwrap(await client().from('product_images').select('id,product_id').eq('storage_path', image.storage_path).maybeSingle());
            if (concurrent?.product_id !== image.product_id) inserted = await client().from('product_images').insert({ ...values, is_primary: false });
            else inserted = { data: concurrent };
          }
          unwrap(inserted);
          // Validar acceso real a la URL nueva como administrador, también para ocultos.
          const signed = unwrap(await storage.createSignedUrl(image.storage_path, 60));
          const response = await root.fetch(signed.signedUrl, { signal: AbortSignal.timeout(15000) });
          if (!response.ok || await hash(await response.blob()) !== image.sha256) throw new Error('El archivo se cargó pero no pudo verificarse su URL. Podés reintentar.');
        }
        report.push({ filename: image.filename, result: existing ? 'Ya importada y verificada' : 'Importada y verificada', ok: true });
      } catch (error) { report.push({ filename: image.filename, result: error.message || 'Error al importar. El reintento no sobrescribe originales.', ok: false }); }
      progress([...report], job.jobs.length);
    }
    return report;
  }
  root.CaleficaMigrationImages = Object.freeze({ manifest, prepare, run });
})(window);
