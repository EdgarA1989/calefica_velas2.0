// Solo GET con clave publicable: no crea usuarios, productos, tablas ni archivos.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function main() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8'), context);
  const config = context.window.CALEFICA_CONFIG;
  if (!config?.supabaseUrl?.startsWith('https://') || !config.supabasePublishableKey?.startsWith('sb_publishable_')) throw new Error('Configuración pública inválida.');
  const checks = [
    ...['products', 'categories', 'aromas', 'product_images', 'product_aromas', 'site_settings'].map(table => ({ name: table, endpoint: `/rest/v1/${table}?select=*&limit=1`, allowed: true })),
    ...['product_inventory', 'admin_users'].map(table => ({ name: table, endpoint: `/rest/v1/${table}?select=*&limit=1`, allowed: false })),
    { name: 'Auth: registro público deshabilitado', endpoint: '/auth/v1/settings', auth: true },
  ];
  let failed = false;
  const results = await Promise.allSettled(checks.map(async check => {
    const response = await fetch(new URL(check.endpoint, config.supabaseUrl), {
      headers: { apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    const ok = check.auth ? response.ok && data.disable_signup === true
      : check.allowed ? response.ok && Array.isArray(data) : [401, 403].includes(response.status);
    if (!ok) failed = true;
    return { check: check.name, result: ok ? 'OK' : 'REVISAR', status: response.status };
  }));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') console.log(`${result.value.result} · ${result.value.check} · HTTP ${result.value.status}`);
    else { failed = true; console.log(`SIN CONEXIÓN · ${checks[index].name}`); }
  });
  if (failed) process.exitCode = 1;
}
main().catch(() => { console.error('No se pudo verificar la configuración pública. No se mostraron claves ni respuestas con datos.'); process.exitCode = 1; });
