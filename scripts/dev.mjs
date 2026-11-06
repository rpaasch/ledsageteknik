// Lokal udviklingsserver: bygger til .cache/dev, serverer på basePath og genbygger ved ændringer.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build, loadConfig, ROOT } from '../lib/build.mjs';

const PORT = Number(process.env.PORT || 8080);
const outDir = path.join(ROOT, '.cache', 'dev');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};
const clients = new Set();
let base = loadConfig().basePath;

async function rebuild() {
  try {
    const r = await build({ outDir, dev: true });
    base = r.cfg.basePath;
    for (const c of clients) c.write('data: reload\n\n');
  } catch (e) {
    console.error('Build fejlede:', e.message);
  }
}

await rebuild();

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__livereload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (!url.pathname.startsWith(base)) {
    res.writeHead(302, { Location: base });
    return res.end();
  }
  let rel = decodeURIComponent(url.pathname.slice(base.length));
  let file = path.join(outDir, rel);
  if (!file.startsWith(outDir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Ikke fundet'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`\nUdviklingsserver: http://localhost:${PORT}${base}`);
  console.log('Ændringer i content/, assets/ og site.config.json bygges automatisk. Stop med Ctrl+C.\n');
});

let timer = null;
const onChange = () => { clearTimeout(timer); timer = setTimeout(rebuild, 250); };
for (const p of ['content', 'assets']) fs.watch(path.join(ROOT, p), { recursive: true }, onChange);
fs.watch(path.join(ROOT, 'site.config.json'), onChange);
