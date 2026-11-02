const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const browserPath = process.env.CALEFICA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function browser(t, preload, route = '/admin/', options = {}) {
  const root = path.resolve(__dirname, '../..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'calefica-admin-'));
  const server = http.createServer((req, res) => {
    let url = new URL(req.url, 'http://localhost').pathname;
    if (url.endsWith('/')) url += 'index.html';
    const file = path.resolve(root, '.' + decodeURIComponent(url));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => child.kill());
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se inició Edge')), 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  t.after(() => socket.close());
  const pending = new Map(); let serial = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const { sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find(target => target.type === 'page').targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < (options.waitAttempts || 120); i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error('No se cumplió: ' + expression);
  };
  await page('Page.enable'); await page('Network.enable');
  await page('Network.setBlockedURLs', { urls: options.allowExternal ? ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*', 'https://images.unsplash.com/*'] : ['https://*'] });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: preload });
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${route}` });
  return { evaluate, page, waitFor, pause, profile, close: () => send('Browser.close') };
}
module.exports = { browser, browserPath };
