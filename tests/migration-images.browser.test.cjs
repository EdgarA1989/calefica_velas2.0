const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browser, browserPath } = require('./helpers/browser.cjs');
const options = { skip: !fs.existsSync(browserPath), timeout: 30000 };

test('carga de imágenes: pantalla protegida y formulario responsive con selección explícita', options, async t => {
  const preload = `
    Object.defineProperty(window,'CaleficaAdminService',{get:()=>({authorize:async()=>({id:'admin'})}),set:()=>{}});
    window.__MIGRATION_CALLS=0;
    Object.defineProperty(window,'CaleficaMigrationImages',{get:()=>({prepare:async()=>({jobs:[{}]}),run:async(job,progress)=>{window.__MIGRATION_CALLS++;const rows=[{filename:'vela.jpg',result:'Importada y verificada',ok:true}];progress(rows,1);return rows;}}),set:()=>{}});
    window.confirm=()=>true;`;
  const { evaluate, page, waitFor, close } = await browser(t, preload, '/admin/import-images.html');
  await waitFor('!document.querySelector("#migration-form").hidden');
  assert.equal(await evaluate('window.__MIGRATION_CALLS'), 0);
  for (const width of [1440,390,320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  await evaluate(`
    const json=new DataTransfer();json.items.add(new File(['{}'],'manifiesto-imagenes.json',{type:'application/json'}));document.querySelector('#manifest').files=json.files;
    const images=new DataTransfer();images.items.add(new File(['fixture'],'vela.jpg',{type:'image/jpeg'}));document.querySelector('#originals').files=images.files;
    document.querySelector('#migration-form').requestSubmit();`);
  await waitFor('document.querySelector("#migration-status").textContent.includes("1 imágenes importadas")');
  assert.equal(await evaluate('window.__MIGRATION_CALLS'), 1);
  await close();
});

test('carga de imágenes: sin sesión no habilita el formulario', options, async t => {
  const { evaluate, waitFor, close } = await browser(t, `Object.defineProperty(window,'CaleficaAdminService',{get:()=>({authorize:async()=>null}),set:()=>{}});`, '/admin/import-images.html');
  await waitFor('document.querySelector("#migration-status").textContent.includes("Ingresá")');
  assert.equal(await evaluate('document.querySelector("#migration-form").hidden'), true);
  await close();
});
