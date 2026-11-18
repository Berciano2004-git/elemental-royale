// Verifica una URL ya publicada: salud, cliente servido y protocolo del juego
// (salas, arranque desde cualquier mago, corte de red y vuelta).
//
//   node scripts/verify-public.mjs https://tu-app.fly.dev
//   PUBLIC_URL=https://tu-app.fly.dev npm run verify:public
//
// Termina con código 0 si todo está bien y 1 si algo falla.

import WebSocket from 'ws';

const target = process.argv[2] || process.env.PUBLIC_URL || '';
if (!target) {
  console.error('Uso: npm run verify:public -- https://tu-url');
  process.exit(2);
}

const raw = target.replace(/\/+$/, '');
const baseUrl = new URL(raw.includes('://') ? raw : `https://${raw}`);
const origin = baseUrl.origin;
const wsUrl = `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}/ws`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (n) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();

function step(ok, message) {
  if (!ok) {
    console.error('✗', message);
    throw new Error(message);
  }
  console.log('✓', message);
}

async function until(check, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(60);
  }
  throw new Error(`tiempo agotado esperando: ${label}`);
}

function makeClient(label) {
  const state = { label, ws: null, id: 0, room: '', resumed: false, lobby: null, start: null, snap: null, notices: [] };
  state.open = (join) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      state.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`${label}: el servidor no respondió al join`));
        }
      }, 8000);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ...join })));
      ws.on('message', (payload) => {
        const msg = JSON.parse(payload.toString());
        if (msg.t === 'welcome') {
          state.id = msg.id;
          state.room = msg.room;
          state.resumed = !!msg.resumed;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(state);
          }
        } else if (msg.t === 'lobby') state.lobby = msg;
        else if (msg.t === 'start') state.start = msg;
        else if (msg.t === 'snap') state.snap = msg;
        else if (msg.t === 'notice') state.notices.push(msg.msg);
        else if (msg.t === 'error') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`${label}: ${msg.msg}`));
          }
        }
      });
      ws.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`${label}: la conexión se cerró antes de entrar`));
        }
      });
      ws.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`${label}: ${error.message}`));
        }
      });
    });
  state.send = (type, data = {}) => {
    try {
      state.ws.send(JSON.stringify({ t: type, ...data }));
    } catch {
      /* cerrado */
    }
  };
  state.cut = () => {
    try {
      state.ws.terminate();
    } catch {
      /* ya cerrado */
    }
  };
  state.close = () => {
    try {
      state.ws.close();
    } catch {
      /* ya cerrado */
    }
  };
  state.player = (id) => state.snap?.players.find((p) => p.i === id);
  return state;
}

async function main() {
  console.log(`· verificando ${origin}`);

  // --- 1. Sonda de salud ------------------------------------------------
  const health = await fetch(`${origin}/healthz`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  }).catch((error) => {
    throw new Error(`/healthz no responde (${error.message}). Si el host duerme el servicio, la primera visita puede tardar.`);
  });
  step(health.ok, `/healthz responde ${health.status}`);
  const data = await health.json();
  step(data.ok === true, `la sonda declara el servidor sano (salas ${data.rooms}, magos ${data.players})`);

  // --- 2. Cliente servido ----------------------------------------------
  const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(30000) });
  step(page.ok, `/ devuelve ${page.status}`);
  const type = page.headers.get('content-type') || '';
  step(type.includes('text/html'), `el HTML llega como ${type}`);
  const html = await page.text();
  step(/Elemental Royale/i.test(html), 'la página es el juego');
  const asset = html.match(/assets\/index-[\w-]+\.js/)?.[0];
  step(!!asset, `el HTML apunta a su bundle (${asset})`);
  const script = await fetch(`${origin}/${asset}`, { signal: AbortSignal.timeout(60000) });
  const scriptType = script.headers.get('content-type') || '';
  const scriptBody = await script.text();
  step(
    script.ok && scriptBody.length > 100000 && scriptType.includes('javascript'),
    `el bundle se sirve completo (${Math.round(scriptBody.length / 1024)} kB, ${scriptType})`
  );
  // Una URL local se prueba igual, pero no sirve para compartir.
  if (baseUrl.protocol === 'https:') step(true, 'la URL usa HTTPS (TLS del host)');
  else console.log('· aviso: la URL no es HTTPS; vale para probar en local, no para compartir');

  // --- 3. WebSocket y salas --------------------------------------------
  if (wsUrl.startsWith('wss:')) step(true, `el WebSocket apunta a ${wsUrl}`);
  else console.log(`· aviso: WebSocket sin cifrar en ${wsUrl}`);
  const code = `V${random(4)}`;
  const tokenA = `verifica-${random(10)}`;
  const a = makeClient('A');
  const b = makeClient('B');
  await a.open({ name: 'Verificador A', room: code.toLowerCase(), token: tokenA });
  await b.open({ name: 'Verificador B', room: code, token: `verifica-${random(10)}` });
  step(a.room === code && b.room === code, `los dos magos entran en la sala ${code}`);
  await until(() => a.lobby?.players.length === 2, 6000, 'el lobby muestra a los dos magos');

  b.send('start');
  await until(() => a.start && b.start, 8000, 'la partida arranca desde el segundo mago');
  step(a.start.seed === b.start.seed, 'los dos juegan la misma isla');
  await until(() => a.snap && b.snap, 6000, 'llegan instantáneas de la partida');
  const idA = a.start.you;
  step(!!a.player(idA)?.al, 'el mago aparece vivo en su instantánea');

  // --- 4. Corte de red y vuelta ----------------------------------------
  a.cut();
  await wait(1200);
  step(!!b.player(idA)?.al, 'tras el corte, el mago sigue en pie (plazo de gracia)');
  step(
    b.notices.some((notice) => notice.includes('desconectado')),
    'el otro mago ve el aviso de desconexión'
  );

  const back = makeClient('A2');
  await back.open({ name: 'Verificador A', room: code, token: tokenA });
  step(back.resumed === true, 'la vuelta recupera la misma partida');
  await until(() => back.start, 6000, 'el mago recibe el estado de la partida');
  step(back.start.you === idA, 'vuelve el mismo mago, no uno nuevo');
  await until(() => back.snap, 4000, 'vuelve a recibir instantáneas');
  step(!!back.player(idA)?.al, 'el mago está vivo al volver');

  back.close();
  b.close();
  await wait(300);

  console.log(`\n✅ ${origin} publicado y jugable`);
  console.log(`   Comparte: ${origin}/?sala=${code}`);
}

setTimeout(() => {
  console.error('✗ la verificación ha tardado demasiado (90 s)');
  process.exit(1);
}, 90000).unref();

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ verificación fallida:', error.message);
    process.exit(1);
  });
