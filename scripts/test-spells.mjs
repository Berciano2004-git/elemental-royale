// Prueba de integración del grimario: entra como anfitrión, recoge un cristal
// de cada elemento y lanza sus cuatro hechizos. Necesita un servidor de
// desarrollo en el puerto 8081 (la consola de administrador permite el
// teletransporte a los cristales).
//
//   PORT=8081 node server/index.js
//   npm run test:spells
import WebSocket from 'ws';
import { ELEMENTS, ELEMENT_KEYS, comboFor } from '../shared/constants.js';

const URL = process.env.URL || 'ws://localhost:8081/ws';
const ws = new WebSocket(URL);
let selfId = 0;
let hostId = 0;
let started = null;
let latest = null;
let ended = false;
let errors = [];
let fxLog = [];
let pendingTeleport = null;
const seenAbilities = new Set();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (t, data = {}) => ws.send(JSON.stringify({ t, ...data }));

async function waitFor(predicate, timeout = 1200) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return true;
    await wait(40);
  }
  return !!predicate();
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') selfId = msg.id;
  else if (msg.t === 'lobby') hostId = msg.hostId;
  else if (msg.t === 'start') started = msg;
  else if (msg.t === 'snap') {
    latest = msg;
    for (const fx of msg.fx || []) fxLog.push(fx);
  } else if (msg.t === 'adminTeleport' && pendingTeleport) {
    pendingTeleport(msg);
  } else if (msg.t === 'end') ended = true;
  else if (msg.t === 'error') errors.push(msg.msg);
});

ws.on('error', (error) => {
  console.error('✗ websocket:', error.message);
  process.exitCode = 1;
});

const self = () => latest?.players.find((p) => p.i === selfId) || null;
const sleep = wait;

async function teleport(x, z) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTeleport = null;
      resolve(false);
    }, 1200);
    pendingTeleport = (msg) => {
      clearTimeout(timer);
      pendingTeleport = null;
      resolve(!!msg.ok);
    };
    send('adminTeleport', { x, z });
  });
}

async function collect(element, pickups) {
  for (const pickup of pickups.splice(0, 4)) {
    if (!(await teleport(pickup.x, pickup.z))) continue;
    await sleep(140);
    const me = self();
    if (!me || !me.al) return null;
    const slot = me.sl.findIndex((value) => value && value.e === element);
    if (slot >= 0) return { slot, me };
  }
  return null;
}

async function castAbility(slot, index, ability, kind) {
  const me = self();
  if (!me || !me.al) {
    errors.push(`${ability.id}: el mago ya no está vivo`);
    return;
  }
  const zoneIds = new Set((latest.zones || []).map((z) => z.id));
  const projectileIds = new Set((latest.projs || []).map((p) => p.id));
  let beforeFxs = fxLog.length;
  let confirmed = false;

  // Las raíces y las prisiones de otros magos bloquean el lanzamiento: se
  // espera a que el efecto pase y se reintenta una vez. La confirmación exige
  // que el evento sea del jugador de prueba: los bots lanzan los mismos ids.
  for (let attempt = 0; attempt < 2 && !confirmed; attempt++) {
    await waitFor(() => {
      const cur = self();
      return !cur || !cur.al || (!cur.rt && (cur.cd?.[slot]?.[index] || 0) <= 0);
    }, 2500);
    beforeFxs = fxLog.length;
    send('select', { slot });
    send('cast', { slot, ability: index, ax: me.x + 260, az: me.z + 40 });
    confirmed = await waitFor(
      () =>
        fxLog
          .slice(beforeFxs)
          .some((fx) => fx.k === 'cast' && fx.ab === ability.id && fx.i === selfId),
      1400
    );
  }
  if (confirmed) seenAbilities.add(ability.id);
  else errors.push(`${ability.id}: el servidor no confirmó el lanzamiento`);

  const fresh = () => fxLog.slice(beforeFxs);
  if (kind === 'zone' || kind === 'summon') {
    const ok = await waitFor(
      () => (latest.zones || []).some((z) => z.o === selfId && !zoneIds.has(z.id)),
      1400
    );
    if (!ok) errors.push(`${ability.id}: no apareció la zona`);
  }
  if (kind === 'projectile' || kind === 'volley') {
    // Los proyectiles rápidos pueden impactar antes de la primera
    // instantánea; en ese caso el impacto (salpicadura, polvo u onda) es la
    // prueba de que existieron.
    const ok = await waitFor(
      () =>
        (latest.projs || []).some((p) => p.o === selfId && !projectileIds.has(p.id)) ||
        fresh().some((fx) => ['boom', 'splash', 'dust', 'gust'].includes(fx.k)),
      1400
    );
    if (!ok) errors.push(`${ability.id}: no apareció el proyectil`);
  }
  if (kind === 'dash' || kind === 'leap') {
    if (!(await waitFor(() => fresh().some((fx) => fx.k === 'dash'), 800))) {
      errors.push(`${ability.id}: no se registró el desplazamiento`);
    }
  }
  if (kind === 'beam' && !(await waitFor(() => fresh().some((fx) => fx.k === 'beam'), 800))) {
    errors.push(`${ability.id}: no se dibujó el rayo`);
  }
  console.log(`✓ ${ability.id} (${kind})`);
}

async function main() {
  await wait(400);
  for (let i = 0; i < 40 && hostId !== selfId; i++) await wait(100);
  send('start');
  for (let i = 0; i < 60 && !started; i++) await wait(100);
  if (!started) throw new Error('la partida no comenzó');
  for (let i = 0; i < 60 && !latest; i++) await wait(100);

  // Recarga y maná rápidos: la prueba busca ejecutar hechizos, no equilibrar.
  send('adminTune', {
    tune: {
      walkSpeed: 140, runMult: 1.32, accel: 30, decel: 30, strafe: 1, back: 1,
      airControl: 0.35, jumpHeight: 3.4, jumpDuration: 0.55, fallForce: 1.25,
      maxHeight: 8, radius: 2.1, mass: 1, power: 1, projSpeed: 1, projSize: 1,
      cooldown: 0.1, range: 1, duration: 1, manaCost: 0.1, manaRegen: 5,
    },
  });
  await sleep(200);

  const byElement = Object.fromEntries(ELEMENT_KEYS.map((key) => [key, []]));
  for (const pickup of started.pickups) {
    if (pickup.kind === 'power' && byElement[pickup.element]) byElement[pickup.element].push(pickup);
  }

  for (const element of ELEMENT_KEYS) {
    const found = await collect(element, byElement[element]);
    if (!found) {
      errors.push(`${element}: no se pudo recoger un cristal`);
      continue;
    }
    console.log(`· ${ELEMENTS[element].name} en el hueco ${found.slot}`);
    for (let index = 0; index < ELEMENTS[element].abilities.length; index++) {
      const ability = ELEMENTS[element].abilities[index];
      await castAbility(found.slot, index, ability, ability.fx.kind);
    }
  }

  // Una fusión real con los dos últimos elementos equipados.
  const me = self();
  const combo = me ? comboFor(me.sl[0]?.e, me.sl[1]?.e) : null;
  if (combo) {
    for (let i = 0; i < 30 && (self()?.cc || 0) > 0; i++) await sleep(100);
    const before = fxLog.length;
    send('combo', { ax: me.x + 220, az: me.z + 30 });
    await sleep(260);
    const ok = fxLog.slice(before).some((fx) => fx.k === 'combo' && fx.id === combo.id);
    if (ok) console.log(`✓ fusión ${combo.name}`);
    else errors.push(`fusión ${combo.id}: no se confirmó`);
  }

  if (ended) errors.push('la partida terminó antes de tiempo');
  if (seenAbilities.size !== 32) errors.push(`solo se probaron ${seenAbilities.size}/32 habilidades`);
  if (errors.length) {
    console.error('\n✗ Fallos:\n- ' + errors.join('\n- '));
    ws.close();
    process.exit(1);
  }
  console.log(`\n✅ ${seenAbilities.size} habilidades y una fusión ejecutadas sin errores`);
  ws.close();
  process.exit(0);
}

ws.on('open', () => {
  send('join', { name: 'PruebaGrimorio', look: {} });
});

setTimeout(() => {
  console.error('✗ tiempo de prueba agotado');
  process.exit(1);
}, 90000).unref();

main().catch((error) => {
  console.error('✗ prueba fallida:', error.message);
  process.exit(1);
});
