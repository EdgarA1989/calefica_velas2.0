// Servidor exclusivamente local de preview. Hostinger sirve estos archivos estáticos.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' };
http.createServer((request, response) => {
  let url;
  try { url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); return response.end(); }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
  if (url === '/admin') { response.writeHead(302, { Location: '/admin/' }); return response.end(); }
  if (url.endsWith('/')) url += 'index.html';
  const file = path.resolve(root, '.' + url);
  const allowed = url === '/index.html' || /^\/(admin|js|css|assets)\//.test(url);
  if (!allowed || !file.startsWith(root + path.sep) || !types[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); return response.end('No encontrado');
  }
  response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(file));
}).listen(Number(process.env.CALEFICA_PREVIEW_PORT || 8086), '127.0.0.1', () => {
  console.log(`Calefica: http://127.0.0.1:${process.env.CALEFICA_PREVIEW_PORT || 8086}/admin/`);
});
