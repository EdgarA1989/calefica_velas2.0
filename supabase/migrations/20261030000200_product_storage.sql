-- Requiere la migración de catálogo. No modifica otros buckets ni sus políticas.
begin;

-- Falla si ya existe: no convertir un bucket con datos a otro régimen silenciosamente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

-- Upload solo para rutas del producto existente. La UI generará el nombre UUID/hash.
create function private.valid_product_image_path(object_name text)
returns boolean language sql stable set search_path = ''
as $$
  select object_name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|avif)$'
    and exists (select 1 from public.products p
      where p.id::text = split_part(object_name, '/', 2));
$$;
revoke all on function private.valid_product_image_path(text) from public, anon, authenticated;
grant execute on function private.valid_product_image_path(text) to authenticated;

create policy calefica_images_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images' and exists (
    select 1 from public.product_images i
    join public.products p on p.id = i.product_id
    join public.categories c on c.id = p.category_id
    where i.storage_path = storage.objects.name and p.is_active and c.is_active
  ));

create policy calefica_images_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));
create policy calefica_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_admin())
    and private.valid_product_image_path(name));
create policy calefica_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()))
  with check (bucket_id = 'product-images' and (select private.is_admin())
    and private.valid_product_image_path(name));
create policy calefica_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));

-- La eliminación de un producto borra metadatos, NO objetos de Storage.
-- El admin puede limpiar huérfanos desde la API Storage; nunca DELETE SQL de objetos.
-- La API Storage de Supabase ya habilita RLS y grants en storage.objects.
-- Bucket privado: usar createSignedUrl; las firmas previas viven hasta su expiración.
commit;
