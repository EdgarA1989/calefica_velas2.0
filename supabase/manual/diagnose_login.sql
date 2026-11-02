-- Diagnóstico de solo lectura desde SQL Editor como postgres.
-- No devuelve contraseñas ni hashes y no cambia usuarios o permisos.
-- Revisar el usuario por email en el proyecto calefica-dev.
select
  u.email,
  u.email_confirmed_at is not null as email_confirmado,
  coalesce(length(u.encrypted_password) > 0, false) as tiene_password_asignada,
  coalesce(u.banned_until > now(), false) as bloqueo_vigente,
  exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  ) as identidad_email,
  exists (
    select 1 from public.admin_users a
    where a.user_id = u.id and a.role = 'admin'
  ) as tiene_rol_admin
from auth.users u
where lower(u.email) = lower('REEMPLAZAR_EMAIL_DEL_ADMIN');
