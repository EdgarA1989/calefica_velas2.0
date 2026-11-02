const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browser, browserPath } = require('./helpers/browser.cjs');
const preload = `(() => {
  const state=window.__RECOVERY_TEST={requests:0,updates:0,valid:true,closed:false};
  const service={
    onAuthChange(){},async request(){state.requests++;},
    async recoveryUser(){if(!state.valid)throw new Error('El enlace venció o no es válido. Solicitá uno nuevo.');return {id:'u1'};},
    async change(password,confirmation){if(password!==confirmation)throw new Error('Las contraseñas no coinciden.');state.updates++;},
    async closeSession(){state.closed=true;}
  };
  Object.defineProperty(window,'CaleficaRecoveryService',{get:()=>service,set:()=>{}});
})();`;
const options = { skip: !fs.existsSync(browserPath), timeout: 30000 };

test('recuperación: envío solo por acción del usuario; nunca muestra cambio sin enlace', options, async t => {
  const { evaluate, waitFor, close } = await browser(t, preload + 'localStorage.setItem("calefica-theme","dark");', '/admin/recover.html');
  await waitFor('!!document.querySelector("#request-form")');
  assert.equal(await evaluate('window.__RECOVERY_TEST.requests'), 0);
  assert.equal(await evaluate('document.querySelector("#password-form").hidden'), true);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.equal(await evaluate('document.querySelector("[data-theme-toggle] .theme-flame") !== null'), true);
  await evaluate(`document.querySelector('[name=email]').value='admin@example.test';document.querySelector('#request-form').requestSubmit()`);
  await waitFor('document.querySelector("#recovery-status").textContent.includes("recibirás")');
  assert.equal(await evaluate('window.__RECOVERY_TEST.requests'), 1);
  await close();
});

test('recuperación: enlace válido, confirmación de clave, cierre de sesión y formulario móvil', options, async t => {
  const { evaluate, page, waitFor, close } = await browser(t, preload, '/admin/recover.html#type=recovery');
  await waitFor('!document.querySelector("#password-form").hidden');
  await evaluate(`const f=document.querySelector('#password-form');f.elements.password.value='Nueva-clave-123!';f.elements.confirmation.value='Distinta-clave-123!';f.requestSubmit()`);
  await waitFor('document.querySelector("#recovery-status").textContent.includes("no coinciden")');
  assert.equal(await evaluate('window.__RECOVERY_TEST.updates'), 0);
  for (const width of [390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  await evaluate(`document.querySelector('#show-password').click()`);
  assert.equal(await evaluate('document.querySelector("[name=password]").type'), 'text');
  await evaluate(`document.querySelector('[name=confirmation]').value='Nueva-clave-123!';document.querySelector('#password-form').requestSubmit()`);
  await waitFor('document.querySelector("#recovery-status").textContent.includes("Contraseña guardada")');
  assert.equal(await evaluate('window.__RECOVERY_TEST.updates'), 1);
  assert.equal(await evaluate('window.__RECOVERY_TEST.closed'), true);
  assert.equal(await evaluate('document.querySelector("#password-form").hidden'), true);
  assert.equal(await evaluate('document.querySelector("[name=password]").value'), '');
  await close();
});

test('recuperación: un enlace vencido mantiene oculto el formulario de nueva contraseña', options, async t => {
  const { evaluate, waitFor, close } = await browser(t, preload + 'window.__RECOVERY_TEST.valid=false;', '/admin/recover.html#type=recovery');
  await waitFor('document.querySelector("#recovery-status").textContent.includes("venció")');
  assert.equal(await evaluate('document.querySelector("#password-form").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#request-form").hidden'), false);
  await close();
});
