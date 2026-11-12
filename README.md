# Calefica — Velas de soja

Web estática con HTML, CSS y JavaScript, catálogo e imágenes en Supabase y panel administrativo en `/admin/`.

## Ejecutar localmente

Requiere Node >=22 para herramientas locales, no para el hosting:

```powershell
npm.cmd ci
npm.cmd run dev
```

- Tienda: http://127.0.0.1:8086/
- Panel: http://127.0.0.1:8086/admin/

`js/config.js` es la configuración pública versionada: teléfono comercial, URL y clave **publicable** de Supabase. Es información que recibe cualquier navegador; los permisos se controlan mediante RLS y Auth. Nunca agregar claves secret/service_role, contraseñas o datos internos a este archivo. `js/config.example.js` es una plantilla para otro entorno.

La base de datos y Storage no se copian al clonar el repositorio. El proyecto Supabase configurado debe existir y tener el esquema/permisos aplicados. El usuario del panel debe crearse en Supabase Auth y recibir una membresía en `admin_users`. El registro público debe estar deshabilitado antes de publicar.

## Pruebas

```powershell
npm.cmd test
```

La suite usa PostgreSQL en memoria y servicios simulados. Las pruebas de navegador usan Edge headless y se omiten si no está instalado. No modifica datos remotos.

## Herramientas de mantenimiento

- `scripts/serve-static.cjs`: servidor local, usado por `npm.cmd run dev`.
- `scripts/vendor-supabase.cjs`: actualiza el bundle oficial del SDK, usado por `npm.cmd run vendor:supabase`.
- `scripts/check-supabase.cjs`: comprobación opcional de lectura pública, permisos y registro de usuarios; solo hace consultas remotas.
- `scripts/check-git-secrets.cjs`: revisa archivos candidatos a Git y configuración pública antes de subir cambios.

## Publicación

No hay build ni backend Node/Express. Para Hostinger, publicar solo `index.html`, `admin/`, `css/`, `js/` y las imágenes necesarias de `assets/`. No copiar el repositorio completo a `public_html`: SQL, tests, herramientas, exports, archivos de entorno y `.git` no pertenecen al sitio publicado. Las secciones administrativas usan directorios HTML, sin router SPA.

El SDK de Supabase está fijado en `package-lock.json` y su bundle oficial se incluye en `js/vendor/`, con licencia. Para regenerarlo: `npm.cmd run vendor:supabase`.

## Documentación

- [Panel y recuperación de contraseña](docs/ADMIN_GUIDE.md)
- [Configuración, esquema y permisos de Supabase](docs/SUPABASE.md)

`imports/`, `reports/`, `credentials/`, `local-backups/`, archivos `.env*` y notas locales están excluidos de Git. Los archivos de la importación completada se conservan únicamente como respaldo local comprimido en `local-backups/`; no se publican. Los SQL de `supabase/manual/` son plantillas; las copias personales completadas permanecen en `credentials/`.

Esta versión se mantiene en https://github.com/EdgarA1989/calefica_velas2.0. El repositorio anterior `calefica_velas` permanece como backup sin cambios; también se conserva su historial en esta copia. El código de GitHub no sustituye un backup de la base PostgreSQL ni de las imágenes Storage.

La migración desde Google Sheets está completada. Sus scripts, pantalla de importación, pruebas específicas, guías históricas y fotos de ejemplo se retiraron de la versión actual; pueden recuperarse del historial de Git. La tienda consulta Supabase y el panel administra allí los productos y las imágenes.
