-- Operaciones atómicas del panel. SECURITY INVOKER conserva RLS.
begin;

create function public.admin_save_product(payload jsonb)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  product_uuid uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  previous_updated_at timestamptz;
  selected_aromas jsonb := coalesce(payload->'aroma_ids', '[]'::jsonb);
  aroma_uuid uuid;
  position integer := 0;
begin
  if not (select private.is_admin()) then
    raise exception 'Acceso administrativo requerido.' using errcode = '42501';
  end if;
  if jsonb_typeof(selected_aromas) <> 'array' then
    raise exception 'La lista de aromas no es válida.' using errcode = '22023';
  end if;
  if nullif(payload->>'id', '') is not null then
    select updated_at into previous_updated_at from public.products where id = product_uuid for update;
    if not found then raise exception 'El producto ya no existe.' using errcode = 'P0002'; end if;
    if nullif(payload->>'expected_updated_at', '') is null
       or previous_updated_at <> (payload->>'expected_updated_at')::timestamptz then
      raise exception 'El producto cambió en otra sesión. Recargá antes de guardar.' using errcode = '40001';
    end if;
    update public.products set
      name = btrim(payload->>'name'), slug = payload->>'slug',
      description = coalesce(payload->>'description', ''), price = (payload->>'price')::numeric,
      category_id = (payload->>'category_id')::uuid, sort_order = (payload->>'sort_order')::integer,
      is_active = (payload->>'is_active')::boolean, is_featured = (payload->>'is_featured')::boolean,
      is_available = (payload->>'is_available')::boolean,
      whatsapp_override = nullif(payload->>'whatsapp_override', '')
    where id = product_uuid;
  else
    insert into public.products(id, name, slug, description, price, category_id, sort_order,
      is_active, is_featured, is_available, whatsapp_override)
    values (product_uuid, btrim(payload->>'name'), payload->>'slug', coalesce(payload->>'description', ''),
      (payload->>'price')::numeric, (payload->>'category_id')::uuid, (payload->>'sort_order')::integer,
      (payload->>'is_active')::boolean, (payload->>'is_featured')::boolean, (payload->>'is_available')::boolean,
      nullif(payload->>'whatsapp_override', ''));
  end if;

  insert into public.product_inventory(product_id, quantity, legacy_quantity_text)
  values (product_uuid, nullif(payload->>'quantity', '')::integer, coalesce(payload->>'legacy_quantity_text', ''))
  on conflict (product_id) do update set quantity = excluded.quantity, legacy_quantity_text = excluded.legacy_quantity_text;

  -- Desactivar preserva identidad y overrides para futuras reactivaciones/importaciones.
  update public.product_aromas set is_default = false, is_active = false where product_id = product_uuid;
  for aroma_uuid in select value::uuid from jsonb_array_elements_text(selected_aromas) loop
    if not exists (select 1 from public.aromas where id = aroma_uuid) then
      raise exception 'El aroma elegido ya no existe.' using errcode = '23503';
    end if;
    insert into public.product_aromas(product_id, aroma_id, legacy_aroma_id, sort_order, is_default, is_active)
    values (product_uuid, aroma_uuid, aroma_uuid::text, position,
      coalesce(aroma_uuid = nullif(payload->>'default_aroma_id', '')::uuid, false), true)
    on conflict (product_id, aroma_id) do update set sort_order = excluded.sort_order,
      is_default = excluded.is_default, is_active = true;
    position := position + 1;
  end loop;
  if nullif(payload->>'default_aroma_id', '') is not null and not exists (
    select 1 from public.product_aromas where product_id = product_uuid and is_active and is_default
  ) then raise exception 'El aroma predeterminado debe estar asignado.' using errcode = '22023'; end if;
  return product_uuid;
end;
$$;

create function public.admin_set_primary_image(target_product uuid, target_image uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if not (select private.is_admin()) then raise exception 'Acceso administrativo requerido.' using errcode = '42501'; end if;
  perform 1 from public.products where id = target_product for update;
  if not found then raise exception 'El producto ya no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.product_images where id = target_image and product_id = target_product) then
    raise exception 'La imagen no pertenece al producto.' using errcode = '22023';
  end if;
  update public.product_images set is_primary = false where product_id = target_product and is_primary;
  update public.product_images set is_primary = true where id = target_image and product_id = target_product;
end;
$$;

create function public.admin_save_settings(settings jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
declare setting record;
begin
  if not (select private.is_admin()) then raise exception 'Acceso administrativo requerido.' using errcode = '42501'; end if;
  for setting in select key, value from jsonb_each(settings) loop
    if setting.key not in ('whatsapp_number', 'instagram_url', 'contact_email', 'business_name', 'business_description', 'currency') then
      raise exception 'La clave de configuración no está permitida.' using errcode = '22023';
    end if;
    if setting.value = 'null'::jsonb then
      delete from public.site_settings where key = setting.key;
    else
      insert into public.site_settings(key, value) values (setting.key, setting.value)
        on conflict (key) do update set value = excluded.value;
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_save_product(jsonb) from public, anon, authenticated;
revoke all on function public.admin_set_primary_image(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_save_settings(jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_product(jsonb) to authenticated;
grant execute on function public.admin_set_primary_image(uuid, uuid) to authenticated;
grant execute on function public.admin_save_settings(jsonb) to authenticated;
commit;
