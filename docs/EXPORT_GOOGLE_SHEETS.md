# Exportar el catálogo privado de Google Sheets

La lectura pública de la planilla indicada devolvió HTTP 401. La migración se preparará a partir de una exportación ejecutada desde la cuenta con acceso. No hace falta publicar la planilla ni cambiar sus permisos.

## Exportación con opciones de aromas

1. Abrir la planilla y entrar a **Extensiones → Apps Script**.
2. En el editor, pulsar **+ → Script** y crear un archivo nuevo llamado `exportar-calefica`. Conservar todos los archivos existentes, especialmente la API del catálogo.
3. Copiar en el archivo nuevo el contenido completo de [`google-apps-script/exportar-calefica.gs`](../google-apps-script/exportar-calefica.gs) y guardar.
4. Seleccionar la función **`exportarCaleficaParaSupabase`** en la barra superior y pulsar **Ejecutar**. Autorizar su lectura con la cuenta que tiene acceso a la planilla y carpeta de imágenes. Apps Script puede mostrar permisos amplios por utilizar servicios Sheets/Drive; este archivo no invoca métodos de escritura ni comparte archivos. No hay que implementar/publicar una Web App.
5. Volver a la pestaña de la planilla: aparecerá un diálogo **Exportación Calefica**. Pulsar **Descargar JSON**. Si el navegador impide la descarga, usar **Ver JSON para copiar** y guardarlo como archivo `.json` en UTF-8.
6. Adjuntar el JSON en esta conversación. Para guardarlo en el proyecto, usar `imports/`, que está excluido de Git.

El archivo nuevo no define `doGet`, `onOpen`, constantes globales de la API ni normalizadores que sustituyan los existentes. Agregarlo al proyecto de Apps Script no cambia la Web App ya desplegada. No requiere actualizar su implementación.

## Contenido

- Filas de `productos` sin filtrar `activo`, con número original de fila, valores, texto mostrado y fórmulas. No convierte precios, stock o IDs; preserva ceros y texto libre para validarlos antes de importar.
- Reglas por celda de `aroma`/`aromas`: lista completa de opciones o snapshot de su intervalo de origen. Una celda vacía puede tener un desplegable válido y se conserva.
- Hoja `aromas` completa, si existe, incluidos inactivos; colores y metadatos se conservan sin inventarlos.
- Inventario de nombres de pestañas; solo se exportan los datos de productos/aromas y los intervalos usados en sus desplegables.
- Inventario de archivos de la carpeta Drive configurada en el catálogo: ID, nombre exacto, MIME, tamaño y fecha. Conserva nombres repetidos y los informa para resolverlos antes de migrar.
- Alertas si falta el maestro o no se pudo completar la lectura de Drive. Un fallo de Drive no borra los datos del catálogo exportado, pero deberá resolverse antes de dar la migración por completa.

Las imágenes originales **no se descargan ni se incluyen** en el JSON. Con este primer archivo se determina qué originales hacen falta y se prepara la migración a Storage. No se debe hacer público Drive para obtenerlas; después se puede descargar la carpeta desde su cuenta o preparar una transferencia autenticada.

## Validación y próximos pasos

El exportador se prueba localmente con dobles de los servicios Google, sin acceder a cuentas reales. La descarga del diálogo, los permisos de la cuenta y el contenido vivo deben comprobarse al ejecutarlo en Apps Script. No se puede afirmar que la exportación real se completó hasta recibir el archivo.

Al recibirlo: validar columnas, IDs, precios, categorías, disponibilidad y relaciones de aromas; informar conflictos; preparar importación idempotente y manifiesto de imágenes, sin borrar filas de Sheets ni datos anteriores en Supabase. Hasta completar la comparación, la web continuará en Sheets.

El snapshot recibido ya tiene preparación local documentada en [IMPORT_GOOGLE_SHEETS.md](IMPORT_GOOGLE_SHEETS.md). Los artefactos con datos reales se guardan solo en `imports/calefica/`, fuera de Git y del sitio publicado.

Referencias oficiales: [reglas de validación](https://developers.google.com/apps-script/reference/spreadsheet/data-validation), [lectura de rangos](https://developers.google.com/apps-script/reference/spreadsheet/range) y [restricciones del diálogo HTML](https://developers.google.com/apps-script/guides/html/restrictions).
