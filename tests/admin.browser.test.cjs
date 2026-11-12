const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser, browserPath } = require('./helpers/browser.cjs');

const preload = `(() => {
  Object.defineProperty(window,'CALEFICA_CONFIG',{get:()=>({}),set:()=>{}});
  const state = window.__ADMIN_TEST = { signedIn: false, allowed: true, products: [],
    categories: [{id:'c1',name:'Velas',slug:'velas',sort_order:0,is_active:true}],
    aromas: [{id:'a1',name:'Lavanda',color:'#B7A0D4',sort_order:0,is_active:true}], settings:{} };
  let authCallback;
  const authorize = async () => { if(!state.signedIn) return null; if(!state.allowed) throw Object.assign(new Error('Sin membresía'),{code:'42501'}); return {id:'admin',email:'admin@example.test'}; };
  const service = {
    authorize, onAuthChange(callback){ authCallback=callback; },
    async login(email,password){ if(password !== 'prueba-correcta') throw new Error('Invalid login credentials'); state.signedIn=true; return authorize(); },
    async logout(){state.signedIn=false;authCallback('SIGNED_OUT');},
    async load(){await authorize();const snapshot=structuredClone({products:state.products,categories:state.categories,aromas:state.aromas,settings:state.settings});if(state.waitLoad)await state.waitLoad;return snapshot;},
    async saveProduct(value){const payload=window.CaleficaValidation.product(value);const id=payload.id||'p1';const p={...payload,id,updated_at:'2026-10-30T00:00:00Z',product_images:[],product_inventory:{quantity:payload.quantity,legacy_quantity_text:payload.legacy_quantity_text},product_aromas:payload.aroma_ids.map(aroma_id=>({aroma_id,is_active:true,is_default:aroma_id===payload.default_aroma_id}))};const old=state.products.findIndex(p=>p.id===id);old<0?state.products.push(p):state.products.splice(old,1,p);return id;},
    async saveRecord(table,value,id){const row={...value,id:id||'new-record'};const i=state[table].findIndex(x=>x.id===id);i<0?state[table].push(row):state[table].splice(i,1,row);return row;},
    async toggle(table,id,value){state[table].find(p=>p.id===id).is_active=value;},
    async removeProduct(id){state.products=state.products.filter(p=>p.id!==id);},
    async settings(value){state.settings=value;}, async signedUrl(){return '';},
    async upload(productId,file,sort_order){window.CaleficaValidation.image(file);state.products.find(p=>p.id===productId).product_images.push({id:'image'+sort_order,storage_path:'fixture/'+sort_order,original_filename:file.name,sort_order,is_primary:false});},
    async primary(productId,imageId){state.products.find(p=>p.id===productId).product_images.forEach(i=>i.is_primary=i.id===imageId);},
    async imageOrder(id,order){state.products.flatMap(p=>p.product_images).find(i=>i.id===id).sort_order=Number(order);},
    async removeImage(image){state.products.forEach(p=>p.product_images=p.product_images.filter(i=>i.id!==image.id));},
  };
  Object.defineProperty(window,'CaleficaAdminService',{get:()=>service,set:()=>{}});
  state.externalSignOut=()=>{state.signedIn=false;authCallback('SIGNED_OUT');};
  window.confirm=()=>true;
})();`;

test('login inicia con el SDK real y no consulta datos administrativos sin sesión', { skip: !fs.existsSync(browserPath), timeout: 30000 }, async t => {
  const { evaluate, page, waitFor, close } = await browser(t, `window.CALEFICA_CONFIG={supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_fixture'};`);
  await waitFor('document.querySelector("#login-status")?.textContent.includes("Ingresá")');
  assert.equal(await evaluate('typeof window.supabase.createClient'), 'function');
  assert.equal(await evaluate('document.querySelector("#panel-view").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#content").children.length'), 0);
  await evaluate('document.querySelector("#login-view [data-theme-toggle]").click()');
  assert.equal(await evaluate('document.querySelector("#login-view [data-theme-toggle]").classList.contains("is-blowing")'), true);
  await waitFor('document.documentElement.dataset.theme === "dark"');
  assert.equal(await evaluate('localStorage.getItem("calefica-theme")'), 'dark');
  await page('Page.reload');
  await waitFor('document.querySelector("#login-status")?.textContent.includes("Ingresá")');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.equal(await evaluate('document.querySelector("#login-view [data-theme-toggle]").getAttribute("aria-pressed")'), 'true');
  await evaluate('document.querySelector("#login-view [data-theme-toggle]").click()');
  assert.equal(await evaluate('document.querySelector("#login-view [data-theme-toggle]").classList.contains("is-lighting")'), true);
  await waitFor('document.documentElement.dataset.theme === "light"');
  await close();
});

test('panel real: login, CRUD, filtros, validaciones, responsive, logout y revocación', { skip: !fs.existsSync(browserPath), timeout: 60000 }, async t => {
  const { evaluate, page, waitFor, profile, close } = await browser(t, preload);
  await waitFor('document.querySelector("#login-status")?.textContent.includes("Ingresá")');
  assert.equal(await evaluate('document.querySelector("#panel-view").hidden'), true);
  await evaluate(`document.querySelector('[name=email]').value='admin@example.test';document.querySelector('[name=password]').value='incorrecta';document.querySelector('#login-form').requestSubmit()`);
  await waitFor('document.querySelector("#login-status").textContent.includes("incorrectos")');
  await evaluate(`document.querySelector('[name=password]').value='prueba-correcta';document.querySelector('#login-form').requestSubmit()`);
  await waitFor('!document.querySelector("#panel-view").hidden');
  assert.equal(await evaluate('document.querySelectorAll(".stat").length'), 4);
  assert.match(await evaluate('document.querySelector("#provider-notice").textContent'), /Los cambios guardados se mostrarán al actualizar el catálogo/);
  await evaluate('document.querySelector("#panel-view [data-theme-toggle]").click()');
  await waitFor('document.documentElement.dataset.theme === "dark"');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".stat")).backgroundColor'), 'rgb(31, 32, 37)');
  assert.equal(await evaluate('document.querySelector("#panel-view .theme-candle--big .theme-smoke--one") !== null'), true);
  await evaluate(`document.querySelector('[data-section=products]').click();document.querySelector('[data-action=new-product]').click()`);
  await waitFor('document.querySelector("#editor").open');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#product-form input")).backgroundColor'), 'rgb(24, 25, 29)');
  await evaluate(`(() => {const f=document.querySelector('#product-form');f.elements.name.value='<img src=x onerror=alert(1)> Vela';f.elements.name.dispatchEvent(new Event('input',{bubbles:true}));f.elements.price.value='22.000';f.elements.category_id.value='c1';f.elements.quantity.value='2';f.elements.is_active.checked=true;f.requestSubmit();})()`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("Precio")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products.length'), 0);
  await evaluate(`(() => {const f=document.querySelector('#product-form');f.elements.price.value='22000';f.elements.aroma_ids.checked=true;f.elements.aroma_ids.dispatchEvent(new Event('change',{bubbles:true}));f.elements.default_aroma_id.value='a1';f.requestSubmit();})()`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("Producto guardado")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products.length'), 1);
  assert.equal(await evaluate('document.querySelectorAll("#product-results h3 img").length'), 0);
  assert.equal(await evaluate('window.__ADMIN_TEST.products[0].default_aroma_id'), 'a1');
  await evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File(['png-fixture'],'prueba.png',{type:'image/png'}));const input=document.querySelector('#upload-images');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("1 imagen/es cargada/s")');
  await evaluate(`document.querySelector('[data-action=primary-image]').click()`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("Imágenes actualizadas")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products[0].product_images[0].is_primary'), true);
  await evaluate(`const order=document.querySelector('[data-image-order]');order.value='3';order.dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("Orden actualizado")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products[0].product_images[0].sort_order'), 3);
  await evaluate(`document.querySelector('[data-action=delete-image]').click()`);
  await waitFor('document.querySelector("#editor-status").textContent.includes("Imágenes actualizadas")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products[0].product_images.length'), 0);
  for (const width of [1440, 390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    assert.equal(await evaluate('document.querySelector("#editor").scrollWidth <= document.querySelector("#editor").clientWidth'), true);
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(profile, `product-${width}.png`), Buffer.from(data, 'base64'));
  }
  await evaluate('document.querySelector("#close-editor").click()');
  await evaluate(`document.querySelector('#search').value='inexistente';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.match(await evaluate('document.querySelector("#product-results").textContent'), /No hay productos/);
  await evaluate(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action=toggle-product]').click()`);
  await waitFor('document.querySelector("#status").textContent.includes("Estado actualizado")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products[0].is_active'), false);
  await evaluate(`document.querySelector('[data-section=categories]').click();document.querySelector('[data-action=new-record]').click()`);
  await evaluate(`const f=document.querySelector('#record-form');f.elements.name.value='Regalos';f.elements.name.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()`);
  await waitFor('!document.querySelector("#editor").open');
  assert.equal(await evaluate('window.__ADMIN_TEST.categories.length'), 2);
  await evaluate(`document.querySelector('[data-section=aromas]').click();document.querySelector('[data-action=edit-record]').click()`);
  await evaluate(`document.querySelector('#record-form').elements.name.value='Lavanda suave';document.querySelector('#record-form').requestSubmit()`);
  await waitFor('!document.querySelector("#editor").open');
  assert.equal(await evaluate('window.__ADMIN_TEST.aromas[0].name'), 'Lavanda suave');
  await evaluate(`document.querySelector('[data-section=settings]').click();document.querySelector('#settings-form').elements.business_name.value='Calefica';document.querySelector('#settings-form').requestSubmit()`);
  await waitFor('document.querySelector("#status").textContent.includes("Configuración guardada")');
  assert.equal(await evaluate('window.__ADMIN_TEST.settings.currency'), 'ARS');
  await evaluate(`document.querySelector('[data-section=dashboard]').click()`);
  for (const width of [1440, 390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(profile, `dashboard-${width}.png`), Buffer.from(data, 'base64'));
  }
  await evaluate(`document.querySelector('[data-action=delete-product]').click()`);
  await waitFor('document.querySelector("#status").textContent.includes("Producto eliminado")');
  assert.equal(await evaluate('window.__ADMIN_TEST.products.length'), 0);
  await evaluate(`window.__ADMIN_TEST.allowed=false;window.dispatchEvent(new Event('focus'))`);
  await waitFor('document.querySelector("#panel-view").hidden');
  assert.equal(await evaluate('document.querySelector("#content").children.length'), 0);
  await evaluate(`window.__ADMIN_TEST.allowed=true;document.querySelector('[name=password]').value='prueba-correcta';document.querySelector('#login-form').requestSubmit()`);
  await waitFor('!document.querySelector("#panel-view").hidden');
  await evaluate('document.querySelector("#logout").click()');
  await waitFor('document.querySelector("#panel-view").hidden');
  assert.equal(await evaluate('window.__ADMIN_TEST.signedIn'), false);
  await evaluate(`document.querySelector('[name=password]').value='prueba-correcta';document.querySelector('#login-form').requestSubmit()`);
  await waitFor('!document.querySelector("#panel-view").hidden');
  await evaluate(`window.__ADMIN_TEST.waitLoad=new Promise(resolve=>window.__ADMIN_TEST.releaseLoad=resolve);document.querySelector('#refresh').click()`);
  await waitFor('document.querySelector("#content").getAttribute("aria-busy")==="true"');
  await evaluate('window.__ADMIN_TEST.externalSignOut()');
  await waitFor('document.querySelector("#panel-view").hidden');
  await evaluate('window.__ADMIN_TEST.releaseLoad()');
  await waitFor('document.querySelector("#content").getAttribute("aria-busy")==="false"');
  assert.equal(await evaluate('document.querySelector("#panel-view").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#content").children.length'), 0);
  console.log('Capturas del panel:', profile);
  await close();
});
