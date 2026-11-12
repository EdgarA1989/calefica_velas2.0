# Panel administrativo de Calefica

## Acceso

Abrir `/admin/` en el sitio publicado. Para desarrollo, ejecutar `npm.cmd run dev` y abrir `http://127.0.0.1:8086/admin/`.

Ingresar con el email y contraseña de un usuario de Supabase Auth que tenga membresía en `admin_users`. La cuenta GitHub del Dashboard es independiente. Usar **Cerrar sesión** en equipos compartidos.

El botón de la vela cambia entre modo claro y oscuro. La preferencia `calefica-theme` se comparte con la tienda en el mismo origen.

## Uso diario

- **Resumen:** productos publicados, ocultos y sin stock. Una categoría oculta retira sus productos del catálogo público.
- **Categorías:** crear, renombrar, ordenar y mostrar/ocultar. “Mostrar sin productos” permite preparar una categoría vacía.
- **Aromas:** nombre, color HEX opcional, orden y estado. Un aroma desactivado deja de ofrecerse.
- **Productos:** buscar, crear, editar, publicar/ocultar y eliminar con confirmación. Ingresar precios sin separador de miles, por ejemplo `22000` o `22000,50`. Disponibilidad comercial y cantidad interna son independientes.
- **Aromas del producto:** asignar opciones y elegir el predeterminado. Los identificadores importados se conservan para los carritos existentes.
- **Imágenes:** guardar primero el producto. Subir JPG, PNG, WebP o AVIF de hasta 5 MiB, elegir principal y ordenar. Los fallos parciales se informan en pantalla.
- **Configuración:** WhatsApp, Instagram, email público e información comercial.

Los formularios bloquean envíos duplicados y avisan si hay cambios sin guardar. Si otra sesión editó el producto, actualizar antes de volver a guardar.

Los cambios se guardan en Supabase. La tienda consulta al cargar, al recuperar foco y cada 10 minutos mientras está visible, renovando las URLs firmadas de las imágenes. No persiste una copia del catálogo fuera de línea. No hace falta subir HTML para cambiar productos.

Eliminar un producto conserva sus archivos de Storage. Cualquier limpieza de huérfanos debe hacerse con la API o el gestor de Storage y revisar previamente qué archivos se usan. No borrar filas de `storage.objects` por SQL.

## Recuperación de contraseña

En el ingreso, usar **Olvidé mi contraseña**, o abrir `/admin/recover.html`. El formulario envía el email solo cuando lo solicita el usuario. Abrir el enlace recibido, ingresar y repetir una contraseña de al menos 12 caracteres y volver al ingreso. Los enlaces vencidos no habilitan el cambio.

En Supabase, **Authentication → URL Configuration**, permitir la URL HTTPS exacta de `/admin/recover.html` del dominio publicado. Para desarrollo, agregar `http://127.0.0.1:8086/admin/recover.html`. El origen y puerto deben coincidir. Configurar también Site URL para el dominio de producción.

El envío depende de la configuración de correo y límites de Supabase. Las pruebas locales usan simulaciones y no comprueban la entrega real.

`invalid_credentials` ocurre antes de verificar la membresía. Otorgar rol de administrador no cambia la contraseña. `supabase/manual/diagnose_login.sql` permite revisar el estado de la cuenta sin mostrar hashes.

## Mantenimiento

Consultar [Supabase y permisos](SUPABASE.md) para preparar otro entorno o dar de alta un administrador. Las imágenes nuevas se cargan desde la ficha del producto; la pantalla temporal de importación se retiró tras completar la migración.

El catálogo usa un cliente sin sesión administrativa, incluso si el administrador está conectado en ese navegador. Inventario y membresías permanecen protegidos por RLS.
