/**
 * Serve public/ e encaminha /api/focus/* para a API Focus NF.
 * O ambiente vem do cabeçalho X-Focus-Env (hom | prod) enviado pelo app.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function focusHost(envHeader) {
  const v = String(envHeader || process.env.FOCUS_DEFAULT_ENV || 'hom').toLowerCase();
  if (v === 'prod') return 'api.focusnfe.com.br';
  return 'homologacao.focusnfe.com.br';
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function safePublicPath(urlPathname) {
  const rel = decodeURIComponent(urlPathname.replace(/^\/+/, ''));
  if (rel.includes('..')) return null;
  const abs = path.resolve(PUBLIC, rel);
  if (!abs.startsWith(PUBLIC)) return null;
  return abs;
}

function proxyFocus(req, res) {
  const host = focusHost(req.headers['x-focus-env']);
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const suffix = u.pathname.replace(/^\/api\/focus\/?/, '/') || '/';
  const targetPath = suffix + (u.search || '');

  const headers = {};
  const forward = ['authorization', 'content-type', 'accept', 'user-agent'];
  for (const k of forward) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }

  const opts = {
    hostname: host,
    port: 443,
    method: req.method,
    path: targetPath,
    headers,
    rejectUnauthorized: true,
  };

  const preq = https.request(opts, (pres) => {
    const out = {};
    for (const [k, v] of Object.entries(pres.headers)) {
      if (k === 'transfer-encoding') continue;
      out[k] = v;
    }
    res.writeHead(pres.statusCode || 502, out);
    pres.pipe(res);
  });

  preq.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'proxy_upstream', message: String(e.message) }));
  });

  req.pipe(preq);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (u.pathname.startsWith('/api/focus')) {
    proxyFocus(req, res);
    return;
  }

  if (u.pathname === '/' || u.pathname === '') {
    sendFile(res, path.join(PUBLIC, 'index.html'));
    return;
  }

  const filePath = safePublicPath(u.pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Caminho inválido');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }
    sendFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`Escola Teste NF-e → http://localhost:${PORT}`);
});
