# Calefica — Velas de soja

Web estática con HTML, CSS y JavaScript, catálogo Supabase y panel administrativo en `/admin/`. Conserva Google Sheets como proveedor alternativo seleccionable.

## Ejecutar localmente

Requiere Node >=22 para herramientas locales, no para el hosting:

```powershell
npm.cmd ci
npm.cmd run dev
```

- Tienda: http://127.0.0.1:8086/
- Panel: http://127.0.0.1:8086/admin/

`js/config.js` es la configuración pública versionada: proveedor, teléfono comercial, URL y clave **publicable** de Supabase. Es información que recibe cualquier navegador; los permisos se controlan mediante RLS y Auth. Nunca agregar claves secret/service_role, contraseñas o datos internos a este archivo. `js/config.example.js` es una plantilla para otro entorno. `js/config.local.js` se conserva excluido como copia local anterior y ya no se carga en las páginas.

La base de datos y Storage no se copian al clonar el repositorio. El proyecto Supabase configurado debe existir y tener el esquema/permisos aplicados. El usuario del panel debe crearse en Supabase Auth y recibir una membresía en `admin_users`. El registro público debe estar deshabilitado antes de publicar.

## Pruebas

```powershell
npm.cmd test
```

La suite usa PostgreSQL en memoria y servicios simulados. Las pruebas de navegador usan Edge headless y se omiten si no está instalado. No modifica datos remotos. Las verificaciones opcionales en línea están documentadas en las guías de migración.

## Publicación

No hay build ni backend Node/Express. Para Hostinger, publicar solo `index.html`, `admin/`, `css/`, `js/` y las imágenes necesarias de `assets/`. No copiar el repositorio completo a `public_html`: SQL, tests, herramientas, exports, archivos de entorno y `.git` no pertenecen al sitio publicado. Las secciones administrativas usan directorios HTML, sin router SPA.

El SDK de Supabase está fijado en `package-lock.json` y su bundle oficial se incluye en `js/vendor/`, con licencia. Para regenerarlo: `npm.cmd run vendor:supabase`.

## Documentación

- [Panel y recuperación de contraseña](docs/ADMIN_GUIDE.md)
- [Esquema, RLS y Storage](docs/SUPABASE_STAGE_2.md)
- [Configuración de Supabase](docs/SUPABASE_SETUP.md)
- [Exportación desde Google Sheets](docs/EXPORT_GOOGLE_SHEETS.md)
- [Preparación e importación de datos e imágenes](docs/IMPORT_GOOGLE_SHEETS.md)
- [Auditoría y plan](docs/MIGRATION_PLAN.md)

`imports/`, `reports/`, `credentials/`, archivos `.env*` y notas locales están excluidos de Git. Los SQL de `supabase/manual/` son plantillas; las copias personales completadas permanecen en `credentials/`.

Esta versión se mantiene en https://github.com/EdgarA1989/calefica_velas2.0. El repositorio anterior `calefica_velas` permanece como backup sin cambios; también se conserva su historial en esta copia. El código de GitHub no sustituye un backup de la base PostgreSQL ni de las imágenes Storage.
