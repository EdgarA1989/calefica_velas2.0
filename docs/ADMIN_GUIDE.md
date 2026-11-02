# Panel administrativo de Calefica

## Abrir el panel

Desde la carpeta del proyecto:

```powershell
npm.cmd run dev
```

Abrir `http://127.0.0.1:8086/admin/`. El servidor es solo para previsualizar localmente; en Hostinger se publican los archivos estáticos. No abrir el HTML con `file://`.

El panel utiliza email y contraseña del usuario de **Authentication → Users** que tenga membresía en `admin_users`. No utiliza la cuenta GitHub del Dashboard. No existe pantalla de registro. El navegador guarda una sesión de Supabase para recordar el acceso; usar **Cerrar sesión** en equipos compartidos.

El botón de las velas cambia entre modo claro y oscuro con la misma animación de soplar/encender de la tienda. Está disponible en el ingreso, en la cabecera del panel y en recuperación. La preferencia se guarda en `calefica-theme`, compartida con la tienda en el mismo origen, y se restaura antes de mostrar la página. El modo oscuro aplica a menús, tarjetas, formularios, modales y mensajes. Respeta la preferencia de reducir movimiento.

### Recuperar contraseña

En Supabase, **Authentication → URL Configuration → Redirect URLs**, agregar la URL exacta `http://127.0.0.1:8086/admin/recover.html` y guardar. Para producción, agregar la URL HTTPS equivalente del dominio publicado. Las URLs permitidas deben coincidir con el origen usado para abrir el formulario, incluido puerto y `127.0.0.1`/`localhost`.

En el ingreso, usar **Olvidé mi contraseña**, o abrir `/admin/recover.html`. El email se solicita únicamente al enviar ese formulario; no se enviaron correos mediante herramientas durante la implementación. Abrir el enlace recibido, elegir y repetir una contraseña de al menos 12 caracteres, guardar y volver al ingreso. Se utiliza Supabase Auth `resetPasswordForEmail`/`updateUser`, con la clave publicable; no se alteran hashes por SQL ni se recrea el usuario. La membresía administrativa se conserva.

La detección de tokens en URL se habilita únicamente en la página dedicada de recuperación. El catálogo público continúa sin sesión. El enlace vence y es de un solo uso; un enlace inválido no habilita el formulario de cambio. Las pruebas usan respuestas simuladas y no prueban entrega real de emails; los fallos SMTP o límites de envío se muestran en pantalla. El proyecto debe tener configurado el envío de correo y las plantillas deben respetar el destino de recuperación.

El diagnóstico `invalid_credentials` ocurre antes de verificar la membresía: asignar el rol `admin` por sí solo no cambia la contraseña. El archivo `supabase/manual/diagnose_login.sql` permite revisar estado de cuenta sin mostrar hashes. Después de recuperar la clave, si se informa falta de membresía, aplicar el alta administrativa de la guía de etapa 2.

Referencias: [recuperación de Supabase](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail) y [URLs de redirección](https://supabase.com/docs/guides/auth/redirect-urls).

## Aplicar la nueva migración antes de guardar

Las migraciones de tablas y Storage de la etapa anterior deben estar aplicadas. Además, ejecutar **una sola vez**, como `postgres` desde SQL Editor:

[`20261030000300_admin_operations.sql`](../supabase/migrations/20261030000300_admin_operations.sql).

Agrega tres funciones de guardado atómico: producto/inventario/aromas, selección de imagen principal y configuración pública. No carga productos ni modifica registros existentes al instalarse. Es `SECURITY INVOKER`: las operaciones siguen sujetas a RLS y verifican membresía. Si falta, el panel explica qué archivo ejecutar.

Revisar que **Allow new users to sign up** esté desactivado en Authentication. La comprobación de solo lectura realizada durante esta implementación devolvió `disable_signup: false`; no se cambió esa opción mediante la clave publicable.

## Uso diario

- **Resumen:** totales de productos, publicados, ocultos y sin stock. Una categoría oculta hace que sus productos cuenten como ocultos, aunque su publicación individual esté activada.
- **Categorías:** crear, renombrar, ocultar y editar orden. La opción mostrar sin productos permite preparar Souvenir. Una categoría oculta no se publica.
- **Aromas:** crear y editar nombre, color HEX opcional (por ejemplo `#B7A0D4`), orden y estado. Un aroma desactivado no se ofrece al visitante aunque siga asignado a un producto.
- **Productos:** buscar y filtrar; crear/editar, publicar/ocultar y eliminar con confirmación. Usar precios sin separador de miles, por ejemplo `22000` o `22000,50`. El identificador URL se sugiere al crear y debe ser único. La disponibilidad de pedidos es independiente de la cantidad interna.
- **Aromas por producto:** marcar las opciones y elegir un predeterminado o dejar “Primero de la lista”. Se conservan identificadores y overrides de asociaciones importadas. Quitar una asignación la desactiva para preservar identidad.
- **Imágenes:** guardar primero el producto. Subir varias imágenes JPG/PNG/WebP/AVIF de hasta 5 MiB cada una; se informan fallos parciales. El navegador intenta decodificarlas antes de subir. Definir principal y editar orden desde su ficha. Quitar imagen elimina su asociación y luego solicita borrar el archivo. Si falla esa limpieza, se informa que quedó un huérfano privado en Storage.
- **Configuración:** WhatsApp, Instagram, email público e información del negocio. Los campos opcionales vacíos retiran esa configuración. Solo admite claves públicas validadas por PostgreSQL.

Los formularios avisan por cambios sin guardar y bloquean doble envío. Si otra sesión cambió un producto, el guardado se rechaza para evitar sobrescribirla; cerrar el formulario y actualizar antes de intentar otra vez. Los guardados de inventario/aromas fallan junto con el producto, sin dejar una ficha parcialmente actualizada.

Eliminar un producto borra inventario y metadatos dependientes, pero conserva los archivos Storage. Esa limpieza debe hacerse con la API/gestor de Storage y confirmación; no borrar filas de `storage.objects` mediante SQL.

## Catálogo público durante la transición

`js/config.js` usa `dataProvider: "supabase"` en esta versión. Este archivo contiene únicamente configuración pública y está versionado para que funcione al clonar el repositorio. El panel y la tienda consultan la misma base: los cambios del panel aparecen al volver a consultar el catálogo. Se comprobaron 10 productos públicos con sus imágenes, y se conservó la edición de Vela Rosa Mosqueta a $9.500. Sheets sigue disponible como proveedor seleccionable para una reversión explícita.

La configuración local incluye `whatsappNumber` como valor público de respaldo, tomado del número confirmado para el catálogo. La clave `whatsapp_number` de Configuración en Supabase tiene prioridad cuando está definida. Las pruebas con fixtures fijan su propio proveedor para funcionar independientemente de la selección local.

`js/services/productsService.js` ya tiene ambos proveedores. Supabase consulta con un cliente sin sesión administrativa, conservando los permisos públicos incluso si el administrador tiene una sesión abierta en el mismo navegador. No lee inventario. Conserva IDs externos de productos y aromas para compatibilidad del carrito; resuelve categoría, disponibilidad, destacados y teléfonos, y firma imágenes privadas durante 15 minutos. Los enlaces de WhatsApp, Instagram y email se adaptan a la configuración pública recibida.

La importación y comparación pública se completaron antes del cambio local de proveedor. No hay fallback automático a Sheets. El proveedor Supabase no usa una caché persistida del catálogo; vuelve a consultar al recuperar foco y cada 10 minutos con la pestaña visible para renovar firmas. Los datos se actualizan sin recompilar ni volver a subir HTML.

La caché de Sheets sigue funcionando como antes. Las reglas especiales de Souvenir y Clásicas siguen en el proveedor existente; en Supabase corresponden a las categorías configuradas y sus políticas de publicación. No activar el proveedor nuevo mientras la base esté vacía esperando que replique por sí sola Sheets.

## Verificación

```powershell
npm.cmd ci
npm.cmd test
node scripts/check-supabase.cjs
```

Las pruebas SQL usan PostgreSQL en memoria con Auth/Storage simulados. Las de servicios usan respuestas simuladas. Las de Edge cubren login, formularios, errores de validación, filtros, categorías/aromas/configuración, imágenes, logout, revocación y respuestas tardías tras cerrar sesión a 1440/390/320 px. Una prueba adicional inicia el login con el SDK oficial real, sin sesión. No se probaron email/contraseña reales ni subidas al Storage remoto porque no se manejan contraseñas del usuario.

`check-supabase.cjs` es opcional y solo hace GET con la clave publicable local. Verifica lectura del catálogo, rechazo de acceso anónimo a inventario/administradores y configuración de registro; no imprime claves, usuarios ni respuestas con datos y no hace escrituras. Es independiente de `npm test`, que funciona sin conexión externa.

El SDK oficial `@supabase/supabase-js` está fijado en `package-lock.json` y copiado sin cambios en `js/vendor/`. Puede regenerarse con `npm.cmd run vendor:supabase`. No se necesita CDN, React, Vite ni backend.

## Publicación estática posterior

Publicar únicamente `index.html`, `admin/`, `css/`, `assets/` necesarios y `js/`, incluida la configuración **pública** local correspondiente. No subir `.git`, `.env*`, `Calefica-dev.txt`, SQL, tests, herramientas, `node_modules` ni archivos de exportación. El servidor local usa una lista de directorios públicos y rechaza `.git`/`.env`.

En Hostinger, `/admin/` se resuelve con `admin/index.html`; las secciones internas son pestañas, sin router ni rewrite SPA. Usar HTTPS. Esta implementación no se publicó ni hizo push a producción.

Referencia de autenticación: [SDK oficial de Supabase](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
