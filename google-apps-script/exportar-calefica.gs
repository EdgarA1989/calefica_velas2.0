/**
 * Exportación manual de solo lectura, separada de la API del catálogo.
 * Agregar como archivo NUEVO en Apps Script desde la planilla.
 * Ejecutar exportarCaleficaParaSupabase y descargar el JSON del diálogo.
 * No requiere publicar una Web App ni modificar el .gs existente.
 * No escribe en Sheets/Drive, no cambia permisos y no filtra productos inactivos.
 */
var CaleficaExportacion = (function () {
  var spreadsheetId = '1AvIPysHm531nCfZ0ynotGB2ZzZDGHHqf5ILwhtStq44';
  var imageFolderId = '1gXucIRT653zxXAn9TNO6TBCxnXEl08cP';

  function validationSnapshot(rule) {
    if (!rule) return null;
    var type = String(rule.getCriteriaType());
    var criteria = rule.getCriteriaValues();
    var result = { type: type, options: null };
    if (type === 'VALUE_IN_LIST') {
      result.raw_options = criteria[0];
      result.options = criteria[0].map(function (value) { return String(value == null ? '' : value).trim(); }).filter(Boolean);
    } else if (type === 'VALUE_IN_RANGE') {
      var range = criteria[0];
      result.range = { sheet: range.getSheet().getName(), a1: range.getA1Notation(), values: range.getValues() };
      result.options = result.range.values.reduce(function (all, row) { return all.concat(row); }, [])
        .map(function (value) { return String(value == null ? '' : value).trim(); }).filter(Boolean);
    }
    return result;
  }

  function readSheet(sheet, includeAromaValidation) {
    if (!sheet) return null;
    var range = sheet.getDataRange();
    var values = range.getValues();
    var display = range.getDisplayValues();
    var formulas = range.getFormulas();
    var headers = (values[0] || []).map(function (value) { return String(value == null ? '' : value).trim(); });
    var aromaIndex = headers.indexOf('aroma');
    if (aromaIndex < 0) aromaIndex = headers.indexOf('aromas');
    var validations = includeAromaValidation && aromaIndex >= 0 ? range.getDataValidations() : [];
    return {
      name: sheet.getName(),
      headers: headers,
      raw_headers: values[0] || [],
      aroma_column_index: includeAromaValidation ? aromaIndex : null,
      rows: values.slice(1).map(function (row, index) {
        return { row_number: index + 2, values: row, display_values: display[index + 1], formulas: formulas[index + 1],
          aroma_validation: includeAromaValidation && aromaIndex >= 0
            ? validationSnapshot((validations[index + 1] || [])[aromaIndex]) : null };
      })
    };
  }

  function build(spreadsheet, folderReader) {
    var products = readSheet(spreadsheet.getSheetByName('productos'), true);
    if (!products) throw new Error('No existe la pestaña productos. No se exportaron datos.');
    var aromas = readSheet(spreadsheet.getSheetByName('aromas'), false);
    var warnings = [];
    var images = { folder_id: imageFolderId, status: 'not_needed', files: [], duplicate_names: [] };
    var imageColumn = products.headers.indexOf('nombreImagen');
    var needsImages = imageColumn >= 0 && products.rows.some(function (row) { return String(row.values[imageColumn] || '').trim(); });
    if (needsImages) {
      try {
        var files = folderReader(imageFolderId).getFiles();
        var names = Object.create(null);
        while (files.hasNext()) {
          var file = files.next();
          var name = file.getName();
          names[name] = (names[name] || 0) + 1;
          images.files.push({ id: file.getId(), name: name, mime_type: file.getMimeType(), size: file.getSize(),
            modified_at: file.getLastUpdated().toISOString() });
        }
        images.files.sort(function (a, b) { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
        images.duplicate_names = Object.keys(names).filter(function (name) { return names[name] > 1; });
        images.status = 'complete';
        if (images.duplicate_names.length) warnings.push({ code: 'duplicate_image_names', message: 'Hay archivos de Drive con el mismo nombre; se conservaron todos sus identificadores.' });
      } catch (error) {
        images.status = 'incomplete';
        warnings.push({ code: 'drive_read_error', message: 'No se pudo completar la lectura de la carpeta de imágenes. El catálogo se exportó igualmente.' });
      }
    }
    if (!aromas) warnings.push({ code: 'aromas_sheet_absent', message: 'No existe hoja aromas: se conservaron los valores y opciones de cada producto.' });
    if (products.aroma_column_index < 0) warnings.push({ code: 'aroma_column_absent', message: 'No se encontró encabezado aroma/aromas. Revisar antes de importar.' });
    return { schema_version: 1, exported_at: new Date().toISOString(),
      source: { spreadsheet_id: spreadsheet.getId(), name: spreadsheet.getName(), timezone: spreadsheet.getSpreadsheetTimeZone(),
        locale: spreadsheet.getSpreadsheetLocale() },
      sheet_inventory: spreadsheet.getSheets().map(function (sheet) { return { name: sheet.getName(), last_row: sheet.getLastRow(), last_column: sheet.getLastColumn() }; }),
      sheets: { productos: products, aromas: aromas }, images: images, warnings: warnings };
  }

  function downloadHtml(snapshot) {
    var json = JSON.stringify(snapshot, null, 2);
    var base64 = Utilities.base64Encode(json, Utilities.Charset.UTF_8);
    var filename = 'calefica-export-' + snapshot.exported_at.replace(/[:.]/g, '-') + '.json';
    // Solo base64 y nombre generado entran al HTML; nombres/textos del catálogo
    // se decodifican como datos, nunca se interpolan como HTML o JavaScript.
    return '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head>' +
      '<body style="font:15px system-ui;padding:16px;color:#342c2a"><h2>Exportación Calefica</h2>' +
      '<p>El archivo incluye productos activos y ocultos, aromas y opciones de desplegables. No se modificó la planilla.</p>' +
      '<button id="download" style="padding:12px 18px;cursor:pointer">Descargar JSON</button>' +
      '<p>Las imágenes originales no se incluyen en este archivo: se exportan sus identificadores y nombres.</p>' +
      '<button id="show" style="padding:8px">Ver JSON para copiar</button><textarea id="json" readonly hidden style="width:100%;height:160px;margin-top:12px"></textarea>' +
      '<script>var bytes=Uint8Array.from(atob("' + base64 + '"),function(c){return c.charCodeAt(0)});' +
      'document.getElementById("download").onclick=function(){var url=URL.createObjectURL(new Blob([bytes],{type:"application/json;charset=utf-8"}));' +
      'var link=document.createElement("a");link.href=url;link.download="' + filename + '";link.target="_blank";document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},3000)};' +
      'document.getElementById("show").onclick=function(){var box=document.getElementById("json");box.hidden=false;box.value=new TextDecoder().decode(bytes);box.select()};</script></body></html>';
  }

  function run() {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var snapshot = build(spreadsheet, function (id) { return DriveApp.getFolderById(id); });
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(downloadHtml(snapshot)).setWidth(580).setHeight(460), 'Exportar catálogo Calefica');
  }
  return { run: run, build: build, validationSnapshot: validationSnapshot, downloadHtml: downloadHtml };
})();

function exportarCaleficaParaSupabase() {
  CaleficaExportacion.run();
}
