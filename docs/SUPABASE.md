# Supabase: configuración y mantenimiento

El catálogo, las imágenes y el panel utilizan Supabase. El sitio sigue siendo HTML, CSS y JavaScript estáticos; Node solo se usa en desarrollo.

## Configuración del navegador

`js/config.js` contiene la URL del proyecto, la clave `sb_publishable_…` y el WhatsApp de respaldo. `js/config.example.js` es la plantilla para otro entorno. La clave publicable es visible en el navegador; la autorización se controla mediante Auth, grants y RLS. Nunca colocar contraseñas ni claves secret/service_role en estos archivos.

Cambiar la configuración no copia datos ni imágenes a otro proyecto. Git conserva el código y el esquema, no un backup de PostgreSQL o Storage.

## Preparar una base nueva

Las migraciones ya aplicadas al proyecto actual se conservan como historial del esquema. Para un proyecto **nuevo**, ejecutar sus archivos completos, en orden, como `postgres` desde SQL Editor:

1. [`20261030000100_catalog_schema.sql`](../supabase/migrations/20261030000100_catalog_schema.sql): tablas, relaciones, restricciones, permisos y RLS.
2. [`20261030000200_product_storage.sql`](../supabase/migrations/20261030000200_product_storage.sql): bucket privado `product-images` y políticas.
3. [`20261030000300_admin_operations.sql`](../supabase/migrations/20261030000300_admin_operations.sql): guardado atómico de productos, imagen principal y configuración.
4. [`verify_setup.sql`](../supabase/manual/verify_setup.sql): verificación estructural de solo lectura.

No repetir las migraciones sobre una base ya instalada. Los cambios futuros del esquema deben ir en archivos nuevos. Si más adelante se usa Supabase CLI, reconciliar primero su historial con las migraciones aplicadas manualmente.

## Administradores

Desactivar **Allow new users to sign up** en Authentication. Mantener Email habilitado para login con contraseña y deshabilitar los accesos anónimos.

Crear el usuario desde **Authentication → Users**, confirmar su email y copiar su UUID. Ejecutar [`grant_admin.sql`](../supabase/manual/grant_admin.sql) como `postgres`, reemplazando el valor de `target_user_text`. Este archivo comprueba que exista el usuario y concede membresía sin modificar su contraseña.

Los archivos manuales son plantillas. Guardar las copias con datos personales en `credentials/`, excluido de Git. El acceso con GitHub al Dashboard no concede acceso al panel de la web.

Configurar Site URL y las Redirect URLs de recuperación para el dominio de producción; ver [guía del panel](ADMIN_GUIDE.md).

## Permisos y archivos

- Visitantes: catálogo publicado en categorías activas, incluidos los agotados; sin inventario ni escritura.
- Administradores: gestión del catálogo, inventario e imágenes mediante su membresía.
- Membresías: se conceden con SQL privilegiado; el cliente no puede otorgárselas.

No exponer el esquema `private` en Data API ni agregar políticas permisivas sobre inventario, membresías o Storage.

El bucket `product-images` es privado. Admite imágenes de hasta 5 MiB en JPEG, PNG, WebP o AVIF. Las URLs del catálogo se firman por 15 minutos; ocultar un producto impide emitir firmas públicas nuevas, pero una URL emitida sigue funcionando hasta vencer.

## Comprobaciones

`npm.cmd test` valida servicios, PostgreSQL en memoria y navegador con datos simulados. `npm.cmd run test:db` ejecuta únicamente las pruebas de base. Las pruebas de navegador requieren Edge y se omiten cuando no está instalado.

`node scripts/check-supabase.cjs` realiza consultas remotas de solo lectura con la clave publicable para revisar catálogo, permisos y registro público. No modifica datos.

No publicar SQL, tests, herramientas, exportaciones, `.git` ni archivos privados en el directorio público del hosting. Publicar los archivos indicados en el [README](../README.md).
