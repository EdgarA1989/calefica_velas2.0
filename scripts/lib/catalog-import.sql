-- Importación conservadora: crea faltantes y verifica los existentes.
-- Nunca borra datos ni sobrescribe cambios del panel. Repetir el mismo snapshot
-- deja las mismas filas y timestamps. Ante conflicto, revierte TODO el archivo.
begin;
set local lock_timeout = '5s';
do $calefica_import$
declare
  payload jsonb := __CALEFICA_PAYLOAD__;
  item jsonb;
  link jsonb;
  expected jsonb;
  actual jsonb;
  category_row public.categories%rowtype;
  aroma_row public.aromas%rowtype;
  product_row public.products%rowtype;
  inventory_row public.product_inventory%rowtype;
  link_row public.product_aromas%rowtype;
  category_map jsonb := '{}'::jsonb;
  aroma_map jsonb := '{}'::jsonb;
  matched integer;
  created_categories integer := 0;
  created_aromas integer := 0;
  created_products integer := 0;
  created_inventory integer := 0;
  created_links integer := 0;
begin
  if current_user <> 'postgres' then raise exception 'Ejecutar esta importación desde SQL Editor como postgres.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(payload->>'source_system', 0));

  for item in select value from jsonb_array_elements(payload->'categories') loop
    select * into category_row from public.categories where slug = item->>'slug' for update;
    if not found then
      insert into public.categories(id, name, slug, sort_order, is_active, show_when_empty)
      select r.id, r.name, r.slug, r.sort_order, r.is_active, r.show_when_empty
      from jsonb_populate_record(null::public.categories, item) r returning * into category_row;
      created_categories := created_categories + 1;
    end if;
    actual := to_jsonb(category_row) - array['id','created_at','updated_at'];
    if actual <> item - 'id' then
      raise exception 'Categoría % ya existe con datos diferentes. Revisar; no se sobrescribió.', item->>'name';
    end if;
    category_map := category_map || jsonb_build_object(item->>'id', category_row.id);
  end loop;

  for item in select value from jsonb_array_elements(payload->'aromas') loop
    select * into aroma_row from public.aromas where id = (item->>'id')::uuid for update;
    if not found then
      select count(*) into matched from public.aromas where lower(btrim(name)) = lower(btrim(item->>'name'));
      if matched > 1 then raise exception 'Hay varios aromas llamados %. Resolver la ambigüedad antes de importar.', item->>'name'; end if;
      if matched = 1 then
        select * into aroma_row from public.aromas where lower(btrim(name)) = lower(btrim(item->>'name')) for update;
      else
        insert into public.aromas(id, name, color, is_active, sort_order)
        select r.id, r.name, r.color, r.is_active, r.sort_order
        from jsonb_populate_record(null::public.aromas, item) r returning * into aroma_row;
        created_aromas := created_aromas + 1;
      end if;
    end if;
    actual := to_jsonb(aroma_row) - array['id','created_at','updated_at'];
    if actual <> item - array['id','legacy_id'] then
      raise exception 'Aroma % ya existe con datos diferentes. Revisar; no se sobrescribió.', item->>'name';
    end if;
    aroma_map := aroma_map || jsonb_build_object(item->>'id', aroma_row.id);
  end loop;

  for item in select value from jsonb_array_elements(payload->'products') loop
    expected := item - array['inventory','aromas','image_name','source_row'];
    expected := jsonb_set(expected, '{category_id}', category_map->(item->>'category_id'));
    select * into product_row from public.products
      where source_system = payload->>'source_system' and external_id = item->>'external_id' for update;
    if not found then
      if exists (select 1 from public.products where slug = item->>'slug') then
        raise exception 'El slug % ya pertenece a un producto sin esta identidad de origen. No se duplicó ni reemplazó.', item->>'slug';
      end if;
      insert into public.products(id, source_system, external_id, name, slug, description, price,
        category_id, sort_order, is_active, is_featured, is_available, whatsapp_override)
      select r.id, r.source_system, r.external_id, r.name, r.slug, r.description, r.price,
        r.category_id, r.sort_order, r.is_active, r.is_featured, r.is_available, r.whatsapp_override
      from jsonb_populate_record(null::public.products, expected) r returning * into product_row;
      created_products := created_products + 1;
    end if;
    actual := to_jsonb(product_row) - array['created_at','updated_at'];
    if actual <> expected then
      raise exception 'Producto % ya existe con datos o identidad diferentes. Revisar; no se sobrescribió.', item->>'external_id';
    end if;

    expected := (item->'inventory') || jsonb_build_object('product_id', product_row.id);
    select * into inventory_row from public.product_inventory where product_id = product_row.id for update;
    if not found then
      insert into public.product_inventory(product_id, quantity, legacy_quantity_text)
      select r.product_id, r.quantity, r.legacy_quantity_text
      from jsonb_populate_record(null::public.product_inventory, expected) r returning * into inventory_row;
      created_inventory := created_inventory + 1;
    end if;
    if to_jsonb(inventory_row) - array['created_at','updated_at'] <> expected then
      raise exception 'Inventario de % editado o diferente. Revisar; no se sobrescribió.', item->>'external_id';
    end if;

    for link in select value from jsonb_array_elements(item->'aromas') loop
      expected := link || jsonb_build_object('product_id', product_row.id, 'aroma_id', aroma_map->(link->>'aroma_id'));
      select * into link_row from public.product_aromas
        where product_id = product_row.id and aroma_id = (expected->>'aroma_id')::uuid for update;
      if not found then
        insert into public.product_aromas(product_id, aroma_id, legacy_aroma_id, sort_order, is_default, is_active,
          name_override, color_override, use_neutral_color)
        select r.product_id, r.aroma_id, r.legacy_aroma_id, r.sort_order, r.is_default, r.is_active,
          r.name_override, r.color_override, r.use_neutral_color
        from jsonb_populate_record(null::public.product_aromas, expected) r returning * into link_row;
        created_links := created_links + 1;
      end if;
      if to_jsonb(link_row) - array['created_at','updated_at'] <> expected then
        raise exception 'Aromas de % editados o diferentes. Revisar; no se sobrescribieron.', item->>'external_id';
      end if;
    end loop;
    if (select count(*) from public.product_aromas where product_id = product_row.id) <> jsonb_array_length(item->'aromas') then
      raise exception 'Producto % tiene otras asociaciones de aromas. Revisar; no se eliminaron.', item->>'external_id';
    end if;
  end loop;
  raise notice 'Filas creadas: categorías %, aromas %, productos %, inventarios %, relaciones %.',
    created_categories, created_aromas, created_products, created_inventory, created_links;
end;
$calefica_import$;
commit;
