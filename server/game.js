// Servidor autoritativo de Elemental Royale.
// Simula el mundo a 30 Hz y envía instantáneas a 20 Hz.

import {
  DAMAGE_SCALE,
  ELEMENT_KEYS,
  ELEMENTS,
  HATS,
  LOBBY_TIME,
  MATCH_PLAYERS,
  MAX_HIT_DAMAGE,
  MAX_HP,
  MAX_MANA,
  MAX_STAMINA,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RARITIES,
  RARITY_KEYS,
  SNAPSHOT_RATE,
  STAVES,
  STORM_PHASES,
  TICK_RATE,
  comboFor,
  defaultLook,
  randomLook,
  randomWizardName,
} from '../shared/constants.js';
import { HALF_WORLD } from '../shared/constants.js';
import { clamp, createWorld, elevationAt, findOpenSpot, MOUNTAIN_LEVEL } from '../shared/worldgen.js';
import { moveWithCollision, normalizeInput } from '../shared/movement.js';
import { SWIM_DEPTH, SWIM_SPEED_MULT } from '../shared/constants.js';
import { STYLE_COLORS } from '../shared/palette.js';
import { updateBots } from './bots.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const colorCss = (c) => '#' + c.toString(16).padStart(6, '0');
const styleColor = (style) => STYLE_COLORS[style] || 0xffffff;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Ajustes de administrador por jugador. Los límites son deliberadamente
// generosos (es una herramienta de desarrollo), pero nunca dejan entrar NaN
// ni valores que puedan romper la simulación.
// Los bots comparten hechizos y simulación con el jugador, pero no deben
// castigar con la misma frecuencia ni mover el mismo volumen de daño. Se
// aplican en el servidor para que la reducción sea autoritativa y no dependa
// de la configuración del cliente.
const BOT_DAMAGE_SCALE = 0.62;
const BOT_SPEED_SCALE = 0.86;
// Las zonas del jugador (lava, muros, campos, tornados, prisiones, geiseres,
// meteoros, oleadas y súbditos) hacen un 30 % menos de daño. Las zonas de los
// bots ya reciben BOT_DAMAGE_SCALE al golpear a un humano; entre bots se dejan
// normales para que las rondas no queden en tablas.
const ZONE_DAMAGE_SCALE = 0.7;

const ADMIN_RANGES = {
  walkSpeed: [30, 220, PLAYER_SPEED],
  runMult: [0.8, 2.5, 1.32],
  accel: [1, 40, 30],
  decel: [1, 40, 30],
  strafe: [0.3, 1.5, 1],
  back: [0.3, 1.5, 1],
  airControl: [0, 1, 0.35],
  jumpHeight: [0, 10, 3.4],
  jumpDuration: [0.2, 2, 0.55],
  fallForce: [0.5, 3, 1.25],
  maxHeight: [1, 20, 8],
  radius: [0.8, 4.5, PLAYER_RADIUS],
  mass: [0.3, 3, 1],
  power: [0.1, 4, 1],
  projSpeed: [0.3, 3, 1],
  projSize: [0.3, 3, 1],
  cooldown: [0.1, 3, 1],
  range: [0.3, 3, 1],
  duration: [0.2, 3, 1],
  manaCost: [0.1, 3, 1],
  manaRegen: [0.1, 5, 1],
};

const ADMIN_DEFAULT = Object.freeze(
  Object.fromEntries(Object.entries(ADMIN_RANGES).map(([key, values]) => [key, values[2]]))
);

function sanitizeAdminTune(raw) {
  const out = { ...ADMIN_DEFAULT };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, [min, max, fallback]] of Object.entries(ADMIN_RANGES)) {
    const value = Number(raw[key]);
    out[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  return out;
}

function adminTune(player) {
  return player && player.admin ? player.admin : ADMIN_DEFAULT;
}

function sanitizeLook(raw) {
  const def = defaultLook();
  if (!raw || typeof raw !== 'object') return def;
  const out = { ...def };
  if (HATS.some((h) => h.id === raw.hat)) out.hat = raw.hat;
  if (STAVES.some((s) => s.id === raw.staff)) out.staff = raw.staff;
  for (const key of ['robe', 'hatColor', 'staffColor', 'magic', 'skin', 'hair']) {
    if (typeof raw[key] === 'string' && COLOR_RE.test(raw[key])) out[key] = raw[key].toLowerCase();
  }
  return out;
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return randomWizardName();
  const name = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return name.length >= 2 ? name : randomWizardName();
}

function rollRarity() {
  const total = RARITY_KEYS.reduce((sum, key) => sum + RARITIES[key].weight, 0);
  let roll = Math.random() * total;
  for (const key of RARITY_KEYS) {
    roll -= RARITIES[key].weight;
    if (roll <= 0) return key;
  }
  return 'common';
}

function rarityPower(rarity) {
  return (RARITIES[rarity] || RARITIES.common).power;
}

export function createGame(wss, options = {}) {
  const adminEnabled = options.admin !== false;
  const clients = new Map();
  let nextClientId = 1;
  let state = createLobbyState();
  let snapAcc = 0;

  function createLobbyState() {
    return {
      phase: 'lobby',
      seed: 0,
      world: null,
      matchTime: 0,
      players: [],
      pickups: [],
      projectiles: [],
      zones: [],
      fx: [],
      storm: null,
      winner: null,
      lobbyTimer: LOBBY_TIME,
      endTimer: 0,
      nextEntityId: 1,
      lastLobbySecond: -1,
    };
  }

  const botsCtx = {
    get players() {
      return state.players;
    },
    get pickups() {
      return state.pickups;
    },
    get world() {
      return state.world;
    },
    get storm() {
      return state.storm;
    },
    get matchTime() {
      return state.matchTime;
    },
    castAbility,
    castCombo,
    hasElement,
  };

  function send(ws, data) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(data));
      } catch {
        /* conexión corrupta */
      }
    }
  }

  function joinedClients() {
    return [...clients.values()].filter((c) => c.joined);
  }

  function hostClient() {
    return joinedClients()[0] || null;
  }

  function broadcastLobby() {
    const joined = joinedClients();
    const payload = {
      t: 'lobby',
      players: joined.map((c) => ({ id: c.id, name: c.name, look: c.look })),
      bots: Math.max(0, MATCH_PLAYERS - joined.length),
      countdown: state.phase === 'lobby' ? Math.max(0, Math.ceil(state.lobbyTimer)) : 0,
      inProgress: state.phase !== 'lobby',
      phase: state.phase,
      hostId: hostClient()?.id || 0,
      capacity: MATCH_PLAYERS,
    };
    for (const client of joined) send(client.ws, payload);
  }

  // ---------------------------------------------------------------- conexión

  wss.on('connection', (ws) => {
    if (joinedClients().length >= MATCH_PLAYERS) {
      send(ws, { t: 'error', msg: 'La sala está llena (10 magos). Inténtalo de nuevo en unos segundos.' });
      ws.close();
      return;
    }

    const client = {
      id: nextClientId++,
      ws,
      joined: false,
      name: '',
      look: defaultLook(),
      player: null,
    };
    clients.set(ws, client);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      handleMessage(client, msg);
    });

    ws.on('close', () => handleDisconnect(client));
    ws.on('error', () => handleDisconnect(client));
  });

  function handleMessage(client, msg) {
    switch (msg.t) {
      case 'join': {
        client.name = sanitizeName(msg.name);
        client.look = sanitizeLook(msg.look);
        client.joined = true;
        send(client.ws, {
          t: 'welcome',
          id: client.id,
          name: client.name,
          look: client.look,
          hostId: hostClient()?.id || 0,
          admin: adminEnabled,
        });
        broadcastLobby();
        break;
      }
      case 'look': {
        if (!client.joined) return;
        client.look = sanitizeLook(msg.look);
        if (client.player && state.phase === 'lobby') client.player.look = client.look;
        broadcastLobby();
        break;
      }
      case 'start': {
        if (!client.joined) return;
        if (state.phase !== 'lobby') return;
        if (hostClient() !== client) return;
        startMatch();
        break;
      }
      case 'input': {
        const p = client.player;
        if (!p || !p.alive || state.phase !== 'match') return;
        const mx = clamp(num(msg.mx), -1, 1);
        const mz = clamp(num(msg.mz), -1, 1);
        const n = normalizeInput(mx, mz);
        p.input.x = n.mx;
        p.input.z = n.mz;
        p.input.sprint = !!msg.sprint;
        if (Number.isFinite(msg.ax) && Number.isFinite(msg.az)) {
          p.aimX = clamp(msg.ax, -HALF_WORLD, HALF_WORLD);
          p.aimZ = clamp(msg.az, -HALF_WORLD, HALF_WORLD);
        }
        p.lastInputAt = state.matchTime;
        break;
      }
      case 'select': {
        const p = client.player;
        if (!p || state.phase !== 'match') return;
        const slot = msg.slot === 1 ? 1 : 0;
        if (p.slots[slot]) p.active = slot;
        break;
      }
      case 'jump': {
        const p = client.player;
        if (!p || !p.alive || state.phase !== 'match') return;
        if (p.swimming) return;
        if (p.rootUntil > state.matchTime) return;
        if (p.jumpY > 0.01) return;
        const tune = adminTune(p);
        if (tune.jumpHeight <= 0) return;
        p.jumpV = (4 * tune.jumpHeight) / Math.max(0.1, tune.jumpDuration);
        p.jumpY = 0.001;
        break;
      }
      case 'adminTune': {
        if (!adminEnabled || !client.player) return;
        client.player.admin = sanitizeAdminTune(msg.tune);
        send(client.ws, { t: 'admin', enabled: true, applied: true, tune: client.player.admin });
        break;
      }
      case 'adminTeleport': {
        if (!adminEnabled || !client.player || state.phase !== 'match' || !client.player.alive) return;
        const p = client.player;
        const tune = adminTune(p);
        let target = null;
        if (msg.reset) {
          target = findOpenSpot(state.world, p.x, p.z, Math.random, 26);
        } else {
          const x = num(msg.x, NaN);
          const z = num(msg.z, NaN);
          if (!Number.isFinite(x) || !Number.isFinite(z)) return;
          const cx = clamp(x, -HALF_WORLD + 40, HALF_WORLD - 40);
          const cz = clamp(z, -HALF_WORLD + 40, HALF_WORLD - 40);
          if (!state.world.canStand(cx, cz, tune.radius)) {
            send(client.ws, { t: 'adminTeleport', ok: false, msg: 'Ese punto está bloqueado o fuera del terreno.' });
            return;
          }
          target = { x: cx, z: cz };
        }
        if (!target) return;
        p.x = target.x;
        p.z = target.z;
        p.prevX = p.x;
        p.prevZ = p.z;
        p.mvX = 0;
        p.mvZ = 0;
        p.jumpY = 0;
        p.jumpV = 0;
        p.swimming = state.world.depthAt(p.x, p.z) > SWIM_DEPTH;
        send(client.ws, { t: 'adminTeleport', ok: true, x: r1(p.x), z: r1(p.z), swim: p.swimming });
        break;
      }
      case 'cast': {
        const p = client.player;
        if (!p) return;
        const slot = msg.slot === 1 ? 1 : 0;
        const ability = Math.max(0, Math.min(3, Number(msg.ability) | 0));
        castAbility(p, slot, ability, num(msg.ax, p.aimX), num(msg.az, p.aimZ));
        break;
      }
      case 'combo': {
        const p = client.player;
        if (!p) return;
        castCombo(p, num(msg.ax, p.aimX), num(msg.az, p.aimZ));
        break;
      }
      default:
        break;
    }
  }

  function handleDisconnect(client) {
    if (!clients.has(client.ws)) return;
    clients.delete(client.ws);
    const p = client.player;
    if (state.phase === 'match' && p && p.alive) {
      killPlayer(p, null, 'abandonó la partida');
    }
    if (state.phase !== 'lobby' && joinedClients().length === 0) {
      toLobby();
    } else if (state.phase === 'lobby') {
      broadcastLobby();
    }
  }

  // ---------------------------------------------------------------- partida

  function startMatch() {
    if (state.phase !== 'lobby') return;
    const humans = joinedClients();
    if (humans.length === 0) return;

    const seed = (Math.random() * 1_000_000_000) | 0;
    const world = createWorld(seed);
    state = {
      phase: 'match',
      seed,
      world,
      matchTime: 0,
      players: [],
      pickups: [],
      projectiles: [],
      zones: [],
      fx: [],
      storm: null,
      winner: null,
      lobbyTimer: 0,
      endTimer: 0,
      nextEntityId: 1,
      lastLobbySecond: -1,
    };
    snapAcc = 0;

    const spawns = makeSpawnPoints(world, MATCH_PLAYERS);
    let spawnIndex = 0;

    for (const client of humans) {
      const spot = spawns[spawnIndex++];
      const player = makePlayer(client.name, client.look, false, spot.x, spot.z);
      player.client = client;
      client.player = player;
      state.players.push(player);
    }

    while (state.players.length < MATCH_PLAYERS) {
      const spot = spawns[spawnIndex++ % spawns.length];
      const bot = makePlayer(randomWizardName(), randomLook(), true, spot.x, spot.z);
      bot.ai = {
        think: 0.35 + Math.random() * 0.5,
        goal: null,
        mode: 'loot',
        targetId: 0,
        strafe: Math.random() < 0.5 ? 1 : -1,
        stuck: 0,
        lastX: bot.x,
        lastZ: bot.z,
        castCd: 1.2 + Math.random() * 1.2,
      };
      state.players.push(bot);
    }

    setupStorm(world);
    generatePickups(world, spawns);

    for (const client of humans) {
      const p = client.player;
      send(client.ws, {
        t: 'start',
        seed,
        you: p.id,
        storm: stormPublic(),
        players: state.players.map((pl) => ({
          id: pl.id,
          name: pl.name,
          look: pl.look,
          bot: pl.bot,
          x: r1(pl.x),
          z: r1(pl.z),
        })),
        pickups: state.pickups.map(publicPickup),
      });
    }

    broadcastLobby();
  }

  function makePlayer(name, look, bot, x, z) {
    return {
      id: state.nextEntityId++,
      name,
      look: sanitizeLook(look),
      bot,
      client: null,
      x,
      z,
      prevX: x,
      prevZ: z,
      velX: 0,
      velZ: 0,
      yaw: Math.random() * Math.PI * 2,
      aimX: x,
      aimZ: z + 10,
      hp: MAX_HP,
      shield: 0,
      mana: MAX_MANA,
      stamina: MAX_STAMINA,
      alive: true,
      kills: 0,
      place: 0,
      slots: [null, null],
      active: 0,
      cds: Object.fromEntries(ELEMENT_KEYS.map((key) => [key, [0, 0, 0, 0]])),
      comboCd: 0,
      rootUntil: 0,
      slowUntil: 0,
      slowFactor: 0.55,
      lastDamageAt: -99,
      lastInputAt: 0,
      input: { x: 0, z: 0, sprint: false },
      moving: false,
      mvX: 0,
      mvZ: 0,
      jumpY: 0,
      jumpV: 0,
      swimming: false,
      admin: null,
    };
  }

  function makeSpawnPoints(world, count) {
    const points = [];
    const offset = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      let spot = null;
      for (let attempt = 0; attempt < 16 && !spot; attempt++) {
        const angle = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const radius = 690 + Math.random() * 250;
        const x = clamp(Math.cos(angle) * radius, -HALF_WORLD + 80, HALF_WORLD - 80);
        const z = clamp(Math.sin(angle) * radius, -HALF_WORLD + 80, HALF_WORLD - 80);
        if (!world.canStand(x, z, 4)) continue;
        if (points.some((pt) => Math.hypot(pt.x - x, pt.z - z) < 70)) continue;
        spot = { x, z };
      }
      if (!spot) {
        const found = findOpenSpot(world, 0, 0, Math.random, 20);
        spot = found;
      }
      points.push(spot);
    }
    return points;
  }

  function setupStorm(world) {
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < 50; i++) {
      const x = (Math.random() - 0.5) * 400;
      const z = (Math.random() - 0.5) * 400;
      if (world.canStand(x, z, 8)) {
        cx = x;
        cz = z;
        break;
      }
    }
    const storm = {
      cx,
      cz,
      r: 1750,
      phase: 0,
      mode: 'wait',
      timer: STORM_PHASES[0].wait,
      dps: STORM_PHASES[0].dps,
      next: null,
      from: null,
    };
    storm.next = planNextStorm(storm);
    state.storm = storm;
  }

  function planNextStorm(storm) {
    const phase = STORM_PHASES[Math.min(storm.phase, STORM_PHASES.length - 1)];
    const targetR = phase.radius;
    const maxShift = Math.max(0, Math.min(storm.r - targetR - 25, 780));
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * maxShift;
      const x = storm.cx + Math.cos(angle) * dist;
      const z = storm.cz + Math.sin(angle) * dist;
      if (state.world.canStand(x, z, 8)) return { x, z, r: targetR };
    }
    return { x: storm.cx, z: storm.cz, r: targetR };
  }

  function stormPublic() {
    const s = state.storm;
    if (!s) return null;
    return {
      cx: r1(s.cx),
      cz: r1(s.cz),
      r: r1(s.r),
      phase: s.phase,
      mode: s.mode,
      timer: r1(Math.max(0, s.timer)),
      dps: s.dps,
      total: STORM_PHASES.length,
      next: s.next ? { x: r1(s.next.x), z: r1(s.next.z), r: r1(s.next.r) } : null,
    };
  }

  // ---------------------------------------------------------------- objetos

  function publicPickup(p) {
    return { id: p.id, x: r1(p.x), z: r1(p.z), kind: p.kind, element: p.element || null, rarity: p.rarity || null };
  }

  function spawnPickup(kind, element, rarity, x, z, blockedFor = 0, blockedUntil = 0, announce = false) {
    const pickup = {
      id: state.nextEntityId++,
      kind,
      element,
      rarity,
      x,
      z,
      blockedFor,
      blockedUntil,
    };
    state.pickups.push(pickup);
    if (announce) state.fx.push({ k: 'spawnPickup', p: publicPickup(pickup) });
    return pickup;
  }

  function generatePickups(world, spawns) {
    const elements = [...ELEMENT_KEYS, ...ELEMENT_KEYS];
    for (let i = elements.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [elements[i], elements[j]] = [elements[j], elements[i]];
    }

    const randomLand = () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = (Math.random() * 2 - 1) * (HALF_WORLD - 90);
        const z = (Math.random() * 2 - 1) * (HALF_WORLD - 90);
        if (!world.canStand(x, z, 3.4)) continue;
        if (state.pickups.some((p) => Math.hypot(p.x - x, p.z - z) < 46)) continue;
        return { x, z };
      }
      return null;
    };

    for (let i = 0; i < 74; i++) {
      const spot = randomLand();
      if (!spot) continue;
      const element = elements[i % elements.length];
      spawnPickup('power', element, rollRarity(), spot.x, spot.z);
    }

    for (let i = 0; i < 22; i++) {
      const spot = randomLand();
      if (!spot) continue;
      spawnPickup('heal', null, 'common', spot.x, spot.z);
    }

    // Tesoros cerca de los lugares especiales: mejor rareza.
    for (const landmark of world.landmarks) {
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 20;
        const x = landmark.x + Math.cos(angle) * dist;
        const z = landmark.z + Math.sin(angle) * dist;
        if (!world.canStand(x, z, 3.4)) continue;
        const rarity = Math.random() < 0.22 ? 'legendary' : Math.random() < 0.5 ? 'epic' : 'rare';
        spawnPickup('power', ELEMENT_KEYS[(Math.random() * ELEMENT_KEYS.length) | 0], rarity, x, z);
      }
    }

    // Un poder y un cristal de vida junto a cada punto de aparición.
    for (const spawn of spawns) {
      const near = findOpenSpot(world, spawn.x + (Math.random() - 0.5) * 40, spawn.z + (Math.random() - 0.5) * 40, Math.random, 6);
      spawnPickup('power', ELEMENT_KEYS[(Math.random() * ELEMENT_KEYS.length) | 0], rollRarity(), near.x, near.z);
      const nearHeal = findOpenSpot(world, spawn.x, spawn.z, Math.random, 14);
      spawnPickup('heal', null, 'common', nearHeal.x, nearHeal.z);
    }
  }

  function collectPickups() {
    for (const p of state.players) {
      if (!p.alive) continue;
      for (let i = state.pickups.length - 1; i >= 0; i--) {
        const pickup = state.pickups[i];
        if (Math.hypot(p.x - pickup.x, p.z - pickup.z) > 8) continue;
        if (pickup.blockedFor === p.id && state.matchTime < pickup.blockedUntil) continue;
        state.pickups.splice(i, 1);
        state.fx.push({ k: 'take', id: pickup.id });
        applyPickup(p, pickup);
      }
    }
  }

  function applyPickup(p, pickup) {
    if (pickup.kind === 'heal') {
      const bonus = hasElement(p, 'ice') ? 6 : 0;
      p.hp = Math.min(MAX_HP, p.hp + 28 + bonus);
      state.fx.push({ k: 'heal', x: pickup.x, z: pickup.z, i: p.id });
      return;
    }
    let slot = p.slots.findIndex((s) => s === null);
    if (slot === -1) {
      slot = p.active;
      const old = p.slots[slot];
      if (old) dropPower(p, old);
    }
    p.slots[slot] = { element: pickup.element, rarity: pickup.rarity || 'common' };
    p.active = slot;
    if (pickup.element === 'earth') {
      p.shield = Math.min(70, p.shield + 30);
    }
    if (pickup.element === 'dark') {
      p.shield = Math.min(70, p.shield + 15);
    }
    if (hasElement(p, 'nature')) {
      p.hp = Math.min(MAX_HP, p.hp + 5);
    }
    state.fx.push({
      k: 'pickup',
      x: pickup.x,
      z: pickup.z,
      i: p.id,
      el: pickup.element,
      rarity: pickup.rarity,
      name: p.name,
    });
  }

  function dropPower(p, slotValue) {
    const spot = findOpenSpot(state.world, p.x, p.z, Math.random, 14);
    spawnPickup('power', slotValue.element, slotValue.rarity, spot.x, spot.z, p.id, state.matchTime + 1.6, true);
  }

  // ---------------------------------------------------------------- hechizos

  function hasElement(p, element) {
    return p.slots.some((s) => s && s.element === element);
  }

  function aimFrom(p, ax, az, range) {
    let dx = num(ax, p.aimX) - p.x;
    let dz = num(az, p.aimZ) - p.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.001) {
      dx = 0;
      dz = 1;
      len = 1;
    } else {
      dx /= len;
      dz /= len;
    }
    const dist = range ? Math.min(len, range) : len;
    return { x: p.x + dx * dist, z: p.z + dz * dist, dx, dz, dist };
  }

  function applyRoot(target, duration) {
    if (!target.alive) return;
    target.rootUntil = Math.max(target.rootUntil, state.matchTime + duration);
  }

  // Cadena de rayos: salta de un enemigo al más cercano que quede, perdiendo
  // fuerza en cada salto. El cliente dibuja las líneas con `pts`.
  function chainBolt(source, x, z, count, range, dmg, mult, falloff = 0.85) {
    let fromX = x;
    let fromZ = z;
    const hit = new Set([source.id]);
    const points = [{ x: r1(x), z: r1(z) }];
    let current = dmg;
    for (let i = 0; i < count; i++) {
      let best = null;
      let bestDist = range;
      for (const target of state.players) {
        if (!target.alive || hit.has(target.id)) continue;
        const d = Math.hypot(target.x - fromX, target.z - fromZ);
        if (d < bestDist) {
          bestDist = d;
          best = target;
        }
      }
      if (!best) break;
      hit.add(best.id);
      applyDamage(best, current * mult, source);
      points.push({ x: r1(best.x), z: r1(best.z) });
      fromX = best.x;
      fromZ = best.z;
      current *= falloff;
    }
    if (points.length > 1) state.fx.push({ k: 'chain', pts: points });
  }

  function areaDamage(source, x, z, radius, dmg, mult, options = {}) {
    for (const target of state.players) {
      if (!target.alive || target.id === source.id) continue;
      if (Math.hypot(target.x - x, target.z - z) > radius) continue;
      applyDamage(target, dmg * mult, source);
      if (options.slow) applySlow(target, options.slow.factor, options.slow.duration);
      if (options.root) applyRoot(target, typeof options.root === 'number' ? options.root : 0.6);
      if (options.knock) {
        const angle = Math.atan2(target.z - z, target.x - x);
        shove(target, Math.cos(angle), Math.sin(angle), options.knock);
      }
    }
  }

  function moveDash(p, aim, distance) {
    const radius = adminTune(p).radius;
    const from = { x: p.x, z: p.z };
    const steps = Math.max(1, Math.ceil(distance / 8));
    const stepX = (aim.dx * distance) / steps;
    const stepZ = (aim.dz * distance) / steps;
    for (let i = 0; i < steps; i++) {
      const res = moveWithCollision(state.world, p.x, p.z, stepX, stepZ, radius);
      const moved = Math.hypot(res.x - p.x, res.z - p.z);
      p.x = res.x;
      p.z = res.z;
      if (moved < Math.hypot(stepX, stepZ) * 0.5) break;
    }
    p.prevX = p.x;
    p.prevZ = p.z;
    p.mvX = 0;
    p.mvZ = 0;
    return from;
  }

  // Punto único de creación de zonas: escala solo las propiedades de daño,
  // de modo que ningún tipo de área se quede fuera del ajuste.
  function addZone(zone) {
    const owner = getPlayer(zone.owner);
    const scale = owner?.bot ? 1 : ZONE_DAMAGE_SCALE;
    if (Number.isFinite(zone.dmg)) zone.dmg *= scale;
    if (Number.isFinite(zone.dps)) zone.dps *= scale;
    state.zones.push(zone);
    return zone;
  }

  // Las zonas son la pieza común de casi todo el grimario: muros, olas,
  // remolinos, prisiones, campos, árboles y géiseres comparten la misma
  // entidad y el cliente elige la silueta por `style` y `type`.
  function castZone(p, fx, aim, mult, tune) {
    const scale = tune.projSize;
    const life = (fx.life || 6) * tune.duration;
    const radius = (fx.r || 110) * scale;
    const base = {
      id: state.nextEntityId++,
      x: aim.x,
      z: aim.z,
      dx: aim.dx,
      dz: aim.dz,
      life,
      maxLife: life,
      owner: p.id,
      style: fx.style || 'earth',
      r: radius,
      dps: (fx.dps || 0) * mult,
      slowFactor: fx.slow ? fx.slow.factor : 0,
      slowDuration: fx.slow ? fx.slow.duration : 0,
      root: fx.root ? (typeof fx.root === 'number' ? fx.root : 0.4) : 0,
      blind: fx.blind ? 1 : 0,
      strikeTimer: fx.strike || 0.5,
      maxR: fx.grow ? radius + fx.grow * scale : radius,
      grow: fx.grow ? fx.grow * scale : 0,
    };

    switch (fx.type) {
      case 'meteors': {
        const count = Math.max(1, fx.count || 3);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const offset = Math.random() * (fx.spread || 90) * scale;
          // El aviso debe dar tiempo real a salir del círculo: con 94 de
          // velocidad y 91 de radio hacen falta algo más de un segundo, así
          // que la caída se escalona en vez de multiplicar por una fracción.
          const delay = (fx.delay || 0.6) + i * (fx.stagger ?? 0.45);
          addZone({
            ...base,
            id: state.nextEntityId++,
            type: 'meteor',
            style: 'fire',
            x: aim.x + Math.cos(angle) * offset,
            z: aim.z + Math.sin(angle) * offset,
            r: (fx.r || 160) * 0.52 * scale,
            delay,
            life: delay + 1.3 * tune.duration,
            maxLife: delay + 1.3 * tune.duration,
            dmg: (fx.dmg || 20) * mult,
            dps: 0,
          });
        }
        break;
      }
      case 'wall':
        addZone({
          ...base,
          type: 'wall',
          width: (fx.width || 170) * scale,
          dps: base.dps || (fx.dps || 10) * mult,
        });
        break;
      case 'wave':
        addZone({
          ...base,
          type: 'wave',
          x: p.x + aim.dx * 24,
          z: p.z + aim.dz * 24,
          width: (fx.width || 220) * scale,
          speed: (fx.speed || 230) * tune.projSpeed,
          dmg: (fx.dmg || 14) * mult,
          knock: fx.knock || 0,
          life: 3 * tune.duration,
          maxLife: 3 * tune.duration,
          dps: 0,
          hit: new Set(),
        });
        break;
      case 'tornado':
        addZone({
          ...base,
          type: 'tornado',
          pull: (fx.pull || 240) * tune.projSpeed,
          speed: (fx.speed || 24) * tune.projSpeed,
          dps: base.dps,
          strikeTimer: fx.strike || 0.4,
        });
        break;
      case 'spikes':
        addZone({
          ...base,
          type: 'spikes',
          delay: fx.delay || 0.35,
          dmg: (fx.dmg || 22) * mult,
        });
        break;
      case 'prison':
        addZone({ ...base, type: 'prison', root: 0.4, dps: base.dps });
        break;
      case 'geyser':
        addZone({
          ...base,
          type: 'geyser',
          delay: fx.delay || 0.35,
          interval: fx.interval || 0.9,
          dmg: (fx.dmg || 14) * mult,
          dps: 0,
        });
        break;
      case 'tree':
        addZone({ ...base, type: 'tree', cover: 1, dps: 0 });
        break;
      case 'plasma':
        addZone({
          ...base,
          type: 'plasma',
          delay: fx.delay || 0.5,
          dmg: (fx.dmg || 28) * mult,
          chain: fx.chain || 3,
          dps: 0,
        });
        break;
      default:
        addZone({ ...base, type: fx.type || 'field' });
        break;
    }
  }

  // Intérprete único de las recetas del grimario. Sirve igual para una
  // habilidad suelta y para una fusión.
  function castEffect(p, fx, aim, mult, tune) {
    const speed = tune.projSpeed;
    const duration = tune.duration;
    const scale = tune.projSize;
    switch (fx.kind) {
      case 'projectile': {
        spawnProjectile({
          kind: fx.v,
          owner: p.id,
          x: p.x + aim.dx * 3,
          z: p.z + aim.dz * 3,
          dx: aim.dx,
          dz: aim.dz,
          speed: (fx.speed || 500) * speed,
          life: (fx.life || 1.5) * duration,
          dmg: (fx.dmg || 10) * mult,
          radius: (fx.radius || 3) * scale,
          splash: (fx.splash || 0) * scale,
          splashDmg: (fx.splashDmg || 0) * mult,
          pierce: !!fx.pierce,
          slow: fx.slow || null,
          knock: fx.knock || 0,
          homing: fx.homing || 0,
          prison: fx.prison || null,
          leavesLava: !!fx.leavesLava,
          trail: fx.trail || null,
          ...(fx.pierce ? { hit: new Set() } : {}),
        });
        break;
      }
      case 'volley': {
        const baseAngle = Math.atan2(aim.dz, aim.dx);
        const count = Math.max(1, fx.count | 0);
        for (let i = 0; i < count; i++) {
          const angle = baseAngle + (i - (count - 1) / 2) * (fx.spread || 0.1);
          spawnProjectile({
            kind: fx.v,
            owner: p.id,
            x: p.x + Math.cos(angle) * 3,
            z: p.z + Math.sin(angle) * 3,
            dx: Math.cos(angle),
            dz: Math.sin(angle),
            speed: (fx.speed || 500) * speed,
            life: (fx.life || 1.4) * duration,
            delay: (fx.delay || 0) * i,
            dmg: (fx.dmg || 10) * mult,
            radius: (fx.radius || 3) * scale,
            knock: fx.knock || 0,
            pierce: !!fx.pierce,
            slow: fx.slow || null,
            homing: fx.homing || 0,
            ...(fx.pierce ? { hit: new Set() } : {}),
          });
        }
        break;
      }
      case 'zone':
        castZone(p, fx, aim, mult, tune);
        break;
      case 'burst': {
        const x = fx.atAim ? aim.x : p.x;
        const z = fx.atAim ? aim.z : p.z;
        const radius = (fx.radius || 150) * scale;
        state.fx.push({ k: 'boom', x: r1(x), z: r1(z), r: radius, c: colorCss(styleColor(fx.style)) });
        areaDamage(p, x, z, radius, fx.dmg || 15, mult, fx);
        if (fx.chain) chainBolt(p, x, z, fx.chain, 190, (fx.dmg || 15) * 0.6, mult);
        break;
      }
      case 'beam': {
        const length = Math.max(60, aim.dist || fx.length || 480);
        const endX = p.x + aim.dx * length;
        const endZ = p.z + aim.dz * length;
        const width = (fx.width || 14) * scale;
        for (const target of state.players) {
          if (!target.alive || target.id === p.id) continue;
          const rx = target.x - p.x;
          const rz = target.z - p.z;
          const along = rx * aim.dx + rz * aim.dz;
          if (along < 0 || along > length) continue;
          if (Math.abs(-rx * aim.dz + rz * aim.dx) > width + PLAYER_RADIUS) continue;
          applyDamage(target, (fx.dmg || 12) * mult, p);
          if (fx.slow) applySlow(target, fx.slow.factor, fx.slow.duration);
        }
        state.fx.push({
          k: 'beam',
          x: r1(p.x),
          z: r1(p.z),
          x2: r1(endX),
          z2: r1(endZ),
          c: colorCss(styleColor(fx.style)),
        });
        if (fx.chain) chainBolt(p, endX, endZ, fx.chain, fx.chainRange || 190, (fx.dmg || 12) * 0.7, mult, fx.falloff || 0.85);
        break;
      }
      case 'dash': {
        const distance = (fx.distance || 250) * Math.min(1.7, speed);
        const from = moveDash(p, aim, distance);
        state.fx.push({
          k: 'dash',
          x: r1(from.x),
          z: r1(from.z),
          x2: r1(p.x),
          z2: r1(p.z),
          c: colorCss(styleColor(fx.style)),
        });
        if (fx.burst) {
          state.fx.push({ k: 'boom', x: r1(p.x), z: r1(p.z), r: fx.burst.r || 120, c: colorCss(styleColor(fx.style)) });
          areaDamage(p, p.x, p.z, fx.burst.r || 120, fx.burst.dmg || 12, mult, fx.burst);
        }
        break;
      }
      case 'leap': {
        const distance = (fx.distance || 180) * Math.min(1.7, speed);
        const from = moveDash(p, aim, distance);
        const t = Math.max(0.1, tune.jumpDuration);
        const gravity = (8 * Math.max(1, tune.jumpHeight)) / (t * t);
        p.jumpY = 0.05;
        p.jumpV = Math.sqrt(2 * gravity * Math.max(1, fx.height || 4));
        state.fx.push({
          k: 'dash',
          x: r1(from.x),
          z: r1(from.z),
          x2: r1(p.x),
          z2: r1(p.z),
          c: colorCss(styleColor(fx.style)),
        });
        break;
      }
      case 'summon': {
        const summonLife = (fx.life || 10) * duration;
        addZone({
          id: state.nextEntityId++,
          type: 'summon',
          mob: fx.mob,
          style: fx.mob === 'clone' ? 'dark' : fx.mob === 'guardian' ? 'guardian' : 'earth',
          x: aim.x,
          z: aim.z,
          r: (fx.r || 130) * scale,
          life: summonLife,
          maxLife: summonLife,
          dps: (fx.dps || 0) * mult,
          speed: (fx.speed || 110) * speed,
          slow: fx.slow || 0.75,
          owner: p.id,
          targetId: 0,
          strikeTimer: 0.4,
        });
        break;
      }
      default:
        break;
    }
  }

  function castAbility(p, slotIdx, abilityIdx, ax, az) {
    if (state.phase !== 'match' || !p || !p.alive) return false;
    if (slotIdx !== 0 && slotIdx !== 1) return false;
    if (abilityIdx < 0 || abilityIdx > 3) return false;
    const tune = adminTune(p);
    const slot = p.slots[slotIdx];
    if (!slot) return false;
    if (p.rootUntil > state.matchTime) return false;
    const element = slot.element;
    const meta = ELEMENTS[element]?.abilities[abilityIdx];
    if (!meta) return false;
    if (p.cds[element][abilityIdx] > 0) return false;
    const manaCost = meta.mana * tune.manaCost;
    if (p.mana < manaCost) return false;

    p.mana -= manaCost;
    const cdMult = hasElement(p, 'lightning') ? 0.92 : 1;
    p.cds[element][abilityIdx] = meta.cd * tune.cooldown * cdMult;
    p.active = slotIdx;

    const aim = aimFrom(p, ax, az, meta.range * tune.range);
    p.yaw = Math.atan2(aim.x - p.x, aim.z - p.z);
    p.aimX = aim.x;
    p.aimZ = aim.z;

    const mult = rarityPower(slot.rarity) * (hasElement(p, 'fire') ? 1.12 : 1) * tune.power * DAMAGE_SCALE;
    state.fx.push({ k: 'cast', x: p.x, z: p.z, el: element, ab: meta.id, i: p.id, c: colorCss(ELEMENTS[element].color) });

    // Todas las habilidades del grimario llevan su receta en `meta.fx`; el
    // antiguo switch se conserva como red de seguridad para poderes viejos.
    if (meta.fx) {
      castEffect(p, meta.fx, aim, mult, tune);
      return true;
    }

    switch (meta.id) {
      case 'lavabolt':
        spawnProjectile({
          kind: 'lavabolt',
          owner: p.id,
          x: p.x + aim.dx * 3,
          z: p.z + aim.dz * 3,
          dx: aim.dx,
          dz: aim.dz,
          speed: 520 * tune.projSpeed,
          life: 1.5 * tune.duration,
          dmg: 16 * mult,
          radius: 2.6 * tune.projSize,
          splash: 60 * tune.projSize,
          splashDmg: 8 * mult,
        });
        break;
      case 'flamewall': {
        const dist = Math.max(80, aim.dist);
        addZone({
          id: state.nextEntityId++,
          type: 'wall',
          style: 'fire',
          x: p.x + aim.dx * dist,
          z: p.z + aim.dz * dist,
          dx: aim.dx,
          dz: aim.dz,
          width: 165 * tune.projSize,
          life: 7 * tune.duration,
          maxLife: 7 * tune.duration,
          dps: 12 * mult,
          owner: p.id,
        });
        break;
      }
      case 'jet':
        spawnProjectile({
          kind: 'jet',
          owner: p.id,
          x: p.x + aim.dx * 2,
          z: p.z + aim.dz * 2,
          dx: aim.dx,
          dz: aim.dz,
          speed: 760 * tune.projSpeed,
          life: 0.66 * tune.duration,
          dmg: 11 * mult,
          radius: 3.2 * tune.projSize,
          pierce: true,
          hit: new Set(),
          slow: { factor: 0.65, duration: 0.9 },
        });
        break;
      case 'tsunami': {
        addZone({
          id: state.nextEntityId++,
          type: 'wave',
          style: 'water',
          x: p.x + aim.dx * 24,
          z: p.z + aim.dz * 24,
          dx: aim.dx,
          dz: aim.dz,
          width: 210 * tune.projSize,
          speed: 230 * tune.projSpeed,
          life: 3 * tune.duration,
          maxLife: 3 * tune.duration,
          dmg: 14 * mult,
          owner: p.id,
          hit: new Set(),
        });
        break;
      }
      case 'gust':
        spawnProjectile({
          kind: 'gust',
          owner: p.id,
          x: p.x + aim.dx * 2,
          z: p.z + aim.dz * 2,
          dx: aim.dx,
          dz: aim.dz,
          speed: 820 * tune.projSpeed,
          life: 0.6 * tune.duration,
          dmg: 8 * mult,
          radius: 9 * tune.projSize,
          // Perfora y aparta a cada rival que corta, no solo al primero.
          pierce: true,
          hit: new Set(),
          knock: 45,
        });
        break;
      case 'tornado':
        addZone({
          id: state.nextEntityId++,
          type: 'tornado',
          style: 'wind',
          x: aim.x,
          z: aim.z,
          dx: aim.dx,
          dz: aim.dz,
          r: 100 * tune.projSize,
          pull: 240 * tune.projSpeed,
          speed: 26 * tune.projSpeed,
          life: 6 * tune.duration,
          maxLife: 6 * tune.duration,
          dps: 11 * mult,
          owner: p.id,
          strikeTimer: 0.4,
        });
        break;
      case 'rocks': {
        const baseAngle = Math.atan2(aim.dz, aim.dx);
        for (let i = 0; i < 3; i++) {
          const angle = baseAngle + (i - 1) * 0.09;
          spawnProjectile({
            kind: 'rock',
            owner: p.id,
            x: p.x + Math.cos(angle) * 3,
            z: p.z + Math.sin(angle) * 3,
            dx: Math.cos(angle),
            dz: Math.sin(angle),
            speed: 440 * tune.projSpeed,
            life: 1.35 * tune.duration,
            delay: i * 0.12,
            dmg: 13 * mult,
            radius: 3.4 * tune.projSize,
            knock: 22,
          });
        }
        break;
      }
      case 'quake': {
        const radius = 180 * tune.projSize;
        state.fx.push({ k: 'quake', x: p.x, z: p.z, r: radius, i: p.id });
        for (const target of state.players) {
          if (!target.alive || target.id === p.id) continue;
          if (Math.hypot(target.x - p.x, target.z - p.z) > radius) continue;
          applyDamage(target, 16 * mult, p);
          applySlow(target, 0.5, 2.4);
        }
        break;
      }
      default:
        break;
    }
    return true;
  }

  function castCombo(p, ax, az) {
    if (state.phase !== 'match' || !p || !p.alive) return false;
    if (p.rootUntil > state.matchTime) return false;
    const slotA = p.slots[0];
    const slotB = p.slots[1];
    if (!slotA || !slotB) return false;
    const combo = comboFor(slotA.element, slotB.element);
    if (!combo) return false;
    const tune = adminTune(p);
    const manaCost = combo.mana * tune.manaCost;
    if (p.comboCd > 0 || p.mana < manaCost) return false;

    p.comboCd = combo.cd * tune.cooldown;
    p.mana -= manaCost;
    const aim = aimFrom(p, ax, az, combo.range * tune.range);
    p.yaw = Math.atan2(aim.x - p.x, aim.z - p.z);
    p.aimX = aim.x;
    p.aimZ = aim.z;
    const mult = (1 + (hasElement(p, 'fire') ? 0.12 : 0)) * tune.power * DAMAGE_SCALE;

    state.fx.push({ k: 'combo', x: aim.x, z: aim.z, id: combo.id, name: combo.name, i: p.id });

    if (combo.fx) {
      castEffect(p, combo.fx, aim, mult, tune);
      return true;
    }

    const zone = (extra) => {
      addZone({
        id: state.nextEntityId++,
        owner: p.id,
        dx: aim.dx,
        dz: aim.dz,
        life: 6 * tune.duration,
        maxLife: 6 * tune.duration,
        ...extra,
      });
    };

    switch (combo.id) {
      case 'meteor':
        zone({ type: 'meteor', style: 'fire', x: aim.x, z: aim.z, r: 110 * tune.projSize, delay: 1.5, life: 2.8 * tune.duration, dmg: 22 * mult });
        break;
      case 'thunderstorm':
        zone({ type: 'storm', style: 'storm', x: aim.x, z: aim.z, r: 180 * tune.projSize, life: 6 * tune.duration, dps: 10 * mult, slowFactor: 0.75, strikeTimer: 0.4 });
        break;
      case 'mud':
        zone({ type: 'mud', style: 'earth', x: aim.x, z: aim.z, r: 155 * tune.projSize, life: 7 * tune.duration, dps: 4 * mult, slowFactor: 0.5 });
        break;
      case 'firestorm':
        zone({ type: 'tornado', style: 'fire', x: aim.x, z: aim.z, r: 115 * tune.projSize, pull: 250 * tune.projSpeed, speed: 30 * tune.projSpeed, life: 6 * tune.duration, dps: 15 * mult, strikeTimer: 0.3 });
        break;
      case 'steam':
        zone({ type: 'steam', style: 'steam', x: aim.x, z: aim.z, r: 165 * tune.projSize, life: 7 * tune.duration, dps: 3 * mult, slowFactor: 0.55 });
        break;
      case 'sandstorm':
        zone({ type: 'sandstorm', style: 'sand', x: aim.x, z: aim.z, r: 185 * tune.projSize, life: 7 * tune.duration, dps: 8 * mult, slowFactor: 0.6 });
        break;
      default:
        break;
    }
    return true;
  }

  function spawnProjectile(opts) {
    const projectile = {
      id: state.nextEntityId++,
      delay: 0,
      radius: 3,
      life: 2,
      speed: 500,
      ...opts,
    };
    state.projectiles.push(projectile);
    return projectile;
  }

  function applyDamage(target, amount, source, options = {}) {
    if (!target.alive || state.phase !== 'match' || amount <= 0) return;
    // Tope por impacto: ni una rareza legendaria con fuego ni una fusión
    // pueden borrar a un mago de un solo golpe.
    // La reducción protege al jugador de la presión de la IA. Entre bots se
    // mantiene el daño normal para que las rondas no queden en tablas cuando
    // los últimos supervivientes son todos controlados por el servidor.
    const scale = source?.bot ? (target.bot ? 1 : BOT_DAMAGE_SCALE) : 1;
    const scaled = amount * scale;
    let dmg = Math.min(scaled, MAX_HIT_DAMAGE);
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    target.lastDamageAt = state.matchTime;
    if (!options.silent) {
      state.fx.push({ k: 'hit', x: target.x, z: target.z, i: target.id });
    }
    if (target.hp <= 0) killPlayer(target, source, options.cause || 'hechizo');
  }

  function applySlow(target, factor, duration) {
    if (!target.alive) return;
    target.slowFactor = factor;
    target.slowUntil = Math.max(target.slowUntil, state.matchTime + duration);
  }

  function shove(target, dx, dz, distance) {
    const tune = adminTune(target);
    const total = distance / Math.max(0.3, tune.mass);
    const steps = Math.max(1, Math.ceil(total / 6));
    const stepX = (dx * total) / steps;
    const stepZ = (dz * total) / steps;
    for (let i = 0; i < steps; i++) {
      const res = moveWithCollision(state.world, target.x, target.z, stepX, stepZ, tune.radius);
      target.x = res.x;
      target.z = res.z;
    }
  }

  function killPlayer(p, killer, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.place = state.players.filter((x) => x.alive).length + 1;
    if (killer && killer !== p) killer.kills++;
    for (const slot of p.slots) {
      if (slot) dropPower(p, slot);
    }
    state.fx.push({
      k: 'death',
      x: r1(p.x),
      z: r1(p.z),
      name: p.name,
      by: killer ? killer.name : null,
      cause,
      i: p.id,
    });
    if (state.players.filter((x) => x.alive).length <= 1) {
      finishMatch(state.players.find((x) => x.alive) || null);
    }
  }

  function finishMatch(winner) {
    if (state.phase !== 'match') return;
    if (winner) winner.place = 1;
    state.phase = 'ending';
    state.endTimer = 9;
    state.winner = winner ? { name: winner.name, kills: winner.kills, look: winner.look, id: winner.id } : null;
    const sorted = [...state.players].sort((a, b) => (a.place || 99) - (b.place || 99));
    for (const client of joinedClients()) {
      const p = client.player;
      if (!p) continue;
      send(client.ws, {
        t: 'end',
        winner: state.winner,
        you: { name: p.name, place: p.place || 2, kills: p.kills },
        top: sorted.slice(0, 3).map((pl) => ({ name: pl.name, kills: pl.kills, place: pl.place || 2, look: pl.look })),
      });
    }
    broadcastSnapshot();

    // Historial persistente en Archil. El módulo (y la SDK) solo se cargan si
    // hay ARCHIL_API_KEY, y un fallo de red nunca debe afectar al final.
    if (process.env.ARCHIL_API_KEY) {
      const summary = {
        seed: state.seed,
        players: state.players.length,
        humans: joinedClients().length,
        durationS: Math.round(state.matchTime),
        winner: state.winner ? state.winner.name : null,
        kills: state.winner ? state.winner.kills : 0,
        top: sorted.slice(0, 3).map((pl) => ({ name: pl.name, kills: pl.kills, place: pl.place || 2 })),
      };
      import('./history.js')
        .then(({ recordMatchSafely }) => recordMatchSafely(summary))
        .catch((error) => console.warn(`⚠ Archil: ${error.message}`));
    }
  }

  function toLobby() {
    for (const client of clients.values()) client.player = null;
    state = createLobbyState();
    snapAcc = 0;
    broadcastLobby();
  }

  // ---------------------------------------------------------------- simulación

  function updateLobby(dt) {
    const joined = joinedClients();
    if (joined.length === 0) return;
    state.lobbyTimer -= dt;
    const second = Math.ceil(state.lobbyTimer);
    if (second !== state.lastLobbySecond) {
      state.lastLobbySecond = second;
      broadcastLobby();
    }
    if (state.lobbyTimer <= 0) startMatch();
  }

  function simulate(dt) {
    const s = state;
    s.matchTime += dt;

    for (const p of s.players) {
      for (const element of ELEMENT_KEYS) {
        const cd = p.cds[element];
        cd[0] = Math.max(0, cd[0] - dt);
        cd[1] = Math.max(0, cd[1] - dt);
      }
      p.comboCd = Math.max(0, p.comboCd - dt);
      if (!p.alive) continue;
      p.mana = Math.min(MAX_MANA, p.mana + 9 * dt * adminTune(p).manaRegen);
      if (hasElement(p, 'water') && p.hp < MAX_HP) p.hp = Math.min(MAX_HP, p.hp + 1 * dt);
      const wantsSprint = p.input.sprint && !p.swimming && (Math.abs(p.input.x) + Math.abs(p.input.z) > 0.1) && p.stamina > 2;
      if (wantsSprint) p.stamina = Math.max(0, p.stamina - 22 * dt);
      else p.stamina = Math.min(MAX_STAMINA, p.stamina + 16 * dt);
    }

    updateBots(botsCtx, dt);

    for (const p of s.players) {
      if (!p.alive) {
        p.moving = false;
        continue;
      }
      if (!p.bot && s.matchTime - p.lastInputAt > 0.7) {
        p.input.x = 0;
        p.input.z = 0;
        p.input.sprint = false;
      }
      p.prevX = p.x;
      p.prevZ = p.z;
      const tune = adminTune(p);
      const input = normalizeInput(p.input.x, p.input.z);
      let mx = input.mx;
      let mz = input.mz;
      if (tune.strafe !== 1 || tune.back !== 1) {
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        const rx = Math.cos(p.yaw);
        const rz = -Math.sin(p.yaw);
        const forward = mx * fx + mz * fz;
        const right = mx * rx + mz * rz;
        mx = fx * (forward < 0 ? forward * tune.back : forward) + rx * right * tune.strafe;
        mz = fz * (forward < 0 ? forward * tune.back : forward) + rz * right * tune.strafe;
      }
      // El agua manda: al hundirse hasta la cintura se pasa a nado, se pierde
      // el sprint y el salto, y la velocidad baja. El cliente usa el mismo
      // umbral para predecir, así que no hay tirones al entrar y salir.
      p.swimming = s.world.depthAt(p.x, p.z) > SWIM_DEPTH;
      if (p.swimming) {
        p.jumpY = 0;
        p.jumpV = 0;
      }
      let speed = tune.walkSpeed;
      // Raíces, hielo y prisiones anulan el movimiento sin quitar el control
      // de la cámara: el mago sigue pudiendo apuntar y lanzar.
      if (p.rootUntil > s.matchTime) speed = 0;
      else if (p.swimming) speed *= SWIM_SPEED_MULT;
      else {
        if (hasElement(p, 'wind')) speed *= 1.1;
        if (p.input.sprint && p.stamina > 2) speed *= tune.runMult;
      }
      if (p.slowUntil > s.matchTime) speed *= p.slowFactor;
      // La IA recorre el mapa con algo menos de velocidad para que una huida o
      // un cambio de cobertura del jugador tengan margen de reacción.
      if (p.bot) speed *= BOT_SPEED_SCALE;
      const airborne = p.jumpY > 0.01;
      const airFactor = airborne ? 0.15 + tune.airControl * 0.85 : 1;
      const rate = (mx || mz ? tune.accel : tune.decel) * airFactor;
      const blend = 1 - Math.exp(-rate * dt);
      p.mvX += (mx * speed - p.mvX) * blend;
      p.mvZ += (mz * speed - p.mvZ) * blend;
      if (!mx && !mz && Math.hypot(p.mvX, p.mvZ) < 0.5) {
        p.mvX = 0;
        p.mvZ = 0;
      }
      const res = moveWithCollision(s.world, p.x, p.z, p.mvX * dt, p.mvZ * dt, tune.radius);
      p.x = res.x;
      p.z = res.z;
      p.velX = dt > 0 ? (p.x - p.prevX) / dt : 0;
      p.velZ = dt > 0 ? (p.z - p.prevZ) / dt : 0;
      p.moving = Math.hypot(p.x - p.prevX, p.z - p.prevZ) > 0.1;
      if (!p.moving && (p.mvX || p.mvZ)) {
        p.mvX *= 0.2;
        p.mvZ *= 0.2;
      }

      // Salto autoritativo: la altura y la duración configuradas definen la
      // gravedad, de modo que todos los clientes ven el mismo arco.
      if (p.jumpY > 0 || p.jumpV !== 0) {
        const h = Math.max(0, tune.jumpHeight);
        const t = Math.max(0.1, tune.jumpDuration);
        const g = (8 * h) / (t * t);
        const fall = p.jumpV < 0 ? tune.fallForce : 1;
        p.jumpV -= g * fall * dt;
        p.jumpY += p.jumpV * dt;
        if (p.jumpY > tune.maxHeight) {
          p.jumpY = tune.maxHeight;
          p.jumpV = Math.min(0, p.jumpV);
        }
        if (p.jumpY <= 0) {
          p.jumpY = 0;
          p.jumpV = 0;
        }
      }

      const aimDx = p.aimX - p.x;
      const aimDz = p.aimZ - p.z;
      if (Math.hypot(aimDx, aimDz) > 0.4) p.yaw = Math.atan2(aimDx, aimDz);
    }

    updateProjectiles(dt);
    updateZones(dt);
    collectPickups();
    updateStorm(dt);

    if (state.matchTime > 420 && state.phase === 'match') {
      const best = [...state.players].filter((p) => p.alive).sort((a, b) => b.kills - a.kills || b.hp - a.hp)[0];
      finishMatch(best || null);
    }

    snapAcc += dt;
    if (snapAcc >= 1 / SNAPSHOT_RATE) {
      snapAcc = 0;
      broadcastSnapshot();
    }
  }

  function updateStorm(dt) {
    const storm = state.storm;
    if (!storm) return;
    const phase = STORM_PHASES[Math.min(storm.phase, STORM_PHASES.length - 1)];
    storm.dps = phase.dps;

    if (storm.mode === 'wait') {
      storm.timer -= dt;
      if (storm.timer <= 0) {
        storm.mode = 'shrink';
        storm.timer = phase.shrink;
        storm.from = { cx: storm.cx, cz: storm.cz, r: storm.r };
        if (!storm.next) storm.next = planNextStorm(storm);
      }
    } else if (storm.mode === 'shrink') {
      storm.timer -= dt;
      const duration = Math.max(0.001, phase.shrink);
      const t = clamp(1 - Math.max(0, storm.timer) / duration, 0, 1);
      const k = t * t * (3 - 2 * t);
      const from = storm.from || { cx: storm.cx, cz: storm.cz, r: storm.r };
      const target = storm.next || { x: storm.cx, z: storm.cz, r: phase.radius };
      storm.cx = from.cx + (target.x - from.cx) * k;
      storm.cz = from.cz + (target.z - from.cz) * k;
      storm.r = from.r + (target.r - from.r) * k;
      if (storm.timer <= 0) {
        storm.phase += 1;
        if (storm.phase < STORM_PHASES.length) {
          storm.mode = 'wait';
          storm.timer = STORM_PHASES[storm.phase].wait;
          storm.next = planNextStorm(storm);
        } else {
          storm.mode = 'final';
          storm.timer = 0;
          storm.next = null;
        }
        storm.from = null;
      }
    }

    for (const p of state.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - storm.cx, p.z - storm.cz);
      if (d > storm.r) {
        applyDamage(p, storm.dps * dt, null, { silent: true, cause: 'la tormenta arcana' });
      }
    }
  }

  function updateProjectiles(dt) {
    const s = state;
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const pr = s.projectiles[i];
      if (pr.delay > 0) {
        pr.delay -= dt;
        continue;
      }
      pr.life -= dt;
      // Persecución suave: la llama abismal y los orbes sombríos corrigen el
      // rumbo hacia el enemigo más cercano sin llegar a ser infalibles.
      if (pr.homing) {
        let target = null;
        let best = 340;
        for (const p of s.players) {
          if (!p.alive || p.id === pr.owner) continue;
          const d = Math.hypot(p.x - pr.x, p.z - pr.z);
          if (d < best) {
            best = d;
            target = p;
          }
        }
        if (target) {
          const desired = Math.atan2(target.x - pr.x, target.z - pr.z);
          const current = Math.atan2(pr.dx, pr.dz);
          let diff = desired - current;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = Math.max(-dt * 2.4, Math.min(dt * 2.4, diff));
          const angle = current + turn;
          pr.dx = Math.sin(angle);
          pr.dz = Math.cos(angle);
        }
      }
      const total = pr.speed * dt;
      const steps = Math.max(1, Math.ceil(total / 6));
      const stepX = pr.dx * (total / steps);
      const stepZ = pr.dz * (total / steps);
      let impact = false;
      let direct = null;

      for (let step = 0; step < steps; step++) {
        pr.x += stepX;
        pr.z += stepZ;
        if (pr.x < -HALF_WORLD || pr.x > HALF_WORLD || pr.z < -HALF_WORLD || pr.z > HALF_WORLD) {
          impact = true;
          break;
        }
        const elev = elevationAt(pr.x, pr.z, s.seed);
        if (elev < 0.4 || elev > MOUNTAIN_LEVEL - 0.004) {
          impact = true;
          break;
        }
        // Un árbol protector detiene los proyectiles: es cobertura real y no
        // solo un adorno.
        for (const zone of s.zones) {
          if (zone.type !== 'tree' || !zone.cover) continue;
          if (Math.hypot(pr.x - zone.x, pr.z - zone.z) < zone.r * 0.5) {
            impact = true;
            break;
          }
        }
        if (impact) break;
        for (const p of s.players) {
          if (!p.alive || p.id === pr.owner) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) <= pr.radius + adminTune(p).radius) {
            if (pr.pierce) {
              if (!pr.hit.has(p.id)) {
                pr.hit.add(p.id);
                applyDamage(p, pr.dmg, getPlayer(pr.owner));
                if (pr.slow) applySlow(p, pr.slow.factor, pr.slow.duration);
                if (pr.knock) shove(p, pr.dx, pr.dz, pr.knock);
              }
            } else {
              direct = p;
              impact = true;
              break;
            }
          }
        }
        if (impact) break;
      }

      if (impact || pr.life <= 0) {
        resolveProjectile(pr, direct);
        s.projectiles.splice(i, 1);
      }
    }
  }

  function resolveProjectile(pr, direct) {
    const owner = getPlayer(pr.owner);
    switch (pr.kind) {
      case 'lavabolt': {
        const tune = owner ? adminTune(owner) : ADMIN_DEFAULT;
        state.fx.push({ k: 'boom', x: r1(pr.x), z: r1(pr.z), r: 62, c: '#ff7b34' });
        if (direct) applyDamage(direct, pr.dmg, owner);
        for (const p of state.players) {
          if (!p.alive || p.id === pr.owner || p === direct) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) <= pr.splash) applyDamage(p, pr.splashDmg, owner);
        }
        const zoneLife = 5 * tune.duration;
        addZone({
          id: state.nextEntityId++,
          type: 'lava',
          style: 'fire',
          x: pr.x,
          z: pr.z,
          r: 34 * tune.projSize,
          life: zoneLife,
          maxLife: zoneLife,
          dps: 9 * tune.power,
          owner: pr.owner,
        });
        break;
      }
      case 'rock':
        state.fx.push({ k: 'dust', x: r1(pr.x), z: r1(pr.z), r: 26, c: '#c08a4a' });
        if (direct) {
          applyDamage(direct, pr.dmg, owner);
          shove(direct, pr.dx, pr.dz, pr.knock || 20);
        }
        break;
      case 'gust':
        state.fx.push({ k: 'gust', x: r1(pr.x), z: r1(pr.z), dx: pr.dx, dz: pr.dz });
        if (direct) {
          applyDamage(direct, pr.dmg, owner);
          shove(direct, pr.dx, pr.dz, pr.knock || 50);
        }
        break;
      case 'jet':
        state.fx.push({ k: 'splash', x: r1(pr.x), z: r1(pr.z) });
        break;
      case 'fireball': {
        const tune = owner ? adminTune(owner) : ADMIN_DEFAULT;
        state.fx.push({ k: 'boom', x: r1(pr.x), z: r1(pr.z), r: 62, c: '#ff7b34' });
        if (direct) applyDamage(direct, pr.dmg, owner);
        for (const p of state.players) {
          if (!p.alive || p.id === pr.owner || p === direct) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) <= pr.splash) applyDamage(p, pr.splashDmg, owner);
        }
        const zoneLife = 5 * tune.duration;
        addZone({
          id: state.nextEntityId++, type: 'lava', style: 'fire', x: pr.x, z: pr.z,
          r: 34 * tune.projSize, life: zoneLife, maxLife: zoneLife, dps: 9 * tune.power, owner: pr.owner,
        });
        break;
      }
      case 'abyssflame': {
        state.fx.push({ k: 'boom', x: r1(pr.x), z: r1(pr.z), r: 72, c: '#8a2bd6' });
        if (direct) applyDamage(direct, pr.dmg, owner);
        for (const p of state.players) {
          if (!p.alive || p.id === pr.owner || p === direct) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) <= pr.splash) applyDamage(p, pr.splashDmg, owner);
        }
        addZone({
          id: state.nextEntityId++, type: 'lava', style: 'dark', x: pr.x, z: pr.z,
          r: 44, life: 5, maxLife: 5, dps: 10, owner: pr.owner,
        });
        break;
      }
      case 'waterprison': {
        state.fx.push({ k: 'splash', x: r1(pr.x), z: r1(pr.z) });
        const x = direct ? direct.x : pr.x;
        const z = direct ? direct.z : pr.z;
        if (direct) {
          applyDamage(direct, pr.dmg, owner);
          applyRoot(direct, 2.2);
        }
        addZone({
          id: state.nextEntityId++, type: 'prison', style: 'water', x, z, r: 58,
          life: 2.4, maxLife: 2.4, root: 0.4, dps: 2, owner: pr.owner,
        });
        break;
      }
      default:
        if (direct) applyDamage(direct, pr.dmg, owner);
        if (pr.knock && direct) shove(direct, pr.dx, pr.dz, pr.knock);
        state.fx.push({
          k: 'boom',
          x: r1(pr.x),
          z: r1(pr.z),
          r: 34,
          c: colorCss(styleColor(pr.trail || pr.kind)),
        });
        break;
    }
  }

  function updateZones(dt) {
    const s = state;
    for (let i = s.zones.length - 1; i >= 0; i--) {
      const z = s.zones[i];
      z.life -= dt;
      const owner = getPlayer(z.owner);
      // El incendio forestal se extiende solo hasta su radio máximo.
      if (z.grow && z.r < z.maxR) z.r = Math.min(z.maxR, z.r + z.grow * 0.22 * dt);

      if (z.type === 'meteor') {
        z.delay -= dt;
        if (z.delay <= 0) {
          s.fx.push({ k: 'boom', x: r1(z.x), z: r1(z.z), r: 150, c: '#ff5a1f' });
          for (const p of s.players) {
            if (!p.alive || p.id === z.owner) continue;
            if (Math.hypot(p.x - z.x, p.z - z.z) <= z.r) applyDamage(p, z.dmg, owner);
          }
          addZone({
            id: s.nextEntityId++,
            type: 'lava',
            style: 'fire',
            x: z.x,
            z: z.z,
            r: 70,
            life: 7,
            maxLife: 7,
            dps: 11,
            owner: z.owner,
          });
          s.zones.splice(i, 1);
          continue;
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'wave') {
        const move = z.speed * dt;
        z.x += z.dx * move;
        z.z += z.dz * move;
        for (const p of s.players) {
          if (!p.alive || p.id === z.owner || z.hit.has(p.id)) continue;
          const rx = p.x - z.x;
          const rz = p.z - z.z;
          const along = rx * z.dx + rz * z.dz;
          const lateral = Math.abs(-rx * z.dz + rz * z.dx);
          if (Math.abs(along) < 16 && lateral < z.width / 2) {
            z.hit.add(p.id);
            applyDamage(p, z.dmg, owner);
            shove(p, z.dx, z.dz, 55);
            applySlow(p, 0.7, 1.2);
            s.fx.push({ k: 'splash', x: r1(p.x), z: r1(p.z) });
          }
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'tornado') {
        z.x += z.dx * z.speed * dt;
        z.z += z.dz * z.speed * dt;
        z.strikeTimer -= dt;
        for (const p of s.players) {
          if (!p.alive || p.id === z.owner) continue;
          const dx = z.x - p.x;
          const dz = z.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist < z.pull && dist > 1) {
            const pullSpeed = Math.min(140 * dt, dist);
            const res = moveWithCollision(s.world, p.x, p.z, (dx / dist) * pullSpeed, (dz / dist) * pullSpeed, PLAYER_RADIUS);
            p.x = res.x;
            p.z = res.z;
          }
          if (dist < z.r) {
            applyDamage(p, z.dps * dt, owner, { silent: true });
            applySlow(p, 0.8, 0.4);
          }
        }
        if (z.strikeTimer <= 0) {
          z.strikeTimer = 0.35 + Math.random() * 0.4;
          s.fx.push({ k: 'swirl', x: r1(z.x), z: r1(z.z), style: z.style });
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'wall') {
        for (const p of s.players) {
          if (!p.alive || p.id === z.owner) continue;
          const rx = p.x - z.x;
          const rz = p.z - z.z;
          const along = rx * z.dx + rz * z.dz;
          const lateral = Math.abs(-rx * z.dz + rz * z.dx);
          if (Math.abs(along) < 12 + PLAYER_RADIUS && lateral < z.width / 2) {
            applyDamage(p, z.dps * dt, owner, { silent: true });
            applySlow(p, 0.85, 0.4);
          }
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'spikes') {
        z.delay -= dt;
        if (z.delay <= 0 && !z.struck) {
          z.struck = true;
          s.fx.push({ k: 'spikes', x: r1(z.x), z: r1(z.z), r: z.r, style: z.style, c: colorCss(styleColor(z.style)) });
          areaDamage(owner || { id: 0 }, z.x, z.z, z.r, z.dmg, 1, {
            slow: z.slowFactor ? { factor: z.slowFactor, duration: z.slowDuration } : null,
            root: z.root || 0,
          });
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'geyser') {
        z.delay -= dt;
        if (z.delay <= 0) {
          z.strikeTimer -= dt;
          if (z.strikeTimer <= 0) {
            z.strikeTimer = z.interval || 0.9;
            s.fx.push({ k: 'geyser', x: r1(z.x), z: r1(z.z), r: z.r, style: z.style, c: colorCss(styleColor(z.style)) });
            for (const target of s.players) {
              if (!target.alive || target.id === z.owner) continue;
              if (Math.hypot(target.x - z.x, target.z - z.z) > z.r) continue;
              applyDamage(target, z.dmg, owner);
              applySlow(target, 0.82, 0.5);
              const angle = Math.atan2(target.z - z.z, target.x - z.x);
              shove(target, Math.cos(angle), Math.sin(angle), 26);
            }
          }
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'plasma') {
        z.delay -= dt;
        if (z.delay <= 0 && !z.struck) {
          z.struck = true;
          s.fx.push({ k: 'boom', x: r1(z.x), z: r1(z.z), r: z.r * 1.4, c: colorCss(styleColor('plasma')) });
          areaDamage(owner || { id: 0 }, z.x, z.z, z.r * 1.4, z.dmg, 1, { slow: { factor: 0.7, duration: 1.2 } });
          chainBolt(owner || { id: 0 }, z.x, z.z, z.chain || 3, 210, z.dmg * 0.5, 1);
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'summon') {
        z.strikeTimer -= dt;
        let target = z.targetId ? getPlayer(z.targetId) : null;
        if (!target || !target.alive) {
          let best = null;
          let bestDist = 820;
          for (const other of s.players) {
            if (!other.alive || other.id === z.owner) continue;
            const d = Math.hypot(other.x - z.x, other.z - z.z);
            if (d < bestDist) {
              bestDist = d;
              best = other;
            }
          }
          target = best;
          z.targetId = best ? best.id : 0;
        }
        if (target) {
          const dx = target.x - z.x;
          const dz = target.z - z.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > 34) {
            const step = Math.min(z.speed * dt, d - 28);
            const res = moveWithCollision(s.world, z.x, z.z, (dx / d) * step, (dz / d) * step, 8);
            z.x = res.x;
            z.z = res.z;
          } else if (z.strikeTimer <= 0 && z.dps > 0) {
            z.strikeTimer = 0.65;
            applyDamage(target, z.dps, owner);
            applySlow(target, 0.8, 0.5);
            s.fx.push({ k: 'summonHit', x: r1(target.x), z: r1(target.z), style: z.style, mob: z.mob });
          }
        }
        if (z.mob === 'clone') {
          for (const other of s.players) {
            if (!other.alive || other.id === z.owner) continue;
            if (Math.hypot(other.x - z.x, other.z - z.z) <= z.r) applySlow(other, z.slow || 0.75, 0.4);
          }
        }
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      if (z.type === 'tree') {
        if (z.life <= 0) s.zones.splice(i, 1);
        continue;
      }

      // Zonas de área (lava, barro, vapor, tormenta, arena, campos…).
      for (const p of s.players) {
        if (!p.alive || p.id === z.owner) continue;
        if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) continue;
        if (z.dps) applyDamage(p, z.dps * dt, owner, { silent: true });
        if (z.slowFactor) applySlow(p, z.slowFactor, 0.35);
        if (z.root) applyRoot(p, Math.max(0.4, z.root));
      }
      if (z.type === 'storm' || z.type === 'sandstorm' || z.type === 'steam') {
        z.strikeTimer = (z.strikeTimer || 0) - dt;
        if (z.strikeTimer <= 0) {
          z.strikeTimer = z.type === 'storm' ? 0.65 : 0.5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * z.r;
          s.fx.push({ k: 'swirl', x: r1(z.x + Math.cos(a) * r), z: r1(z.z + Math.sin(a) * r), style: z.style });
        }
      }
      if (z.life <= 0) s.zones.splice(i, 1);
    }
  }

  function getPlayer(id) {
    return state.players.find((p) => p.id === id) || null;
  }

  // ---------------------------------------------------------------- red

  function broadcastSnapshot() {
    if (state.phase !== 'match' && state.phase !== 'ending') return;
    const s = state;
    const snap = {
      t: 'snap',
      time: r1(s.matchTime),
      storm: stormPublic(),
      alive: s.players.filter((p) => p.alive).length,
      players: s.players.map((p) => ({
        i: p.id,
        x: r1(p.x),
        z: r1(p.z),
        yaw: r2(p.yaw),
        hp: Math.max(0, Math.round(p.hp)),
        sh: Math.round(p.shield),
        al: p.alive ? 1 : 0,
        k: p.kills,
        sl: p.slots.map((slot) => (slot ? { e: slot.element, r: slot.rarity } : null)),
        act: p.active,
        cd: p.slots.map((slot) => (slot ? p.cds[slot.element].map((v) => r1(v)) : null)),
        cc: r1(p.comboCd),
        mn: Math.round(p.mana),
        st: Math.round(p.stamina),
        j: r2(p.jumpY),
        sw: p.swimming ? 1 : 0,
        sf: p.slowUntil > s.matchTime ? r2(p.slowFactor) : 0,
        rt: p.rootUntil > s.matchTime ? 1 : 0,
        place: p.place,
      })),
      projs: s.projectiles.map((pr) => ({
        id: pr.id,
        k: pr.kind,
        x: r1(pr.x),
        z: r1(pr.z),
        dx: r2(pr.dx),
        dz: r2(pr.dz),
        d: r1(pr.delay || 0),
        o: pr.owner,
      })),
      zones: s.zones.map((z) => ({
        id: z.id,
        t: z.type,
        s: z.style || 'fire',
        x: r1(z.x),
        z: r1(z.z),
        life: r1(z.life),
        max: r1(z.maxLife || 1),
        r: r1(z.r || 0),
        dx: r2(z.dx || 0),
        dz: r2(z.dz || 0),
        w: r1(z.width || 0),
        d: r1(z.delay || 0),
        mob: z.mob || null,
        o: z.owner,
      })),
      fx: s.fx,
    };

    const json = JSON.stringify(snap);
    for (const client of joinedClients()) {
      if (client.player && client.ws.readyState === 1) {
        try {
          client.ws.send(json);
        } catch {
          /* ignorar */
        }
      }
    }
    s.fx = [];
  }

  // ---------------------------------------------------------------- bucle

  let last = Date.now();
  const loop = setInterval(() => {
    const now = Date.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.12) dt = 0.12;
    if (dt <= 0) return;

    if (state.phase === 'lobby') {
      updateLobby(dt);
    } else if (state.phase === 'match') {
      simulate(dt);
    } else if (state.phase === 'ending') {
      state.endTimer -= dt;
      if (state.endTimer <= 0) toLobby();
    }
  }, 1000 / TICK_RATE);

  wss.on('close', () => clearInterval(loop));

  return { close: () => clearInterval(loop) };
}
