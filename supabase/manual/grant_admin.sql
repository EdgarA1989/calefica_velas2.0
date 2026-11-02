-- SOLO SQL Editor como postgres. No ejecutar desde el frontend.
-- Crear primero el usuario email/contraseña en Authentication > Users.
-- Reemplazar el texto siguiente por el UUID de ese usuario, NO el de GitHub.
do $$
declare
  target_user_text text := 'REEMPLAZAR_UUID_DEL_USUARIO_AUTH';
  target_user uuid;
begin
  if target_user_text = 'REEMPLAZAR_UUID_DEL_USUARIO_AUTH' then
    raise exception 'Reemplazar el marcador por el UUID del usuario creado en Authentication > Users.';
  end if;
  target_user := target_user_text::uuid;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'El UUID indicado no existe en auth.users. Crear primero el usuario desde Authentication > Users.';
  end if;
  insert into public.admin_users(user_id, role) values (target_user, 'admin')
    on conflict (user_id) do nothing;
  raise notice 'Membresía administrativa preparada para %.', target_user;
end;
$$;
