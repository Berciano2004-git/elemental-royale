// Servidor HTTP + WebSocket de Elemental Royale.
// En desarrollo usa Vite como middleware; en producción sirve dist/.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Carga .env (y .env.local) si existen: así ARCHIL_API_KEY, PORT o ADMIN_TOOLS
// pueden venir del fichero local sin exportarlas en la consola. Se buscan en la
// raíz del proyecto, no en el directorio desde el que se arranque el servidor.
for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile?.(path.join(root, file));
  } catch {
    // El fichero no existe: se usan las variables del sistema.
  }
}
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
  '.bin': 'application/octet-stream',
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
  // Solo se sirve lo que cuelga de dist/: con un simple prefijo, una carpeta
  // hermana llamada «dist-vieja» también pasaría el filtro.
  if (!file.startsWith(`${dist}${path.sep}`)) {
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

// Mapas horneados: assets/maps/<id>/. Se sirven también en desarrollo (antes
// que Vite) para que el cliente cargue el mismo terreno que usa el servidor.
const mapsRoot = path.join(root, 'assets', 'maps');

function serveMap(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    res.end('Petición inválida');
    return;
  }
  const file = path.normalize(path.join(mapsRoot, pathname.replace(/^\/maps\//, '')));
  if (!file.startsWith(`${mapsRoot}${path.sep}`) || !/\.(json|bin|png)$/i.test(file)) {
    res.statusCode = 404;
    res.end('No encontrado');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('No encontrado');
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Sonda de salud para el host: dice si el proceso vive y cuántas salas hay
  // abiertas. No toca la partida ni sirve estado de jugadores.
  if (req.url === '/healthz') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        ok: true,
        uptime: Math.round(process.uptime()),
        rooms: game ? game.rooms.size : 0,
        players: game ? [...game.rooms.values()].reduce((sum, room) => sum + room.size, 0) : 0,
      })
    );
    return;
  }
  if (req.url.startsWith('/maps/')) {
    serveMap(req, res);
    return;
  }
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
// Plazo de reconexión configurable: sirve para probar el corte de red sin
// esperar los 40 s reales. Sin variable se usa el valor por defecto.
const reconnectGrace = Number(process.env.RECONNECT_GRACE);
// Detrás del host (Fly, Render, Railway) la IP real llega en X-Forwarded-For. Si
// el servidor se expone directo, TRUST_PROXY=0 evita que se pueda falsear.
const trustProxy = process.env.TRUST_PROXY === '0' ? false : prod || process.env.TRUST_PROXY === '1';
const game = createGame(wss, {
  admin: adminTools,
  graceSeconds: Number.isFinite(reconnectGrace) && reconnectGrace > 0 ? reconnectGrace : undefined,
  trustProxy,
  mapa: process.env.MAPA || undefined,
});

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

// Direcciones para compartir en la red local. Se ordenan por utilidad: primero la
// Wi-Fi o el cable, y al final los adaptadores virtuales (VirtualBox, WSL, Hyper-V),
// que existen pero no llegan a los amigos.
function lanAddresses() {
  const virtual = /vethernet|virtual|vmware|hyper-v|wsl|loopback|docker|bluetooth|tap|tun/i;
  const preferred = /wi-?fi|wlan|wireless|ethernet|eth|en\d/i;
  const score = ({ name, iface }) => {
    let value = 0;
    if (virtual.test(name)) value -= 10;
    if (preferred.test(name)) value += 5;
    if (iface.address.startsWith('10.')) value += 3;
    else if (iface.address.startsWith('192.168.')) value += 2;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)) value += 1;
    return value;
  };
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list || []).map((iface) => ({ name, iface })))
    .filter(({ iface }) => iface && iface.family === 'IPv4' && !iface.internal)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 2)
    .map(({ iface }) => iface.address);
}

server.listen(port, '0.0.0.0', () => {
  console.log('');
  console.log('  ✦ ELEMENTAL ROYALE ✦');
  console.log(`  Local:   http://localhost:${port}`);
  const lan = lanAddresses();
  if (lan.length) {
    console.log(`  Red LAN: http://${lan[0]}:${port}  (comparte esta URL con quien esté en tu misma red)`);
    for (const extra of lan.slice(1)) console.log(`           http://${extra}:${port}  (otra interfaz)`);
  }
  console.log(`  Modo:    ${prod ? 'producción (dist/)' : 'desarrollo (Vite)'}`);
  console.log(`  Mapa:    ${process.env.MAPA ? `${process.env.MAPA} (horneado)` : 'procedural (semilla por partida)'}`);
  console.log('');
});

function shutdown() {
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
