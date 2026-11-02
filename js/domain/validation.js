(function (root) {
  'use strict';
  const fail = message => { throw new Error(message); };
  const text = value => String(value ?? '').trim();
  function required(value, label, max = 240) {
    const result = text(value);
    if (!result || result.length > max) fail(`${label}: completá entre 1 y ${max} caracteres.`);
    return result;
  }
  function integer(value, label, nullable = false) {
    if (nullable && text(value) === '') return null;
    if (!/^-?\d+$/.test(text(value))) fail(`${label}: ingresá un número entero.`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647) fail(`${label}: valor fuera de rango.`);
    return number;
  }
  function price(value) {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text(value))) fail('Precio: usá un número sin separador de miles, con hasta 2 decimales.');
    const number = Number(text(value).replace(',', '.'));
    if (number > 9999999999.99) fail('Precio fuera de rango.');
    return number;
  }
  function slug(value) {
    const result = required(value, 'Identificador URL');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) fail('Identificador URL: usá letras minúsculas, números y guiones.');
    return result;
  }
  function slugify(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function phone(value) {
    const result = text(value).replace(/[\s+()-]/g, '');
    if (result && !/^[1-9]\d{7,14}$/.test(result)) fail('WhatsApp: ingresá el número internacional completo.');
    return result || null;
  }
  function product(value) {
    const quantity = integer(value.quantity, 'Cantidad interna', true);
    if (quantity !== null && quantity < 0) fail('La cantidad interna no puede ser negativa.');
    const aromas = [...new Set(value.aroma_ids || [])];
    if (value.default_aroma_id && !aromas.includes(value.default_aroma_id)) fail('Asigná el aroma predeterminado al producto.');
    return { ...value, name: required(value.name, 'Nombre'), slug: slug(value.slug),
      category_id: required(value.category_id, 'Categoría'), price: price(value.price), quantity,
      sort_order: integer(value.sort_order, 'Orden'), whatsapp_override: phone(value.whatsapp_override),
      description: String(value.description ?? ''), aroma_ids: aromas,
      is_active: Boolean(value.is_active), is_featured: Boolean(value.is_featured), is_available: Boolean(value.is_available),
    };
  }
  function image(file) {
    const extensions = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['avif'] };
    const extension = file.name.split('.').pop().toLowerCase();
    if (!extensions[file.type]?.includes(extension)) fail('Imagen: elegí JPG, PNG, WebP o AVIF con formato y extensión coincidentes.');
    if (!file.size || file.size > 5 * 1024 * 1024) fail('Cada imagen debe pesar entre 1 byte y 5 MiB.');
    return extension;
  }
  root.CaleficaValidation = Object.freeze({ text, required, integer, price, slug, slugify, phone, product, image });
})(window);
