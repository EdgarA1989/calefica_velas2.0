-- Ejecutar una sola vez en calefica-dev, como postgres (SQL Editor).
-- No importa datos de Sheets ni cambia el frontend. Transacción completa.
begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order integer not null default 9999,
  is_active boolean not null default true,
  show_when_empty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  source_system text check (length(btrim(source_system)) > 0),
  external_id text check (length(btrim(external_id)) > 0),
  name text not null check (length(btrim(name)) between 1 and 240),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  price numeric(12,2) not null check (price >= 0 and price <> 'NaN'::numeric),
  category_id uuid not null references public.categories(id) on delete restrict,
  sort_order integer not null default 9999,
  is_active boolean not null default false,
  is_featured boolean not null default false,
  is_available boolean not null default true,
  whatsapp_override text check (whatsapp_override ~ '^[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_source_pair check ((source_system is null) = (external_id is null)),
  constraint products_external_identity unique (source_system, external_id)
);

-- cantidadStock es texto libre e interno; nunca se convierte silenciosamente a cero.
create table public.product_inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity integer check (quantity >= 0),
  legacy_quantity_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  original_filename text,
  alt_text text not null default '',
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_path check (
    storage_path ~ ('^products/' || product_id::text || '/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|avif)$')
  )
);
create unique index product_images_one_primary on public.product_images(product_id) where is_primary;
create index product_images_product_order on public.product_images(product_id, sort_order, id);

create table public.aromas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_aromas (
  product_id uuid not null references public.products(id) on delete cascade,
  aroma_id uuid not null references public.aromas(id) on delete restrict,
  legacy_aroma_id text check (length(btrim(legacy_aroma_id)) > 0),
  sort_order integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  name_override text check (length(btrim(name_override)) between 1 and 160),
  color_override text check (color_override ~ '^#[0-9a-fA-F]{6}$'),
  use_neutral_color boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, aroma_id),
  unique (product_id, legacy_aroma_id),
  constraint product_aromas_neutral check (not use_neutral_color or color_override is null)
);
create unique index product_aromas_one_default on public.product_aromas(product_id) where is_default and is_active;
create index product_aromas_aroma on public.product_aromas(aroma_id);
create index product_aromas_product_order on public.product_aromas(product_id, sort_order);
create index products_category_order on public.products(category_id, is_active, sort_order, id);
create index products_public_order on public.products(sort_order, id) where is_active;
create index categories_public_order on public.categories(sort_order, id) where is_active;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now()
);

-- Solo configuración PUBLICA: cada clave y el tipo/forma de su valor son explícitos.
create table public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint site_settings_public_values check (
    jsonb_typeof(value) = 'string' and
    case key
      when 'whatsapp_number' then value #>> '{}' ~ '^[1-9][0-9]{7,14}$'
      when 'instagram_url' then value #>> '{}' ~ '^https://(www\.)?instagram\.com/[a-zA-Z0-9._]+/?$'
      when 'contact_email' then value #>> '{}' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when 'business_name' then length(btrim(value #>> '{}')) between 1 and 160
      when 'business_description' then length(value #>> '{}') <= 5000
      when 'currency' then value #>> '{}' = 'ARS'
      else false
    end
  )
);

-- Propietario postgres para evitar recursión al consultar la membresía con RLS.
-- No admite parámetros: no puede consultar permisos de otro usuario.
create function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;
alter function private.is_admin() owner to postgres;
revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

create function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'categories', 'products', 'product_inventory', 'product_images',
    'aromas', 'product_aromas', 'site_settings'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', table_name);
  end loop;
end;
$$;

-- Grants explícitos: no depender de los privilegios por defecto de Supabase.
revoke all on public.categories, public.products, public.product_inventory,
  public.product_images, public.aromas, public.product_aromas,
  public.admin_users, public.site_settings from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.product_images,
  public.aromas, public.product_aromas, public.site_settings to anon, authenticated;
grant select on public.product_inventory, public.admin_users to authenticated;
grant insert, update, delete on public.categories, public.products,
  public.product_inventory, public.product_images, public.aromas,
  public.product_aromas, public.site_settings to authenticated;
-- NO grant de escritura de admin_users: altas/revocaciones solo por postgres.

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_inventory enable row level security;
alter table public.product_images enable row level security;
alter table public.aromas enable row level security;
alter table public.product_aromas enable row level security;
alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;

create policy categories_published on public.categories for select to anon, authenticated
  using (is_active);
create policy products_published on public.products for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.categories c where c.id = products.category_id and c.is_active
  ));
create policy product_images_published on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_images.product_id
    and p.is_active and exists (select 1 from public.categories c where c.id = p.category_id and c.is_active)));
create policy product_aromas_published on public.product_aromas for select to anon, authenticated
  using (is_active
    and exists (select 1 from public.products p where p.id = product_aromas.product_id
      and p.is_active and exists (select 1 from public.categories c where c.id = p.category_id and c.is_active))
    and exists (select 1 from public.aromas a where a.id = product_aromas.aroma_id and a.is_active));
create policy aromas_published on public.aromas for select to anon, authenticated
  using (is_active);
create policy site_settings_public on public.site_settings for select to anon, authenticated
  using (true);
create policy admin_users_own_membership on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

-- Una política por operación hace explícitos tanto USING como WITH CHECK.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'categories', 'products', 'product_inventory', 'product_images',
    'aromas', 'product_aromas', 'site_settings'
  ] loop
    execute format('create policy admin_select on public.%I for select to authenticated using ((select private.is_admin()))', table_name);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select private.is_admin()))', table_name);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', table_name);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select private.is_admin()))', table_name);
  end loop;
end;
$$;

comment on table public.product_inventory is 'Solo administración. quantity no modifica is_available ni limita pedidos por WhatsApp.';
comment on table public.admin_users is 'Membresías gestionadas por postgres; ningún cliente puede autoasignarse permisos.';
comment on table public.site_settings is 'Solo información pública del negocio, nunca credenciales ni notas internas.';
comment on column public.products.source_system is 'Identifica la fuente concreta (por ejemplo sheets:<spreadsheet-id>), no solo el proveedor.';

commit;
