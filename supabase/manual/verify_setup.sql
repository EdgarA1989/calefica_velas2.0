-- Solo lectura. Ejecutar como postgres después de las dos migraciones.
-- No inserta fixtures, usuarios ni datos comerciales.
begin read only;

do $$
declare
  table_name text;
  relation_id regclass;
begin
  foreach table_name in array array[
    'categories', 'products', 'product_inventory', 'product_images',
    'aromas', 'product_aromas', 'admin_users', 'site_settings'
  ] loop
    relation_id := to_regclass('public.' || table_name);
    if relation_id is null then raise exception 'Falta tabla public.%', table_name; end if;
    if not (select relrowsecurity from pg_class where oid = relation_id) then
      raise exception 'RLS no está habilitado en public.%', table_name;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name) then
      raise exception 'No hay políticas en public.%', table_name;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.product_inventory', 'select')
     or has_table_privilege('anon', 'public.admin_users', 'select') then
    raise exception 'Existen grants públicos sobre datos internos.';
  end if;
  if has_table_privilege('authenticated', 'public.admin_users', 'insert')
     or has_table_privilege('authenticated', 'public.admin_users', 'update')
     or has_table_privilege('authenticated', 'public.admin_users', 'delete') then
    raise exception 'El cliente puede modificar membresías administrativas.';
  end if;
  if not exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'private' and f.proname = 'is_admin' and f.prosecdef
      and pg_get_userbyid(f.proowner) = 'postgres' and 'search_path=""' = any(f.proconfig)) then
    raise exception 'Revisar propietario, SECURITY DEFINER y search_path de private.is_admin().';
  end if;
  if not exists (select 1 from storage.buckets
    where id = 'product-images' and public = false and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']) then
    raise exception 'Falta el bucket privado o su configuración no coincide.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'Storage no tiene RLS habilitado.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname like 'calefica_images_%') <> 5 then
    raise exception 'Faltan políticas Storage de Calefica.';
  end if;
  raise notice 'Verificación estructural aprobada. Auth y API Storage requieren comprobación en Dashboard/HTTP.';
end;
$$;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in (
  'categories', 'products', 'product_inventory', 'product_images',
  'aromas', 'product_aromas', 'admin_users', 'site_settings'
)) or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

commit;
