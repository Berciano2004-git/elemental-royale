// Prueba de los límites de abuso del servidor. Necesita un servidor con topes
// pequeños para poder alcanzarlos:
//   PORT=8083 MAX_CONNECTIONS_PER_IP=3 MAX_ROOMS=2 \
//   MAX_MESSAGES_PER_SECOND=10 MAX_MESSAGE_BURST=12 MAX_MESSAGE_STRIKES=80 \
//   node server/index.js --prod
//   URL=ws://localhost:8083/ws npm run test:limits

import WebSocket from 'ws';

const URL = process.env.URL || 'ws://localhost:8083/ws';
const LIMITS = {
  connectionsPerIp: Number(process.env.MAX_CONNECTIONS_PER_IP || 3),
  maxRooms: Number(process.env.MAX_ROOMS || 2),
  messagesPerSecond: Number(process.env.MAX_MESSAGES_PER_SECOND || 10),
  messageBurst: Number(process.env.MAX_MESSAGE_BURST || 12),
  messageStrikes: Number(process.env.MAX_MESSAGE_STRIKES || 80),
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) {
    console.error('✗', message);
    throw new Error(message);
  }
  console.log('✓', message);
}

async function until(check, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(40);
  }
  throw new Error(`tiempo agotado esperando: ${label}`);
}

// `open` resuelve con el desenlace: entra (welcome), es rechazado (error) o se
// cierra antes de entrar. Así se pueden probar los rechazos sin excepciones.
function makeClient(label) {
  const state = {
    label,
    ws: null,
    id: 0,
    room: '',
    lobby: null,
    start: null,
    snap: null,
    error: '',
    closed: false,
    notices: [],
  };

  state.open = (join) =>
    new Promise((resolve) => {
      const ws = new WebSocket(URL);
      state.ws = ws;
      let settled = false;
      const done = (ok, error = '') => {
        if (settled) return;
        settled = true;
        resolve({ ok, error });
      };
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ...join })));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 'welcome') {
          state.id = msg.id;
          state.room = msg.room;
          done(true);
        } else if (msg.t === 'lobby') state.lobby = msg;
        else if (msg.t === 'start') state.start = msg;
        else if (msg.t === 'snap') state.snap = msg;
        else if (msg.t === 'notice') state.notices.push(msg.msg);
        else if (msg.t === 'error') {
          state.error = msg.msg;
          done(false, msg.msg);
        }
      });
      ws.on('close', () => {
        state.closed = true;
        done(false, state.error || 'cerrada sin mensaje');
      });
      ws.on('error', () => {});
    });

  state.send = (type, data = {}) => {
    try {
      state.ws.send(JSON.stringify({ t: type, ...data }));
    } catch {
      /* cerrado */
    }
  };
  state.close = () => {
    try {
      state.ws.close();
    } catch {
      /* ya cerrado */
    }
  };
  state.isOpen = () => state.ws?.readyState === WebSocket.OPEN;

  return state;
}

const randomRoom = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

async function main() {
  console.log(
    `· límites: ${LIMITS.connectionsPerIp} conexiones/IP, ${LIMITS.maxRooms} salas, ` +
      `${LIMITS.messagesPerSecond} msg/s (ráfaga ${LIMITS.messageBurst}, corte a los ${LIMITS.messageStrikes} descartes)`
  );

  // --- 1. Conexiones normales y salas -------------------------------------
  const alfa = randomRoom('A');
  const beta = randomRoom('B');
  const a1 = makeClient('a1');
  const a2 = makeClient('a2');
  const b1 = makeClient('b1');
  assert((await a1.open({ name: 'A1', room: alfa })).ok, 'el primer mago entra en su sala');
  assert((await a2.open({ name: 'A2', room: alfa })).ok, 'el segundo entra en la misma sala');
  assert((await b1.open({ name: 'B1', room: beta })).ok, 'una sala distinta cabe dentro del tope');
  await until(() => a1.lobby?.players.length === 2, 3000, 'el lobby de la primera sala se llena');
  assert(b1.room === beta, 'cada cliente queda en su sala');

  // --- 2. Tope de salas ---------------------------------------------------
  a2.close();
  await wait(300);
  const c1 = makeClient('c1');
  const c1Result = await c1.open({ name: 'C1', room: randomRoom('C') });
  assert(!c1Result.ok, 'una sala por encima del tope no se abre');
  assert(/máximo de salas/i.test(c1Result.error), `el rechazo explica el motivo («${c1Result.error}»)`);
  await wait(300);

  // --- 3. Tope de conexiones por IP --------------------------------------
  const d1 = makeClient('d1');
  assert((await d1.open({ name: 'D1', room: beta })).ok, 'cabe una conexión más dentro del límite por IP');
  const d2 = makeClient('d2');
  const d2Result = await d2.open({ name: 'D2', room: beta });
  assert(!d2Result.ok, 'la conexión que pasa del límite por IP se rechaza');
  assert(/Demasiadas conexiones/i.test(d2Result.error), `el rechazo explica el motivo («${d2Result.error}»)`);

  // Al cerrar una, la plaza se libera: si no, un corte dejaría la IP bloqueada.
  d1.close();
  await wait(300);
  const d3 = makeClient('d3');
  assert((await d3.open({ name: 'D3', room: beta })).ok, 'al cerrar una conexión se libera su plaza');

  // --- 4. Ritmo de mensajes: lo normal pasa ------------------------------
  for (let i = 0; i < 8; i++) {
    b1.send('input', { mx: 0, mz: 0, ax: 0, az: 0 });
    await wait(200);
  }
  await wait(300);
  assert(!b1.error && b1.isOpen(), `el tráfico normal no se corta (${Math.round(8 / 1.6)} msg/s)`);

  // --- 5. Ritmo de mensajes: abusar cierra la conexión ------------------
  for (let i = 0; i < LIMITS.messageBurst + LIMITS.messageStrikes + 60; i++) {
    a1.send('input', { mx: 0, mz: 0, ax: 0, az: 0 });
  }
  await until(() => a1.closed, 6000, 'la conexión abusiva se cierra');
  assert(/demasiado rápido/i.test(a1.error), `el corte avisa del motivo («${a1.error}»)`);

  b1.close();
  d3.close();
  await wait(200);

  console.log('\n✅ Límites de conexiones, mensajes y salas comprobados');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ prueba fallida:', error.message);
    process.exit(1);
  });
