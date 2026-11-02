// Copia el bundle oficial del SDK fijado por package-lock.json, sin compilar la web.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', '@supabase', 'supabase-js');
const destination = path.join(root, 'js', 'vendor');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(source, 'dist', 'umd', 'supabase.js'), path.join(destination, 'supabase.js'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'supabase.LICENSE'));
const { version } = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(destination, 'README.md'), `# Supabase JavaScript SDK\n\nBundle UMD oficial de @supabase/supabase-js ${version}, licencia MIT (supabase.LICENSE).\nCopiado sin modificaciones con node scripts/vendor-supabase.cjs.\nPara reproducir: npm ci y npm run vendor:supabase. No requiere Node en hosting.\n`);
