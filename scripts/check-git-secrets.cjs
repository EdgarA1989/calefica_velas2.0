// Revisión de archivos candidatos a Git; muestra rutas, nunca valores secretos.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const vm = require('node:vm');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const privateFiles = files.filter(file => /^(imports|reports|credentials|node_modules|dist)\//.test(file) || /\.env(?:\.|$)|config\.local\.js|Calefica-dev\.txt/.test(file));
const patterns = [
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
const possibleSecrets = [];
for (const file of files) {
  if (!/\.(?:js|cjs|json|sql|gs|md|html|css|txt)$/.test(file)) continue;
  if (patterns.some(pattern => pattern.test(fs.readFileSync(file, 'utf8')))) possibleSecrets.push(file);
}
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('js/config.js', 'utf8'), context);
const config = context.window.CALEFICA_CONFIG;
if (Object.keys(config).some(key => !['dataProvider','whatsappNumber','supabaseUrl','supabasePublishableKey'].includes(key)) || !config.supabasePublishableKey.startsWith('sb_publishable_')) throw new Error('La configuración no cumple la lista de campos públicos.');
console.log(JSON.stringify({ files: files.length, privateFiles, possibleSecrets, provider: config.dataProvider }));
if (privateFiles.length || possibleSecrets.length) process.exitCode = 1;
