# Configuración de Supabase con HTML, CSS y JavaScript

Se conserva la tecnología actual, sin React, Vite ni backend Node/Express.

## Estado

La configuración pública se versiona en `js/config.js`: proveedor, teléfono comercial, URL y clave publicable de Supabase. La copia anterior `js/config.local.js` permanece excluida y ya no se carga en la web. `js/config.example.js` sirve de plantilla para otro entorno. La tienda y el panel cargan configuración y SDK. El catálogo consulta Supabase tras verificar los 10 productos e imágenes públicos; la consulta anónima de inventario/administradores se rechazó. Ver [ADMIN_GUIDE.md](ADMIN_GUIDE.md) e [IMPORT_GOOGLE_SHEETS.md](IMPORT_GOOGLE_SHEETS.md). El ajuste de registro público sigue pendiente antes de publicar.

El archivo local solo contiene datos públicos de conexión; no funciona como almacén secreto. Cualquier archivo JavaScript servido por Hostinger puede leerse desde el navegador.

## Configuración pública

Al clonar este repositorio ya se incluye `js/config.js` para el proyecto actual. Para otro entorno, usar `js/config.example.js` como plantilla de `js/config.js` y completar solo la URL y clave publicable. No guardar credenciales privadas. Mantener `dataProvider: "sheets"` en un entorno nuevo hasta importar y validar su catálogo.

El prefijo `NEXT_PUBLIC_` de la pantalla corresponde al ejemplo Next.js. Aquí usamos propiedades de un objeto JavaScript. Un navegador sin herramientas de build no interpreta `.env.local`, `process.env` ni variables `VITE_*`.

La configuración se carga antes del cliente Supabase. El catálogo valida el proveedor y el cliente valida URL y clave. Al publicar, se debe incluir únicamente esta configuración pública junto con los archivos del sitio; nunca subir todo el repositorio al hosting.

No agregar claves `sb_secret_...`, `service_role`, contraseñas de base de datos ni credenciales de importación a archivos del sitio. Las operaciones privadas de importación tendrán configuración independiente fuera del directorio publicado.

## Próximos pasos

1. Obtener una exportación completa de productos, incluidos ocultos, hoja de aromas y reglas de desplegables. El CSV no conserva esas reglas; la API actual tampoco incluye los productos ocultos. Crear un exportador separado de solo lectura para obtenerlas, sin cambiar el endpoint en producción.
2. Contrastar la exportación con el SQL versionado preparado antes de cargar datos. Las tablas pueden crearse vacías en desarrollo para validar permisos; cualquier diferencia de datos se resolverá con una nueva migración, sin pérdida de valores originales.
3. Aplicar las migraciones al proyecto de desarrollo siguiendo `SUPABASE_STAGE_2.md` y verificar permisos de visitante, usuario sin rol y administrador.
4. Configurar Auth sin registro público, dar de alta al administrador y preparar Storage.
5. Implementar servicios JS y panel administrativo; mantener Sheets seleccionado hasta completar la validación de catálogo e imágenes.

El acceso con GitHub al Dashboard de Supabase es independiente del usuario que luego accederá al panel `/admin` de Calefica.

Referencias: [claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys) y [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
