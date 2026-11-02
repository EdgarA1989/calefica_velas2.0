# Etapa 2 — Tablas y seguridad en calefica-dev

Actualización: el usuario informó que aplicó esta etapa. El panel y la migración adicional de operaciones administrativas están en [ADMIN_GUIDE.md](ADMIN_GUIDE.md). El resto de esta guía conserva las instrucciones originales de instalación; no volver a ejecutar migraciones ya aplicadas.

## Estado y alcance

Migraciones preparadas localmente para el proyecto `wctxbatvmxurhmzpuwfg`. No se aplicaron al Supabase remoto: la URL y clave publicable recibidas no autorizan DDL ni administración de Auth. La ejecución se hace desde tu sesión del Dashboard; no hace falta compartir claves privadas.

Se conserva HTML/CSS/JS, el catálogo de Sheets, sus imágenes y su funcionamiento. No hay React, Vite ni backend. `package.json` solo permite ejecutar pruebas locales; su única dependencia de desarrollo es PostgreSQL en WASM (PGlite). No se publica `node_modules` en Hostinger ni se requiere Node en el servidor.

La base inicial contempla los campos comprobados en código/plantilla. Puede crearse vacía en **desarrollo**. La importación sigue pendiente de la exportación completa, incluidas filas ocultas y validaciones de aromas; no confundir las muestras CSV con el catálogo vivo.

## 1. Aplicar las migraciones

En el Dashboard de **calefica-dev**, abrir **SQL Editor → New query**. Ejecutar cada archivo completo, una sola vez y en este orden:

1. [`20261030000100_catalog_schema.sql`](../supabase/migrations/20261030000100_catalog_schema.sql): ocho tablas, índices, relaciones, constraints, timestamps, grants y RLS.
2. [`20261030000200_product_storage.sql`](../supabase/migrations/20261030000200_product_storage.sql): bucket privado y cinco políticas Storage.
3. [`verify_setup.sql`](../supabase/manual/verify_setup.sql): comprobación estructural de solo lectura. Si algo falta o no coincide, devuelve una excepción concreta; si termina bien, muestra las políticas existentes.

No crear las tablas manualmente en Table Editor antes de ejecutar SQL. Usar el rol `postgres` del SQL Editor. Si un nombre de tabla/bucket ya existe, la migración falla para no sobrescribirlo. No borrar objetos ni añadir `DROP` para forzar su ejecución: revisar el error y adaptar una migración nueva.

Cada migración está envuelta en `begin`/`commit`: un error revierte ese archivo, no el anterior ya completado. Si la primera terminó correctamente y la segunda falló, corregir y repetir solo la segunda. Si ejecutaste manualmente `begin` y quedó una transacción abortada en la misma sesión, cerrar esa transacción con `rollback` antes de reintentar. No se ejecutan DELETE/TRUNCATE de datos comerciales.

Al ejecutar desde SQL Editor, conservar en el historial los nombres/orden de archivos aplicados. No se registra automáticamente el historial de Supabase CLI. Si después usamos CLI, habrá que reconciliar su historial con las migraciones manuales antes de ejecutar `db push`.

El bucket se limita a **5 MiB por imagen**, MIME `image/jpeg`, `image/png`, `image/webp` o `image/avif`. Las rutas admitidas son `products/<UUID-del-producto>/<nombre-seguro>.<extension>`; el producto debe existir antes de subir. Se pueden subir imágenes de productos ocultos como administrador. Los archivos sin asociación solo son visibles para el administrador y no se publican por accidente.

No hay seed de productos, teléfonos ficticios ni aromas inventados. Souvenir y la exclusión de Clásicas se configurarán al importar/revisar las categorías reales.

## 2. Preparar el acceso administrativo

En **Authentication → Sign In / Providers**, buscar la opción **Allow new users to sign up** y desactivarla; guardar. Dejar Email habilitado para login con contraseña y deshabilitar anonymous sign-ins. Los nombres de grupos pueden variar; la opción relevante es el registro de nuevos usuarios. La configuración de Auth no se cambia con estas migraciones SQL. [Referencia de configuración Auth](https://supabase.com/docs/guides/auth/general-configuration).

En **Authentication → Users → Add user / Create new user**, crear el usuario de administración con tu email y una contraseña propia, y confirmar su email desde el flujo administrativo correspondiente. No compartir ni guardar esa contraseña en el repositorio. Entrar al Dashboard mediante GitHub no crea automáticamente este usuario de la aplicación.

Copiar el **UUID** del usuario nuevo. Abrir [`grant_admin.sql`](../supabase/manual/grant_admin.sql) en una consulta nueva del SQL Editor, reemplazar **solo el valor asignado a `target_user_text`** por ese UUID y ejecutar como `postgres`. El archivo comprueba que exista en `auth.users` y crea una membresía `admin`. Puede repetirse sin duplicarla. No modifica contraseñas ni envía mensajes.

El panel `/admin` se implementará en la etapa siguiente. Crear el usuario y la membresía prepara su autorización; todavía no habilita una pantalla de login en el sitio actual. La comprobación de sesión desde JavaScript se complementará con RLS. [Referencia de usuarios Auth](https://supabase.com/docs/guides/auth/managing-user-data).

## 3. Qué permiten las políticas

| Actor | Catálogo | Inventario | Escritura de catálogo | Membresías | Imágenes |
| --- | --- | --- | --- | --- | --- |
| Visitante | Solo publicados en categorías activas; agotados visibles | Sin acceso | Sin acceso | Sin acceso | Solo vinculadas a productos publicados |
| Usuario autenticado sin rol | Igual que visitante | Cero filas | Sin acceso | Solo su fila, si existiera | Sin escritura |
| Administrador | Incluye ocultos | Lectura y edición | CRUD | Solo lectura de su fila; sin escritura | Gestión dentro de `product-images` |
| Administrador revocado | Igual que usuario sin rol | Cero filas | Sin acceso | Sin membresía | Sin escritura |

`private.is_admin()` consulta la membresía con propietario controlado y `search_path` fijo, evitando políticas recursivas. No exponer `private` en la lista **Exposed schemas** de Data API. Tampoco crear políticas adicionales de tipo `using (true)` sobre inventario, membresías o Storage: las políticas permisivas se suman con OR y podrían abrir accesos. El script de verificación muestra también otras políticas Storage si existiesen, para revisarlas. [Referencia RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Storage es privado. El futuro servicio de imágenes usará `createSignedUrl()` después de la autorización de lectura. Ocultar un producto impide emitir nuevas URLs públicas para su imagen; una URL ya firmada permanece utilizable hasta caducar. No usar `getPublicUrl()` para este bucket. La API de Storage aplica las restricciones de MIME/tamaño; las pruebas SQL locales no sustituyen esa validación HTTP. [Referencia Storage](https://supabase.com/docs/guides/storage/security/access-control).

Eliminar un producto borra sus metadatos dependientes e inventario, pero no los archivos de Storage. La limpieza de huérfanos deberá ejecutarse desde la API Storage por un administrador con confirmación. No eliminar registros de `storage.objects` mediante SQL en el proyecto real.

`site_settings` solo admite WhatsApp, Instagram, email público, nombre/descripción comercial y moneda ARS, con valores tipados. Cantidad y texto interno se guardan en `product_inventory`; la disponibilidad del producto sigue siendo un booleano independiente y no descuenta stock por un mensaje de WhatsApp.

## 4. Validación local reproducible

```powershell
npm.cmd ci
npm.cmd test
```

`npm.cmd run test:db` ejecuta solo las pruebas de base. PGlite ejecuta las migraciones reales en una base PostgreSQL temporal en memoria, con tablas/roles mínimos que simulan los contratos `auth` y `storage`. Se comprueban consultas por rol, joins, CRUD, altas de membresía denegadas, revocación, imágenes ocultas/huérfanas, rutas, otras carpetas/buckets, restricciones y triggers. Todos los fixtures quedan en memoria y se descartan; ninguna prueba contacta con el proyecto remoto.

La prueba de navegador usa Edge headless y se omite si el ejecutable no está instalado. Esta prueba simula Sheets, no Supabase. En Windows el runner puede necesitar autorización para crear subprocesos fuera del sandbox.

Build no aplicable: el sitio no tiene compilación. Los archivos de pruebas, SQL, configuración privada, CSV de exportación y herramientas locales no se suben a Hostinger.

## 5. Qué queda por verificar en el proyecto real

- [ ] Ambas migraciones aplicadas y `verify_setup.sql` completado.
- [ ] Signup deshabilitado, Email habilitado y usuario administrador creado/confirmado.
- [ ] Membresía concedida mediante el SQL manual.
- [ ] Data API no expone el esquema `private`.
- [ ] Peticiones reales con clave publicable: lectura pública permitida y escritura denegada; autenticado sin membresía también denegado.
- [ ] Login, sesión vencida/revocada, logout y acceso admin probados al implementar los servicios.
- [ ] Subida y firma de imágenes por HTTP: permisos, tamaños, MIME y caducidad.
- [ ] Exportación completa contrastada antes de importar; ajustes como migraciones nuevas si aparecen diferencias.

Esta etapa entrega el SQL y su validación local. La ejecución remota, configuración Auth y pruebas HTTP reales siguen pendientes hasta aplicar los archivos en el Dashboard. Sheets continúa siendo el proveedor seleccionado.
