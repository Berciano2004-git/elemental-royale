// Prueba de integración del servidor: se conecta como un mago humano,
// empieza la partida, camina hasta un poder, lo recoge y lanza hechizos.

import WebSocket from 'ws';

const URL = process.env.URL || 'ws://localhost:8081/ws';
const ws = new WebSocket(URL);
let myId = 0;
let playerId = 0;
let hostId = 0;
let started = null;
let latest = null;
let ended = null;
let lobbySeen = 0;
let sawMyProjectile = false;
let sawCastFx = false;
const takenPickups = new Set();
const errors = [];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(type, data = {}) {
  ws.send(JSON.stringify({ t: type, ...data }));
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') {
    myId = msg.id;
    console.log('✓ welcome', { id: myId, name: msg.name });
  } else if (msg.t === 'lobby') {
    lobbySeen++;
    hostId = msg.hostId;
    console.log(`· lobby (${msg.players.length} humanos, ${msg.bots} bots, inicio ${msg.countdown}s)`);
  } else if (msg.t === 'start') {
    started = msg;
    playerId = msg.you;
    console.log(`✓ start: semilla ${msg.seed}, jugador ${playerId}, ${msg.players.length} magos, ${msg.pickups.length} objetos`);
  } else if (msg.t === 'snap') {
    latest = msg;
    if ((msg.projs || []).some((p) => p.o === playerId)) sawMyProjectile = true;
    if ((msg.fx || []).some((fx) => fx.k === 'cast' && fx.i === playerId)) sawCastFx = true;
    for (const fx of msg.fx || []) {
      if (fx.k === 'take') takenPickups.add(fx.id);
    }
  } else if (msg.t === 'end') {
    ended = msg;
    console.log('✓ end', JSON.stringify(msg.you), 'ganador:', msg.winner?.name);
  } else if (msg.t === 'error') {
    errors.push(msg.msg);
    console.error('✗ error del servidor:', msg.msg);
  }
});

ws.on('open', () => {
  console.log('✓ conexión abierta');
  send('join', {
    name: 'MagoPrueba',
    look: {
      robe: '#2f8f6e',
      hat: 'wide',
      hatColor: '#7b3fa0',
      staff: 'crystal',
      staffColor: '#d8d2c0',
      magic: '#63e6ff',
      skin: '#f2c7a0',
      hair: '#6b3f28',
    },
  });
});

ws.on('error', (error) => {
  console.error('✗ websocket:', error.message);
  process.exitCode = 1;
});

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FALLO:', message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log('✓', message);
}

function selfSnapshot() {
  return latest?.players.find((p) => p.i === playerId);
}

async function steerTo(target, seconds, stopWhen = () => false) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const self = selfSnapshot();
    if (!self || !self.al) return false;
    if (stopWhen()) return true;
    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) break;
    const len = dist || 1;
    send('input', { mx: dx / len, mz: dz / len, ax: target.x, az: target.z, sprint: true });
    await wait(90);
  }
  send('input', { mx: 0, mz: 0, ax: 0, az: 0 });
  return true;
}

async function main() {
  await wait(400);
  assert(myId > 0, 'el servidor asignó un id de cliente');

  // Espera a que la sala esté lista y empieza.
  for (let i = 0; i < 40 && hostId !== myId; i++) await wait(100);
  assert(hostId === myId, 'el primer cliente es el anfitrión');
  send('start');

  for (let i = 0; i < 100 && !started; i++) await wait(100);
  assert(started, 'la partida comenzó');
  for (let i = 0; i < 100 && !latest; i++) await wait(100);
  assert(latest, 'se recibieron instantáneas de la partida');

  const self0 = selfSnapshot();
  assert(self0 && self0.al, 'el mago está vivo al comenzar');
  const api = started.players.find((p) => p.id === playerId);
  assert(api, 'el mago aparece en la lista inicial');

  // 1. Movimiento hacia el cristal más cercano.
  const powerPickups = started.pickups.filter((p) => p.kind === 'power');
  let power = null;
  for (const pickup of powerPickups) {
    const self = selfSnapshot();
    const dist = Math.hypot(pickup.x - self.x, pickup.z - self.z);
    if (!power || dist < power.dist) power = { ...pickup, dist };
  }
  const before = { x: self0.x, z: self0.z };
  const walkTarget =
    powerPickups
      .map((p) => ({ ...p, dist: Math.hypot(p.x - before.x, p.z - before.z) }))
      .filter((p) => p.dist > 90)
      .sort((a, b) => a.dist - b.dist)[0] || { x: before.x + 120, z: before.z + 70 };
  await steerTo(walkTarget, 3.5);
  await wait(250);
  const after = selfSnapshot();
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  assert(moved > 32, `el mago se movió (${moved.toFixed(1)} unidades)`);

  // 2. Recoger ese poder.
  console.log('· poder objetivo:', power.element, power.rarity, 'a', power.dist.toFixed(0), 'm');
  let picked = false;
  for (let attempt = 0; attempt < 4 && !picked; attempt++) {
    await steerTo(power, 10, () => {
      const s = selfSnapshot();
      return !!(s && s.sl.some(Boolean));
    });
    await wait(300);
    const s = selfSnapshot();
    if (s?.sl.some(Boolean)) picked = true;
    else {
      // Busca otro poder cercano si el primero quedó inalcanzable.
      const self = selfSnapshot();
      const alt = started.pickups
        .filter((p) => p.kind === 'power')
        .map((p) => ({ ...p, dist: Math.hypot(p.x - self.x, p.z - self.z) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (alt) {
        power = alt;
        console.log('· nuevo objetivo:', alt.element, 'a', alt.dist.toFixed(0), 'm');
      }
    }
  }
  const withPower = selfSnapshot();
  assert(picked && withPower.sl.some(Boolean), `recogió un poder (${JSON.stringify(withPower.sl)})`);

  // 3. Lanzar el hechizo principal.
  const slot = withPower.act;
  const element = withPower.sl[slot].e;
  const mana0 = withPower.mn;
  assert(withPower.al, 'el mago sigue vivo para lanzar el hechizo');
  const target = latest.players.find((p) => p.al && p.i !== playerId) || { x: withPower.x + 50, z: withPower.z };
  sawMyProjectile = false;
  sawCastFx = false;
  send('cast', { slot, ability: 0, ax: target.x, az: target.z });
  await wait(180);
  const afterCast = selfSnapshot();
  const cooldown = afterCast.cd[slot]?.[0] || 0;
  assert(cooldown > 0 || afterCast.mn < mana0, `el hechizo de ${element} se lanzó (recarga ${cooldown}s, maná ${afterCast.mn})`);
  assert(afterCast.mn < mana0, 'el maná se consumió');
  for (let i = 0; i < 16 && !(sawMyProjectile || sawCastFx); i++) await wait(50);
  assert(sawMyProjectile || sawCastFx, 'el servidor confirmó el lanzamiento del hechizo');

  // 4. Segundo elemento y combinación.
  let gotSecond = false;
  for (let attempt = 0; attempt < 6 && !gotSecond; attempt++) {
    const s = selfSnapshot();
    if (!s || !s.al) {
      console.log('· el mago murió antes de probar la combinación');
      break;
    }
    const currentElements = s.sl.filter(Boolean).map((v) => v.e);
    const candidates = started.pickups
      .filter((p) => p.kind === 'power' && !takenPickups.has(p.id) && !currentElements.includes(p.element))
      .map((p) => ({ ...p, dist: Math.hypot(p.x - s.x, p.z - s.z) }))
      .sort((a, b) => a.dist - b.dist);
    const targetPickup = candidates[0];
    if (!targetPickup) {
      console.log('· no quedan cristales accesibles de otro elemento');
      break;
    }
    console.log(`· segundo objetivo: ${targetPickup.element} a ${targetPickup.dist.toFixed(0)} m`);
    await steerTo(targetPickup, 14, () => {
      const cur = selfSnapshot();
      return !!(cur && new Set(cur.sl.filter(Boolean).map((v) => v.e)).size >= 2);
    });
    await wait(300);
    const now = selfSnapshot();
    gotSecond = !!(now && new Set(now.sl.filter(Boolean).map((v) => v.e)).size >= 2);
  }

  if (gotSecond) {
    const s = selfSnapshot();
    const zonesBefore = (latest.zones || []).length;
    send('combo', { ax: s.x + 120, az: s.z + 40 });
    await wait(400);
    const afterCombo = selfSnapshot();
    assert(afterCombo.cc > 0, 'la combinación elemental activó su recarga');
    assert((latest.zones || []).length > zonesBefore, 'la combinación creó un efecto en el mundo');
    console.log('✓ combinación de', JSON.stringify(afterCombo.sl));
  } else {
    console.log('· no se pudo reunir dos elementos distintos a tiempo (la prueba principal sigue siendo válida)');
  }

  // 5. Tormenta.
  assert(latest.storm && latest.storm.r > 0, 'la tormenta está activa con radio');
  console.log('· tormenta:', JSON.stringify(latest.storm));
  console.log('· vivos:', latest.alive, '· tiempo:', latest.time);

  if (errors.length) throw new Error('el servidor devolvió errores');
  console.log('\n✅ Prueba de partida completada');
  ws.close();
  process.exit(process.exitCode || 0);
}

setTimeout(() => {
  if (!ended) {
    console.error('✗ tiempo de prueba agotado');
    process.exit(1);
  }
}, 120000).unref();

main().catch((error) => {
  console.error('✗ prueba fallida:', error.message);
  ws.close();
  process.exit(1);
});
