# Importación del snapshot de Calefica a Supabase

## Archivos preparados

La exportación recibida se copió sin modificar a `imports/calefica/`. Ese directorio está excluido de Git y no se sirve por HTTP. Contiene:

- `informe.json`: plan normalizado, alertas y corrección de teléfono aprobada.
- `correcciones-telefono.json`: la decisión explícita de usar `5491136550811` también en Box Aromático; no cambia el snapshot original.
- `importar-catalogo.sql`: carga de categorías, aromas, productos, inventario y asociaciones.
- `manifiesto-imagenes.json`: correspondencias de productos/archivos/rutas de Storage y hashes SHA-256.
- `imagenes/`: los 11 originales descargados de Drive, validados por MIME, firma de archivo, tamaño exacto y hash para su transferencia. No son thumbnails.

Resultado: **11 productos, 6 categorías, 7 aromas y 77 asociaciones**. Hay 10 productos visibles en el catálogo: Velas Clásicas se conserva con su categoría oculta, como en la web anterior. Peonias Souvenir sigue visible pero sin stock. No existe hoja maestra `aromas`; las opciones vienen de los desplegables y se conservan sin inventar colores. La celda seleccionada no se convierte en predeterminado: se mantiene la lógica existente de primera opción efectiva.

## 1. Cargar datos en Supabase

Abrir `imports/calefica/importar-catalogo.sql`, copiar el contenido completo y ejecutarlo en **calefica-dev → SQL Editor**, como rol `postgres`. Requiere las tablas/RLS de las migraciones anteriores.

No es una migración de esquema: es un archivo de datos privado generado a partir de esta exportación. No agregarlo a `supabase/migrations/`, Git ni Hostinger.

El lote se ejecuta en una transacción y con bloqueo de importación por fuente. Crea faltantes y compara los existentes, incluidas relaciones e inventario. Se puede repetir el mismo snapshot sin duplicados ni cambios de timestamps. Si un registro fue editado desde el panel o hay ambigüedad de nombres/identificadores, aborta todo el lote y pide revisión. **No sobrescribe ediciones, no elimina registros y no sincroniza cambios futuros de Sheets automáticamente**. Si aparece un error, compartir su texto; no borrar filas para forzar la ejecución.

Los IDs externos se conservan para el carrito; los UUID nuevos son deterministas por fuente e identidad. Los datos internos de stock van a la tabla privada. Categorías/aromas preexistentes equivalentes pueden reutilizarse; si difieren en sus campos se rechaza el conflicto. No se cambia `site_settings` ni el proveedor público.

## 2. Cargar imágenes con la sesión del administrador

1. Ingresar al panel local con el usuario administrador.
2. Abrir `http://127.0.0.1:8086/admin/import-images.html` en el mismo navegador.
3. En **Manifiesto de imágenes**, seleccionar `imports/calefica/manifiesto-imagenes.json`.
4. En **Carpeta de imágenes originales**, seleccionar la carpeta `imports/calefica/imagenes` completa.
5. Pulsar **Validar y cargar imágenes** y confirmar la operación.

Antes de la primera subida se validan todos los archivos y la existencia/identidad de todos los productos. Las escrituras usan la sesión Auth y la clave publicable, sujetas a RLS; no se solicita `secret` ni `service_role`. Los archivos se suben a rutas deterministas por producto y hash, con `upsert: false`. Se registran sus metadatos y se verifica el contenido de la URL firmada nueva. La imagen será principal si el producto no tiene otra principal.

En un reintento, una imagen ya importada se descarga y compara por SHA-256; no se modifica su orden ni condición de principal. Un objeto huérfano de una ejecución parcial se puede reutilizar si coincide por hash. Un archivo remoto diferente no se sobrescribe. Los errores se muestran por archivo y se pueden reintentar con los mismos originales. Drive y los archivos locales permanecen intactos. No se considera completado mientras haya errores en el informe de pantalla.

## 3. Validar antes de cambiar la tienda

Revisar en el panel los 11 productos, categorías y aromas; confirmar las 11 imágenes verificadas. Verificar especialmente Clásicas ocultas, Souvenir sin stock, precios y teléfono de Box Aromático. Revisar también el WhatsApp general y redes desde Configuración: la importación solo conserva el teléfono de cada producto.

Estado actualizado: se verificaron los 10 productos públicos y sus 10 imágenes por hash desde Supabase, y se activó `dataProvider: "supabase"` en la copia local. La lectura de productos internos y la firma anónima de la imagen oculta se rechazaron. La comprobación pública no permite certificar el contenido de archivos privados ocultos.

Se conservó el precio de Rosa Mosqueta editado desde el panel ($9.500), sin volver a aplicar el snapshot antiguo de $9.000. El carrito, los siete aromas, el bloqueo de compra del agotado y la construcción de WhatsApp se probaron con el catálogo real en un perfil temporal, interceptando la apertura de WhatsApp para no enviar mensajes. Se comprobaron anchos de 1440 y 390 px, sin solicitudes a Sheets.

Antes de publicar falta deshabilitar el registro público: la última lectura de `/auth/v1/settings` devolvió `disable_signup: false`. No se cambió ese ajuste con la clave publicable. Revisar también WhatsApp general, redes y email desde Configuración; el WhatsApp local tiene un respaldo válido confirmado. No retirar Sheets todavía.

La verificación reproducible de solo lectura es `node scripts/verify-supabase-catalog.cjs imports/calefica --allow-price-edits`; conserva en el informe las diferencias de precio para no confundir una edición del panel con una pérdida de importación. `node scripts/check-live-catalog.cjs` verifica en Edge el catálogo real de esta migración con carrito temporal y apertura de WhatsApp interceptada. Son comprobaciones opcionales en línea, independientes de la suite de fixtures.

## Reproducir la preparación local

```powershell
node scripts/prepare-sheets-import.cjs "ruta-al-export.json" --phone-overrides imports/calefica/correcciones-telefono.json --download-images
node scripts/check-import-sql.cjs imports/calefica/importar-catalogo.sql
```

El primer comando valida, genera artefactos privados y descarga originales mediante sus enlaces existentes de Drive. No cambia permisos de Google ni escribe en Supabase. El segundo aplica el SQL real dos veces a PostgreSQL en memoria y compara filas completas y lectura pública; no accede a Supabase.

Las pruebas genéricas se ejecutan con `npm.cmd test`. SQL y servicios Storage se ensayan con bases locales/dobles; las escrituras remotas y la carga HTTP efectiva requieren ejecutar los pasos de esta guía desde tu sesión. Las consultas públicas de diagnóstico no permiten comprobar productos ocultos ni modificar la base.
