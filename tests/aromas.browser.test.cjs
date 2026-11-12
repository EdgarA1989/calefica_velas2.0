const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const browserPath = process.env.CALEFICA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('modal real: radios, variantes, temas, escritorio y mobile', { skip: !fs.existsSync(browserPath), timeout: 45000 }, async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'calefica-aromas-'));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => child.kill());
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se inició el navegador')), 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  t.after(() => socket.close());
  const pending = new Map();
  let serial = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(target => target.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const response = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error('No se cumplió: ' + expression);
  };
  const fixture = { ok: true, productos: [
    { id: 'multi', nombre: 'Vela de prueba', descripcion: 'Producto para verificar selección de aromas.', precio: 1000, stock: 'SI', aroma: 'Floral|#B7A0D4|SI|1|NO|floral;Cítrico con nombre largo|#E5CB72|SI|2|SI|citrico;Retirado|#FFFFFF|NO|0' },
    { id: 'single', nombre: 'Una opción', stock: 'SI', aroma: 'Original' },
    { id: 'empty', nombre: 'Sin opciones', stock: 'SI', aroma: '' },
  ] };
  await page('Page.enable');
  await page('Network.enable');
  await page('Network.setBlockedURLs', { urls: ['https://*'] });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'CaleficaProductsService',{get:()=>({loadCatalog:async()=>(${JSON.stringify(fixture)})}),set:()=>{}}); window.open = url => window.lastOpenedUrl = url;` });
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await waitFor('typeof products !== "undefined" && products.some(p => p.id === "multi")');
  await evaluate('openProductModal(products.find(p => p.id === "multi"))');
  assert.equal(await evaluate('document.querySelectorAll(".aroma-option").length'), 2);
  assert.equal(await evaluate('document.querySelector(".aroma-option input:checked").value'), 'citrico');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("modal-aroma-options")).gridTemplateColumns.split(" ").length'), 2);
  await evaluate('document.querySelector(".aroma-option input:checked").focus()');
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  assert.equal(await evaluate('document.querySelector(".aroma-option input:checked").value'), 'floral');
  assert.equal(await evaluate('document.querySelectorAll(".aroma-option input:checked").length'), 1);
  await evaluate('document.querySelector(".aroma-option input").click()');
  await evaluate('document.getElementById("modal-product-consult").click()');
  assert.match(decodeURIComponent(await evaluate('window.lastOpenedUrl')), /Aroma: Floral/);
  await evaluate('document.getElementById("modal-product-buy").click()');
  await pause(300);
  await evaluate('openProductModal(products.find(p => p.id === "multi")); document.getElementById("modal-product-buy").click()');
  await pause(300);
  assert.equal(await evaluate('getCart().length'), 2);
  assert.equal(await evaluate('getCart().map(i => i.aroma).join(";")'), 'Floral;Cítrico con nombre largo');
  await evaluate('openProductModal(products.find(p => p.id === "single"))');
  assert.equal(await evaluate('document.querySelectorAll(".aroma-option input:checked").length'), 1);
  await evaluate('openProductModal(products.find(p => p.id === "empty"))');
  assert.equal(await evaluate('document.getElementById("modal-product-aromas").hidden'), true);
  await evaluate('openProductModal(products.find(p => p.id === "multi"))');
  for (const width of [1440, 390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: width > 1000 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 1000 });
    for (const dark of [false, true]) {
      await evaluate(`document.body.classList.toggle('dark', ${dark})`);
      await pause(350);
      assert.equal(await evaluate('document.querySelector(".product-modal__content").scrollWidth <= document.querySelector(".product-modal__content").clientWidth'), true);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".aroma-option__swatch")).backgroundColor'), 'rgb(183, 160, 212)');
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(profile, `modal-${width}-${dark ? 'dark' : 'light'}.png`), Buffer.from(data, 'base64'));
    }
  }
  assert.equal(await evaluate('getComputedStyle(document.getElementById("modal-aroma-options")).gridTemplateColumns.split(" ").length'), 1);
  await evaluate(`
    const longProduct = products.find(p => p.id === 'multi');
    longProduct.descripcion = 'Descripción extensa para comprobar el desplazamiento del detalle. '.repeat(12);
    longProduct.aromas = normalizeAromas(Array.from({length:16}, (_, i) => ({nombre:'Aroma de prueba ' + (i + 1),color:'#B7A0D4'})));
    openProductModal(longProduct);
  `);
  for (const height of [900, 768, 600]) {
    await page('Emulation.setDeviceMetricsOverride', { width: 1366, height, deviceScaleFactor: 1, mobile: false });
    await pause(100);
    assert.equal(await evaluate('document.querySelector(".product-modal__content").scrollHeight > document.querySelector(".product-modal__content").clientHeight'), true);
    assert.equal(await evaluate('document.querySelector(".product-modal__dialog").getBoundingClientRect().bottom <= innerHeight'), true);
    const point = await evaluate('(() => { const r = document.querySelector(".product-modal__content").getBoundingClientRect(); document.querySelector(".product-modal__content").scrollTop=0; return {x:r.x+80,y:r.y+100}; })()');
    await page('Input.dispatchMouseEvent', {type:'mouseWheel', x:point.x, y:point.y, deltaX:0, deltaY:10000});
    await pause(250);
    assert.equal(await evaluate('document.querySelector(".product-modal__content").scrollTop > 0'), true);
    assert.equal(await evaluate('document.getElementById("modal-product-buy").getBoundingClientRect().bottom <= document.querySelector(".product-modal__content").getBoundingClientRect().bottom'), true);
    assert.equal(await evaluate('document.querySelector(".product-modal__image").getBoundingClientRect().x < document.querySelector(".product-modal__content").getBoundingClientRect().x'), true);
  }
  console.log('Capturas del modal:', profile);
  await send('Browser.close');
});
