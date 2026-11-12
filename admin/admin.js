(function () {
  'use strict';
  const service = window.CaleficaAdminService;
  const validation = window.CaleficaValidation;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(value);
  const labels = { dashboard: 'Resumen', products: 'Productos', categories: 'Categorías', aromas: 'Aromas', settings: 'Configuración' };
  let data = { products: [], categories: [], aromas: [], settings: {} };
  let section = 'dashboard', user = null, busy = false, dirty = false, editorId = null, editorType = null;
  let authGeneration = 0;
  const filters = { search: '', category: '', state: '' };
  const imageCache = new Map();

  function message(text, error = false, target = '#status') {
    const element = $(target);
    element.textContent = text;
    element.classList.toggle('error', error);
  }
  function errorMessage(error) {
    if (error.code === 'PGRST202') return 'Falta aplicar la migración 20261030000300_admin_operations.sql en SQL Editor.';
    if (error.code === '23505') return 'Ese identificador ya existe. Revisá el identificador URL o la imagen principal.';
    if (error.code === '23503') return 'Hay una relación que ya no existe o todavía está en uso. Actualizá los datos.';
    if (error.code === '23514' || error.code === '22P02') return 'Revisá los campos: hay un valor que la base de datos no admite.';
    if (error.code === '42501') return 'No tenés permiso para esta operación. Revisá tu sesión y la membresía administrativa.';
    if (error.message?.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (error.message?.includes('Email not confirmed')) return 'El email todavía no está confirmado en Supabase.';
    if (error.message?.includes('Failed to fetch')) return 'No se pudo conectar. Revisá tu conexión e intentá nuevamente.';
    return error.message || 'No se pudo completar la operación.';
  }
  function lock(text = 'Ingresá con tu usuario administrador.') {
    authGeneration++;
    user = null;
    data = { products: [], categories: [], aromas: [], settings: {} };
    imageCache.clear(); dirty = false;
    $('#editor').close(); $('#editor-content').replaceChildren();
    $('#content').replaceChildren(); $('#panel-view').hidden = true; $('#login-view').hidden = false;
    message(text, false, '#login-status');
  }
  async function hydrateImages() {
    const elements = [...document.querySelectorAll('img[data-path]')];
    await Promise.allSettled(elements.map(async element => {
      const path = element.dataset.path;
      try {
        let entry = imageCache.get(path);
        if (!entry || entry.expires < Date.now()) {
          entry = { url: await service.signedUrl(path), expires: Date.now() + 600000 };
          imageCache.set(path, entry);
        }
        if (element.isConnected && element.dataset.path === path) element.src = entry.url;
      } catch { element.alt = 'No se pudo cargar la imagen'; }
    }));
  }
  async function loadData() {
    const generation = authGeneration;
    $('#content').setAttribute('aria-busy', 'true');
    try {
      const nextData = await service.load();
      if (generation !== authGeneration || !user) return false;
      data = nextData;
      render();
      return true;
    } finally { $('#content').setAttribute('aria-busy', 'false'); }
  }
  async function operation(button, action, success, target = '#status') {
    if (busy) return;
    busy = true;
    const scope = button?.closest('form') || button?.closest('dialog');
    const controls = [...(scope?.querySelectorAll('input, select, textarea, button') || [])].map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    if (button) button.disabled = true;
    message('Procesando…', false, target);
    try {
      await action();
      if (success) message(success, false, target);
    } catch (error) {
      message(errorMessage(error), true, target);
      if (error.code === '42501') {
        try { if (!await service.authorize()) lock('La sesión venció. Volvé a ingresar.'); }
        catch { lock('Tu usuario ya no tiene acceso administrativo.'); }
      }
    } finally {
      busy = false;
      controls.forEach(([element, disabled]) => { if (element.isConnected) element.disabled = disabled; });
      if (button?.isConnected && !controls.some(([element]) => element === button)) button.disabled = false;
    }
  }
  const categoryName = id => data.categories.find(c => c.id === id)?.name || 'Sin categoría';
  const isPublished = p => p.is_active && data.categories.some(c => c.id === p.category_id && c.is_active);
  const badge = (text, type = '') => `<span class="badge ${type}">${escape(text)}</span>`;
  const action = (name, id, label, style = 'secondary') => `<button type="button" class="${style}" data-action="${name}" data-id="${escape(id)}">${escape(label)}</button>`;
  function empty(title, copy) { return `<div class="empty"><h2>${escape(title)}</h2><p>${escape(copy)}</p></div>`; }
  function thumbnail(p) {
    const image = [...p.product_images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)[0];
    return image ? `<img class="thumb" data-path="${escape(image.storage_path)}" alt="${escape(p.name)}">` : '<div class="thumb-placeholder" aria-hidden="true"></div>';
  }
  function productRows(products) {
    return `<div class="list">${products.map(p => `<article class="list-row">${thumbnail(p)}<div class="row-info"><h3>${escape(p.name)}</h3><p>${escape(categoryName(p.category_id))} · ${money(p.price)}</p>${badge(isPublished(p) ? 'Publicado' : p.is_active ? 'Categoría oculta' : 'Oculto', isPublished(p) ? 'green' : 'gray')}${!p.is_available ? badge('Sin stock') : ''}${p.is_featured ? badge('Destacado') : ''}</div><div class="row-actions">${action('edit-product', p.id, 'Editar')}${action('toggle-product', p.id, p.is_active ? 'Ocultar' : 'Publicar', 'quiet')}${action('delete-product', p.id, 'Eliminar', 'danger')}</div></article>`).join('')}</div>`;
  }
  function render() {
    $('#section-title').textContent = labels[section];
    document.querySelectorAll('[data-section]').forEach(button => button.setAttribute('aria-current', button.dataset.section === section ? 'page' : 'false'));
    const target = $('#content');
    if (section === 'dashboard') {
      const published = data.products.filter(isPublished).length;
      target.innerHTML = `<div class="stats">${[['Productos', data.products.length], ['Publicados', published], ['Ocultos', data.products.length - published], ['Sin stock', data.products.filter(p => !p.is_available).length]].map(([label, count]) => `<div class="stat"><p>${label}</p><strong>${count}</strong></div>`).join('')}</div><div class="banner-card"><p class="eyebrow">HECHO CON CUIDADO</p><h2>Cada detalle cuenta.</h2><p>Organizá tus productos, elegí sus aromas y prepará tu colección. Todo lo que necesitás para mantener tu catálogo al día.</p></div><div class="card"><div class="card-top"><h2>Tu colección</h2><button class="primary" data-action="new-product">Agregar producto</button></div>${data.products.length ? productRows(data.products.slice(0, 5)) : empty('Tu catálogo está por comenzar', 'Primero creá una categoría y después agregá un producto. La importación de Sheets se hará en una etapa separada.')}</div>`;
    } else if (section === 'products') {
      target.innerHTML = `<div class="toolbar"><div class="filters"><label>Buscar<input id="search" type="search" placeholder="Nombre del producto" value="${escape(filters.search)}"></label><label>Categoría<select id="filter-category"><option value="">Todas</option>${data.categories.map(c => `<option value="${c.id}"${filters.category === c.id ? ' selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label><label>Estado<select id="filter-state">${[['', 'Todos'], ['published', 'Publicados'], ['hidden', 'Ocultos'], ['out', 'Sin stock']].map(([value, label]) => `<option value="${value}"${filters.state === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><button class="primary" data-action="new-product">Agregar producto</button></div><div id="product-results"></div>`;
      renderFiltered();
    } else if (section === 'categories' || section === 'aromas') {
      const categories = section === 'categories';
      const rows = data[section];
      target.innerHTML = `<div class="card-top"><p class="muted">${categories ? 'Agrupá tu colección y elegí cómo se muestra.' : 'Fragancias y colores para cada producto.'}</p><button class="primary" data-action="new-record">${categories ? 'Nueva categoría' : 'Nuevo aroma'}</button></div>${rows.length ? `<div class="list">${rows.map(row => `<article class="list-row"><div class="row-info"><h3>${!categories ? `<span class="swatch" style="--swatch:${escape(row.color || '#eeeeee')}"></span>` : ''}${escape(row.name)}</h3><p>Orden ${row.sort_order}${categories && row.show_when_empty ? ' · Visible sin productos' : ''}</p>${badge(row.is_active ? 'Activo' : 'Oculto', row.is_active ? 'green' : 'gray')}</div><div class="row-actions">${action('edit-record', row.id, 'Editar')}${action('toggle-record', row.id, row.is_active ? 'Ocultar' : 'Activar', 'quiet')}</div></article>`).join('')}</div>` : empty(categories ? 'Todavía no hay categorías' : 'Todavía no hay aromas', categories ? 'Creá una categoría para comenzar a organizar tus productos.' : 'Agregá un aroma y después asignalo a tus productos.')}`;
    } else {
      target.innerHTML = `<div class="card settings-form"><h2>La información de tu negocio</h2><p class="help">Estos datos serán públicos cuando el catálogo utilice Supabase. Dejá vacío un campo opcional para retirarlo.</p><form id="settings-form"><div class="form-grid">${field('business_name', 'Nombre del negocio', data.settings.business_name || '', 'text', 'required maxlength="160"')}${field('whatsapp_number', 'WhatsApp internacional', data.settings.whatsapp_number || '', 'tel', 'placeholder="549…"')}${field('instagram_url', 'Perfil de Instagram', data.settings.instagram_url || '', 'url', 'placeholder="https://www.instagram.com/tu_cuenta/"')}${field('contact_email', 'Email público', data.settings.contact_email || '', 'email')}<label class="full">Información pública<textarea name="business_description" maxlength="5000">${escape(data.settings.business_description || '')}</textarea></label></div><p class="help">Moneda: pesos argentinos (ARS). No guardar contraseñas ni información interna en esta sección.</p><div class="form-actions"><button class="primary" type="submit">Guardar configuración</button></div></form></div>`;
    }
    hydrateImages();
  }
  function renderFiltered() {
    const search = filters.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const rows = data.products.filter(p => p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(search))
      .filter(p => !filters.category || p.category_id === filters.category)
      .filter(p => !filters.state || (filters.state === 'published' ? isPublished(p) : filters.state === 'hidden' ? !isPublished(p) : !p.is_available));
    $('#product-results').innerHTML = rows.length ? productRows(rows) : empty('No hay productos para mostrar', data.products.length ? 'Probá cambiar los filtros de búsqueda.' : 'Agregá tu primer producto después de crear una categoría.');
    hydrateImages();
  }
  function field(name, label, value = '', type = 'text', attributes = '') {
    return `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${attributes}></label>`;
  }
  function check(name, label, checked) { return `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}>${escape(label)}</label>`; }
  function openEditor(title, html) {
    dirty = false; $('#editor-title').textContent = title; $('#editor-content').innerHTML = html;
    message('', false, '#editor-status');
    if (!$('#editor').open) $('#editor').showModal();
    hydrateImages();
  }
  function editProduct(id) {
    if (!data.categories.length) { section = 'categories'; render(); message('Creá una categoría antes de agregar productos.'); return; }
    const p = data.products.find(p => p.id === id);
    editorType = 'products'; editorId = id || null;
    const inventory = Array.isArray(p?.product_inventory) ? p.product_inventory[0] : p?.product_inventory;
    const links = p?.product_aromas.filter(link => link.is_active).sort((a, b) => a.sort_order - b.sort_order) || [];
    const orderedAromas = [...data.aromas].sort((a, b) => {
      const ai = links.findIndex(link => link.aroma_id === a.id), bi = links.findIndex(link => link.aroma_id === b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi) || a.sort_order - b.sort_order;
    });
    openEditor(p ? 'Editar producto' : 'Nuevo producto', `<form id="product-form"><div class="form-grid">${field('name', 'Nombre', p?.name, 'text', 'required maxlength="240"')}${field('slug', 'Identificador URL', p?.slug, 'text', 'required pattern="[a-z0-9]+(-[a-z0-9]+)*"')}<label>Categoría<select name="category_id" required><option value="">Seleccionar</option>${data.categories.map(c => `<option value="${c.id}"${p?.category_id === c.id ? ' selected' : ''}>${escape(c.name)}${c.is_active ? '' : ' (oculta)'}</option>`).join('')}</select></label>${field('price', 'Precio en ARS', p?.price ?? '', 'text', 'required inputmode="decimal" placeholder="15000"')}${field('quantity', 'Cantidad interna (opcional)', inventory?.quantity ?? '', 'number', 'min="0" step="1"')}${field('sort_order', 'Orden en el catálogo', p?.sort_order ?? 9999, 'number', 'required step="1"')}<label class="full">Descripción<textarea name="description">${escape(p?.description || '')}</textarea></label>${field('whatsapp_override', 'WhatsApp propio (opcional)', p?.whatsapp_override || '', 'tel')}${field('legacy_quantity_text', 'Nota interna de stock', inventory?.legacy_quantity_text || '')}<div class="full check-group">${check('is_active', 'Publicado', p?.is_active || false)}${check('is_available', 'Disponible para pedidos', p?.is_available ?? true)}${check('is_featured', 'Destacado', p?.is_featured || false)}</div><p class="help full">La disponibilidad se administra por separado de la cantidad interna. Una categoría oculta mantiene ocultos sus productos.</p><fieldset class="full"><legend>Aromas disponibles</legend><div class="aroma-options">${orderedAromas.map(a => `<label class="check"><input type="checkbox" name="aroma_ids" value="${a.id}"${links.some(link => link.aroma_id === a.id) ? ' checked' : ''}>${escape(links.find(link => link.aroma_id === a.id)?.name_override || a.name)}${a.is_active ? '' : ' (inactivo)'}</label>`).join('') || '<p class="help">Podés agregar aromas desde su sección y asignarlos después.</p>'}</div></fieldset><label class="full">Aroma predeterminado<select name="default_aroma_id"><option value="">Primero de la lista</option>${orderedAromas.filter(a => links.some(link => link.aroma_id === a.id)).map(a => `<option value="${a.id}"${links.find(link => link.aroma_id === a.id)?.is_default ? ' selected' : ''}>${escape(a.name)}</option>`).join('')}</select></label></div><div class="form-actions"><button class="primary" type="submit">Guardar producto</button><span class="help">${p ? 'Los cambios se guardan juntos.' : 'Guardá el producto para cargar sus imágenes.'}</span></div></form>${p ? imageSection(p) : ''}`);
  }
  function imageSection(p) {
    return `<section class="image-section"><h3>Imágenes del producto</h3><p class="help">JPG, PNG, WebP o AVIF. Hasta 5 MiB por imagen. Guardá primero cualquier cambio del formulario.</p><label class="upload-label">Agregar imágenes<input id="upload-images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple></label><div class="image-grid">${[...p.product_images].sort((a, b) => a.sort_order - b.sort_order).map(image => `<article class="image-card"><img data-path="${escape(image.storage_path)}" alt="${escape(image.alt_text || p.name)}"><p>${escape(image.original_filename || 'Imagen')}${image.is_primary ? ' · Principal' : ''}</p><label>Orden<input type="number" step="1" data-image-order="${image.id}" value="${image.sort_order}"></label><div class="row-actions">${!image.is_primary ? action('primary-image', image.id, 'Principal', 'quiet') : ''}${action('delete-image', image.id, 'Quitar', 'danger')}</div></article>`).join('')}</div></section>`;
  }
  function editRecord(id) {
    const row = data[section].find(row => row.id === id);
    const category = section === 'categories';
    editorId = id || null; editorType = section;
    openEditor(`${row ? 'Editar' : 'Nueva/o'} ${category ? 'categoría' : 'aroma'}`, `<form id="record-form"><div class="form-grid">${field('name', 'Nombre', row?.name || '', 'text', 'required maxlength="160"')}${category ? field('slug', 'Identificador URL', row?.slug || '', 'text', 'required') : field('color', 'Color HEX (opcional)', row?.color || '', 'text', 'placeholder="#B7A0D4" pattern="#[0-9a-fA-F]{6}"')}${field('sort_order', 'Orden', row?.sort_order ?? 0, 'number', 'required step="1"')}<div class="full check-group">${check('is_active', 'Activo', row?.is_active ?? true)}${category ? check('show_when_empty', 'Mostrar aunque no tenga productos', row?.show_when_empty || false) : ''}</div></div><div class="form-actions"><button class="primary" type="submit">Guardar</button></div></form>`);
  }
  function closeEditor() {
    if (busy) return;
    if (dirty && !window.confirm('Tenés cambios sin guardar. ¿Querés descartarlos?')) return;
    dirty = false; $('#editor').close(); $('#editor-content').replaceChildren();
  }
  function dirtySettings() { return section === 'settings' && dirty; }

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-section]');
    if (nav && !busy) {
      if (dirtySettings() && !window.confirm('¿Descartar los cambios de configuración sin guardar?')) return;
      dirty = false; section = nav.dataset.section; message(''); render(); return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const { action: name, id } = button.dataset;
    const product = data.products.find(p => p.id === id);
    if (name === 'new-product' || name === 'edit-product') return editProduct(id);
    if (name === 'new-record' || name === 'edit-record') return editRecord(id);
    if (name === 'toggle-product') return operation(button, async () => { await service.toggle('products', id, !product.is_active); await loadData(); }, 'Estado actualizado.');
    if (name === 'toggle-record') return operation(button, async () => { const row = data[section].find(row => row.id === id); await service.toggle(section, id, !row.is_active); await loadData(); }, 'Estado actualizado.');
    if (name === 'delete-product' && window.confirm(`¿Eliminar “${product.name}”? Se quitarán sus aromas, inventario y referencias a imágenes. Los archivos de Storage se conservan. Esta acción no se puede deshacer.`)) {
      return operation(button, async () => { await service.removeProduct(id); await loadData(); }, 'Producto eliminado.');
    }
    if (name.endsWith('-image')) {
      if (dirty) return message('Guardá los cambios del producto antes de administrar imágenes.', true, '#editor-status');
      const p = data.products.find(p => p.id === editorId);
      const image = p?.product_images.find(i => i.id === id);
      if (!image) return;
      if (name === 'delete-image' && !window.confirm('¿Quitar esta imagen del producto y eliminar su archivo de Storage?')) return;
      await operation(button, async () => {
        try { if (name === 'delete-image') await service.removeImage(image); else await service.primary(p.id, id); }
        finally { await loadData(); editProduct(p.id); }
      }, 'Imágenes actualizadas.', '#editor-status');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'search') { filters.search = event.target.value; renderFiltered(); return; }
    if (event.target.closest('#product-form, #record-form, #settings-form')) {
      dirty = true;
      const form = event.target.form;
      if (event.target.name === 'name' && !editorId && form.elements.slug && !form.elements.slug.dataset.manual) form.elements.slug.value = validation.slugify(event.target.value);
      if (event.target.name === 'slug') event.target.dataset.manual = 'true';
      if (event.target.hasAttribute('data-color-picker')) form.elements.color.value = event.target.value;
    }
  });
  document.addEventListener('change', async event => {
    if (event.target.id === 'filter-category' || event.target.id === 'filter-state') { filters[event.target.id === 'filter-category' ? 'category' : 'state'] = event.target.value; renderFiltered(); }
    if (event.target.name === 'aroma_ids') {
      const form = $('#product-form'); const previous = form.elements.default_aroma_id.value;
      const selected = [...form.querySelectorAll('[name=aroma_ids]:checked')].map(input => input.value);
      form.elements.default_aroma_id.innerHTML = '<option value="">Primero de la lista</option>' + selected.map(id => `<option value="${id}"${id === previous ? ' selected' : ''}>${escape(data.aromas.find(a => a.id === id)?.name)}</option>`).join('');
    }
    if (event.target.dataset.imageOrder) {
      if (dirty) return message('Guardá primero los cambios del producto.', true, '#editor-status');
      const value = event.target.value;
      await operation(event.target, async () => { await service.imageOrder(event.target.dataset.imageOrder, value); await loadData(); editProduct(editorId); }, 'Orden actualizado.', '#editor-status');
    }
    if (event.target.id === 'upload-images') {
      if (dirty) { event.target.value = ''; return message('Guardá primero los cambios del producto.', true, '#editor-status'); }
      const files = [...event.target.files];
      if (!files.length) return;
      await operation(event.target, async () => {
        const id = editorId, p = data.products.find(p => p.id === id);
        let order = Math.max(-1, ...p.product_images.map(i => i.sort_order)) + 1;
        let success = 0; const errors = [];
        for (const file of files) {
          message(`Subiendo ${success + errors.length + 1} de ${files.length}…`, false, '#editor-status');
          try { await service.upload(id, file, order++); success++; } catch (error) { errors.push(`${file.name}: ${errorMessage(error)}`); }
        }
        await loadData(); editProduct(id);
        message(`${success} imagen/es cargada/s.${errors.length ? ' ' + errors.join(' · ') : ''}`, errors.length > 0, '#editor-status');
      }, null, '#editor-status');
    }
  });
  document.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target, values = new FormData(form);
    const button = form.querySelector('[type=submit]');
    if (form.id === 'login-form') {
      await operation(button, async () => {
        const generation = authGeneration;
        const authorized = await service.login(values.get('email'), values.get('password'));
        if (generation !== authGeneration) return;
        user = authorized;
        if (!user) throw new Error('No se pudo validar la sesión.');
        form.elements.password.value = '';
        $('#session-email').textContent = user.email;
        if (!await loadData()) return;
        $('#panel-view').hidden = false; $('#login-view').hidden = true;
      }, null, '#login-status');
    } else if (form.id === 'product-form') {
      await operation(button, async () => {
        const p = data.products.find(p => p.id === editorId);
        const payload = Object.fromEntries(values);
        Object.assign(payload, { id: editorId, expected_updated_at: p?.updated_at,
          aroma_ids: values.getAll('aroma_ids'), is_active: values.has('is_active'), is_featured: values.has('is_featured'), is_available: values.has('is_available') });
        const id = await service.saveProduct(payload); dirty = false;
        await loadData(); editProduct(id);
      }, 'Producto guardado. Ya podés administrar sus imágenes.', '#editor-status');
    } else if (form.id === 'record-form') {
      await operation(button, async () => {
        const payload = Object.fromEntries(values);
        payload.is_active = values.has('is_active');
        if (editorType === 'categories') payload.show_when_empty = values.has('show_when_empty'); else payload.color = payload.color || null;
        await service.saveRecord(editorType, payload, editorId); dirty = false; $('#editor').close(); await loadData();
      }, 'Cambios guardados.');
    } else if (form.id === 'settings-form') {
      await operation(button, async () => {
        const payload = Object.fromEntries([...values].map(([key, value]) => [key, validation.text(value) || null]));
        payload.whatsapp_number = validation.phone(payload.whatsapp_number); payload.currency = 'ARS';
        await service.settings(payload); dirty = false; await loadData();
      }, 'Configuración guardada.');
    }
  });
  $('#close-editor').addEventListener('click', closeEditor);
  $('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  $('#refresh').addEventListener('click', event => {
    if (dirtySettings() && !window.confirm('¿Descartar cambios sin guardar y actualizar?')) return;
    dirty = false; operation(event.target, loadData, 'Datos actualizados.');
  });
  $('#logout').addEventListener('click', event => {
    if (dirty && !window.confirm('¿Descartar cambios sin guardar y cerrar sesión?')) return;
    operation(event.target, async () => { await service.logout(); lock('Sesión cerrada.'); }, null);
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('focus', async () => {
    if (!user || busy) return;
    try { if (!await service.authorize()) lock('La sesión venció. Volvé a ingresar.'); else if (!dirty && !$('#editor').open) await loadData(); }
    catch (error) { lock(errorMessage(error)); }
  });
  async function boot() {
    try {
      $('#provider-notice').textContent = 'Los cambios guardados se mostrarán al actualizar el catálogo de la tienda.';
      service.onAuthChange(event => {
        // No hacer llamadas async dentro del lock interno del SDK de Auth.
        if (event === 'SIGNED_OUT') setTimeout(() => lock('Sesión cerrada.'), 0);
        if (event === 'TOKEN_REFRESHED') setTimeout(async () => {
          try { if (!await service.authorize()) lock('La sesión venció.'); } catch (error) { lock(errorMessage(error)); }
        }, 0);
      });
      const generation = authGeneration;
      const authorized = await service.authorize();
      if (generation !== authGeneration) return;
      user = authorized;
      if (!user) return lock();
      $('#session-email').textContent = user.email;
      $('#panel-view').hidden = false; $('#login-view').hidden = true;
      await loadData();
    } catch (error) { lock(errorMessage(error)); }
  }
  boot();
})();
