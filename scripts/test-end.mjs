// Prueba de final de partida: observa una partida con bots hasta el ganador
// y comprueba que la sala se reinicia sola.

import WebSocket from 'ws';

const URL = process.env.URL || 'ws://localhost:8081/ws';
const ws = new WebSocket(URL);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let myId = 0;
let playerId = 0;
let hostId = 0;
let started = false;
let latest = null;
let ended = null;
let lobbyAfterEnd = null;
let lastAlive = -1;
let lastLog = 0;

const send = (type, data = {}) => ws.send(JSON.stringify({ t: type, ...data }));

ws.on('open', () => {
  console.log('✓ conexión abierta');
  send('join', { name: 'Espectador', look: { robe: '#8e44ad', hat: 'crystal', magic: '#c184ff' } });
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') {
    myId = msg.id;
    console.log('✓ welcome', myId);
  } else if (msg.t === 'lobby') {
    hostId = msg.hostId;
    if (ended && !msg.inProgress) {
      lobbyAfterEnd = msg;
      console.log('✓ lobby tras el final:', msg.players.length, 'humanos, cuenta atrás', msg.countdown);
    }
  } else if (msg.t === 'start') {
    started = true;
    playerId = msg.you;
    console.log('✓ nueva partida, jugador', playerId);
  } else if (msg.t === 'snap') {
    latest = msg;
    if (msg.alive !== lastAlive) {
      lastAlive = msg.alive;
      console.log(`· vivos ${msg.alive}, tiempo ${msg.time}s, tormenta ${msg.storm?.mode} r=${msg.storm?.r}`);
    }
  } else if (msg.t === 'end') {
    ended = msg;
    console.log('✓ FIN:', JSON.stringify(msg.you), 'ganador:', msg.winner?.name, JSON.stringify(msg.top));
  }
});

ws.on('error', (error) => {
  console.error('✗ error ws', error.message);
  process.exit(1);
});

async function main() {
  await wait(300);
  for (let i = 0; i < 50 && hostId !== myId; i++) await wait(100);
  send('start');
  for (let i = 0; i < 100 && !started; i++) await wait(100);
  if (!started) throw new Error('la partida no comenzó');

  // Permanece quieto, enviando latidos de entrada para no ser expulsado.
  const startedAt = Date.now();
  while (!ended && Date.now() - startedAt < 320000) {
    const self = latest?.players.find((p) => p.i === playerId);
    send('input', { mx: 0, mz: 0, ax: self ? self.x + 10 : 0, az: self ? self.z : 0, sprint: false });
    if (latest && Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      console.log(`· ${Math.round(latest.time)}s, ${latest.alive} vivos, tormenta ${latest.storm?.mode}`);
    }
    await wait(1000);
  }
  if (!ended) throw new Error('la partida no terminó en 5 minutos');

  for (let i = 0; i < 140 && !lobbyAfterEnd; i++) await wait(100);
  if (!lobbyAfterEnd) throw new Error('la sala no se reinició tras el final');

  console.log('\n✅ Prueba de final completada');
  ws.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('✗ FALLO:', error.message);
  ws.close();
  process.exit(1);
});
