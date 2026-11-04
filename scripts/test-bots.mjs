// Prueba unitaria de la IA: coloca bots dentro de zonas enemigas y comprueba
// que huyen, que corren cuando están dentro y que ignoran sus propias zonas.
// No necesita servidor ni WebSocket.

import assert from 'node:assert/strict';
import { updateBots } from '../server/bots.js';

const world = {
  canStand: () => true,
  canSwim: () => false,
  canWade: () => false,
  propBlocked: () => false,
};

function makeBot(id, x, z, goal = { x: 0, z: 0 }) {
  return {
    id,
    bot: true,
    alive: true,
    x,
    z,
    prevX: x,
    prevZ: z,
    velX: 0,
    velZ: 0,
    hp: 100,
    shield: 0,
    mana: 100,
    stamina: 100,
    slots: [null, null],
    active: 0,
    cds: {},
    comboCd: 0,
    rootUntil: 0,
    input: { x: 0, z: 0, sprint: false },
    ai: {
      // Se mantiene el objetivo fijo para que la prueba mida la huida y no
      // una decisión aleatoria de búsqueda de botín.
      think: 10,
      castCd: 0,
      clock: 0,
      mode: 'loot',
      targetId: 0,
      goal,
      strafe: 1,
      steer: { sign: 0, until: 0, lastSign: 1 },
      stuckTimer: 0,
      lastX: x,
      lastZ: z,
    },
  };
}

function makeGame(bot, zones) {
  return {
    players: [bot],
    zones,
    pickups: [],
    world,
    matchTime: 10,
    storm: null,
    castAbility() {},
    castCombo() {},
  };
}

function tick(game, times = 4) {
  for (let i = 0; i < times; i++) updateBots(game, 0.1);
}

// Zona persistente: el objetivo tira hacia el centro, pero la lava debe hacer
// que el bot salga en dirección contraria y corra.
const lavaBot = makeBot(1, 40, 0);
const lava = { owner: 2, type: 'lava', x: 0, z: 0, r: 60, dps: 8, life: 20, maxLife: 20 };
tick(makeGame(lavaBot, [lava]));
assert.ok(lavaBot.input.x > 0.75, `lava: huida insuficiente (${lavaBot.input.x})`);
assert.ok(Math.abs(lavaBot.input.z) < 0.2, `lava: huida torcida (${lavaBot.input.z})`);
assert.equal(lavaBot.input.sprint, true, 'lava: debe correr al estar dentro');

// Meteorito a punto de caer: la urgencia debe imponerse también.
const meteorBot = makeBot(2, 0, 60);
const meteor = { owner: 9, type: 'meteor', x: 0, z: 0, r: 90, delay: 0.2, life: 2, maxLife: 2, dps: 0 };
tick(makeGame(meteorBot, [meteor]));
assert.ok(meteorBot.input.z > 0.75, `meteor: huida insuficiente (${meteorBot.input.z})`);

// El géiser sigue siendo peligroso después del primer aviso.
const geyserBot = makeBot(3, 0, 20);
const geyser = { owner: 2, type: 'geyser', x: 0, z: 0, r: 40, delay: -1, dmg: 14, life: 5, maxLife: 5, dps: 0 };
tick(makeGame(geyserBot, [geyser]));
assert.ok(Math.hypot(geyserBot.input.x, geyserBot.input.z) > 0.75, 'geyser: el bot se queda dentro');

// Muro lineal: la huida debe ser perpendicular a la pared, no alejarse del
// centro de un círculo que el muro no tiene.
const wallBot = makeBot(4, 0, 20);
const wall = { owner: 9, type: 'wall', x: 0, z: 20, dx: 0, dz: 1, width: 60, dps: 8, life: 20, maxLife: 20 };
tick(makeGame(wallBot, [wall]));
assert.ok(wallBot.input.x < -0.75, `muro: huida insuficiente (${wallBot.input.x})`);
assert.ok(Math.abs(wallBot.input.z) < 0.2, `muro: huida torcida (${wallBot.input.z})`);

// Las zonas propias no deben activar la huida.
const ownBot = makeBot(5, 0, 0, { x: 100, z: 0 });
const ownZone = { owner: 5, type: 'lava', x: 0, z: 0, r: 60, dps: 8, life: 20, maxLife: 20 };
tick(makeGame(ownBot, [ownZone]), 1);
assert.ok(ownBot.input.x > 0.9, `zona propia: no debe huir (${ownBot.input.x})`);

console.log('✓ bots esquivan lava, meteoritos, géiseres y muros; ignoran sus propias zonas');
