// Prueba de integración de salas privadas, arranque libre y reconexión.
// Necesita un servidor de pruebas con un plazo de gracia corto:
//   PORT=8081 RECONNECT_GRACE=3 node server/index.js
//   URL=ws://localhost:8081/ws npm run test:rooms

import WebSocket from 'ws';

const URL = process.env.URL || 'ws://localhost:8081/ws';
const GRACE = Number(process.env.RECONNECT_GRACE || 3);
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
    await wait(60);
  }
  throw new Error(`tiempo agotado esperando: ${label}`);
}

const randomToken = (label) => `${label}-${Math.random().toString(36).slice(2, 12)}`;

// Cada mago guarda lo último recibido de cada tipo de mensaje; las aserciones
// se hacen sobre eso, que es exactamente lo que ve el navegador.
function makeClient(label) {
  const state = {
    label,
    ws: null,
    id: 0,
    room: '',
    resumed: false,
    lobby: null,
    start: null,
    resumeStart: null,
    snap: null,
    notices: [],
    deaths: [],
    error: null,
  };

  state.connect = (join) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(URL);
      state.ws = ws;
      let settled = false;
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ...join })));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 'welcome') {
          state.id = msg.id;
          state.room = msg.room;
          state.resumed = !!msg.resumed;
          if (!settled) {
            settled = true;
            resolve(state);
          }
        } else if (msg.t === 'lobby') state.lobby = msg;
        else if (msg.t === 'start') {
          if (msg.resume) state.resumeStart = msg;
          else state.start = msg;
        } else if (msg.t === 'snap') {
          state.snap = msg;
          for (const fx of msg.fx || []) if (fx.k === 'death') state.deaths.push(fx);
        } else if (msg.t === 'notice') state.notices.push(msg.msg);
        else if (msg.t === 'error') {
          state.error = msg.msg;
          if (!settled) {
            settled = true;
            reject(new Error(msg.msg));
          }
        }
      });
      ws.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
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
      /* ya estaba cerrado */
    }
  };
  state.close = () => {
    try {
      state.ws.close();
    } catch {
      /* ya estaba cerrado */
    }
  };
  state.player = (id) => state.snap?.players.find((p) => p.i === id);

  return state;
}

async function main() {
  // --- 1. Salas: dos grupos no se ven entre sí ----------------------------
  const a = makeClient('A');
  const b = makeClient('B');
  const c = makeClient('C');
  const tokenA = randomToken('alfa-a');
  await a.connect({ name: 'PruebaA', room: 'alfa', token: tokenA });
  await b.connect({ name: 'PruebaB', room: 'ALFA', token: randomToken('alfa-b') });
  await c.connect({ name: 'PruebaC', room: 'beta', token: randomToken('beta-c') });

  assert(a.room === 'ALFA' && b.room === 'ALFA', 'el código se normaliza: «alfa» entra en ALFA');
  assert(c.room === 'BETA', 'un código distinto abre otra sala');

  await until(() => a.lobby?.players.length === 2 && c.lobby?.players.length === 1, 4000, 'lobbies separados');
  assert(a.lobby.room === 'ALFA', 'el lobby muestra el código de la sala');
  assert(a.lobby.players.length === 2 && c.lobby.players.length === 1, 'la sala BETA no ve a los magos de ALFA');

  // --- 2. Arranque libre: no hace falta ser el anfitrión ------------------
  assert(a.lobby.hostId === a.id, 'el primero en entrar es el anfitrión');
  b.send('start');
  await until(() => a.start && b.start, 5000, 'la partida arranca desde el segundo mago');
  assert(a.start.seed === b.start.seed, 'los dos magos juegan la misma isla');
  assert(a.start.you !== b.start.you, 'cada uno tiene su id de jugador');

  await until(() => a.snap && b.snap, 5000, 'llegaron instantáneas');
  const idA = a.start.you;
  assert(a.player(idA)?.al, 'A empieza vivo y recibe su estado');

  // --- 3. Corte de red: el mago no muere y puede volver -------------------
  a.cut();
  await wait(500);
  assert(b.player(idA)?.al, 'tras el corte, el mago de A sigue vivo en la partida');
  assert(!b.deaths.some((d) => d.i === idA), 'no se le mata por perder la conexión');
  assert(b.notices.some((n) => n.includes('desconectado')), 'el resto ve el aviso de desconexión');

  const a2 = makeClient('A2');
  await a2.connect({ name: 'PruebaA', room: 'ALFA', token: tokenA });
  assert(a2.resumed === true, 'la vuelta se reconoce con el testigo de la sesión');
  await until(() => a2.resumeStart, 3000, 'el mago recibe el estado de la partida');
  assert(a2.resumeStart.you === idA, 'vuelve el mismo mago, no uno nuevo');
  assert(a2.resumeStart.seed === a.start.seed, 'vuelve a la misma isla');
  await until(() => a2.snap, 3000, 'vuelve a recibir instantáneas');
  assert(a2.player(idA)?.al, 'el mago está vivo al volver');
  assert(b.notices.some((n) => n.includes('ha vuelto')), 'el resto ve el aviso de vuelta');
  assert(b.player(idA)?.al, 'B sigue viendo vivo al mago que volvió');

  // --- 4. Si no vuelve, el plazo se agota y el mago cae -------------------
  a2.cut();
  await until(
    () => {
      const p = b.player(idA);
      return p && !p.al;
    },
    (GRACE + 6) * 1000,
    'el mago muere al agotarse el plazo'
  );
  const death = b.deaths.find((d) => d.i === idA);
  assert(death?.cause === 'se desconectó', `la causa es la desconexión («${death?.cause}»)`);

  // Volver después del plazo crea un mago nuevo, no resucita al caído.
  const a3 = makeClient('A3');
  await a3.connect({ name: 'PruebaA', room: 'ALFA', token: tokenA });
  assert(a3.resumed === false, 'pasado el plazo, el testigo ya no recupera la partida');

  a3.close();
  b.close();
  c.close();
  await wait(200);

  console.log('\n✅ Salas, arranque libre y reconexión comprobados');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ prueba fallida:', error.message);
    process.exit(1);
  });
