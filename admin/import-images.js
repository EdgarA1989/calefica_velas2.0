(async function () {
  'use strict';
  const form = document.getElementById('migration-form');
  const status = document.getElementById('migration-status');
  const report = document.getElementById('migration-report');
  let busy = false;
  function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function render(rows, total) {
    report.replaceChildren();
    for (const row of rows) {
      const element = document.createElement('p'); element.className = 'list-row';
      element.textContent = `${row.filename}: ${row.result}`; report.append(element);
    }
    message(`${rows.length} de ${total} procesadas · ${rows.filter(row => row.ok).length} verificadas.`);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (!window.confirm('¿Cargar estas imágenes a Supabase y asociarlas a los productos importados?')) return;
    const manifest = document.getElementById('manifest').files[0];
    const files = [...document.getElementById('originals').files];
    const controls = [...form.querySelectorAll('input,button')];
    busy = true; controls.forEach(element => { element.disabled = true; }); report.replaceChildren();
    try {
      message('Validando todos los originales antes de cargar…');
      const job = await window.CaleficaMigrationImages.prepare(JSON.parse(await manifest.text()), files);
      const rows = await window.CaleficaMigrationImages.run(job, render);
      const errors = rows.filter(row => !row.ok).length;
      message(errors ? `${rows.length - errors} verificadas y ${errors} con errores. Podés reintentar con los mismos archivos.` : `${rows.length} imágenes importadas y verificadas. Ya podés revisarlas desde Productos.`, errors > 0);
    } catch (error) { message(error.message || 'No se pudo completar la importación.', true); }
    finally { busy = false; controls.forEach(element => { element.disabled = false; }); }
  });
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  try {
    if (!await window.CaleficaAdminService.authorize()) throw new Error('Ingresá al panel con tu usuario administrador y volvé a esta página.');
    form.hidden = false; message('Acceso administrativo verificado. Seleccioná los archivos para continuar.');
  } catch (error) { message(error.message || 'No se pudo verificar el acceso.', true); }
})();
