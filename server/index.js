// Servidor HTTP + WebSocket de Elemental Royale.
// En desarrollo usa Vite como middleware; en producción sirve dist/.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame } from './game.js';

// Carga .env (y .env.local) si existen: así ARCHIL_API_KEY, PORT o ADMIN_TOOLS
// pueden venir del fichero local sin exportarlas en la consola.
for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile?.(file);
  } catch {
    // El fichero no existe: se usan las variables del sistema.
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

let vite = null;
if (!prod) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  });
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    pathname = '/';
  }
  let file = path.normalize(path.join(dist, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(dist)) {
    res.statusCode = 403;
    res.end('Prohibido');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || stat.isDirectory()) file = path.join(dist, 'index.html');
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.statusCode = 404;
        res.end('No encontrado');
        return;
      }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  if (vite) {
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end('No encontrado');
    });
  } else {
    serveStatic(req, res);
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
// Las herramientas de administración solo aceptan cambios de servidor en
// desarrollo o si se habilitan explícitamente (ADMIN_TOOLS=1). Así una partida
// publicada no permite que ningún cliente se ajuste daño o velocidad.
const adminTools = process.env.ADMIN_TOOLS === '1' || process.env.ADMIN_TOOLS === 'true' || !prod;
createGame(wss, { admin: adminTools });

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal);
  console.log('');
  console.log('  ✦ ELEMENTAL ROYALE ✦');
  console.log(`  Local:   http://localhost:${port}`);
  if (lan) console.log(`  Red LAN: http://${lan.address}:${port}  (comparte esta URL para jugar con amigos)`);
  console.log(`  Modo:    ${prod ? 'producción (dist/)' : 'desarrollo (Vite)'}`);
  console.log('');
});

function shutdown() {
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
