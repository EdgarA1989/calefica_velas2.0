// QA opcional del catálogo real: solo lecturas Supabase. El carrito y los clics
// se ensayan en un perfil temporal. window.open se intercepta: no envía WhatsApp.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { browser, browserPath } = require('../tests/helpers/browser.cjs');
async function main() {
  if (!fs.existsSync(browserPath)) throw new Error('No está disponible Edge para la comprobación visual.');
  const cleanup = [];
  try {
    const preload = `window.__catalogRequests=[];const originalFetch=window.fetch;window.fetch=(input,...args)=>{window.__catalogRequests.push(String(input?.url||input));return originalFetch(input,...args)};window.open=url=>window.__lastWhatsapp=url;`;
    const { evaluate, page, waitFor, pause, profile, close } = await browser({ after: action => cleanup.push(action) }, preload, '/', { allowExternal: true, waitAttempts: 500 });
    await waitFor('typeof products !== "undefined" && products.length === 10 && document.querySelectorAll(".product-card:not(.product-card--skeleton)").length === 10');
    assert.equal(await evaluate('DATA_PROVIDER'), 'supabase');
    assert.equal(await evaluate('window.__catalogRequests.some(url=>url.includes("script.google.com"))'), false);
    assert.equal(await evaluate('products.some(p=>p.id==="vela-nude-clasica")'), false);
    assert.equal(await evaluate('products.find(p=>p.id==="vela-rosa-mosqueta").precio'), 9500);
    await evaluate('openProductModal(products.find(p=>p.id==="vela-lavanda-soft"))');
    assert.equal(await evaluate('document.querySelectorAll(".aroma-option").length'), 7);
    await evaluate('document.querySelectorAll(".aroma-option input")[2].click();document.querySelector("#modal-product-buy").click()');
    await pause(350);
    assert.equal(await evaluate('getCart().length'), 1);
    assert.equal(await evaluate('getCart()[0].aroma'), 'Vainilla');
    await evaluate('openWhatsAppOrder()');
    assert.equal(await evaluate('window.__lastWhatsapp.startsWith("https://wa.me/5491136550811?")'), true);
    await evaluate('openProductModal(products.find(p=>p.id==="vela-peonia-souvenir"))');
    assert.equal(await evaluate('document.querySelector("#modal-product-buy").disabled'), true);
    assert.equal(await evaluate('document.querySelector("#modal-product-consult").disabled'), false);
    await evaluate('closeProductModal()');
    await pause(200);
    for (const width of [1440, 390]) {
      await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await evaluate('document.querySelector("#catalogo").scrollIntoView()');
      await pause(450);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(profile, `catalogo-supabase-${width}.png`), Buffer.from(data, 'base64'));
    }
    await close();
    console.log(JSON.stringify({ provider: 'supabase', public_products: 10, aromas_per_product: 7,
      admin_price_preserved: 9500, sheets_requests: 0, whatsapp_intercepted: true,
      out_of_stock_buy_disabled: true, responsive_widths: [1440,390], screenshots: profile }, null, 2));
  } finally { for (const action of cleanup.reverse()) { try { await action(); } catch {} } }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
