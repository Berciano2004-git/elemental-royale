// Servidor autoritativo de Elemental Royale.
// Simula el mundo a 30 Hz y envía instantáneas a 20 Hz.

import {
  ELEMENT_KEYS,
  ELEMENTS,
  HATS,
  LOBBY_TIME,
  MATCH_PLAYERS,
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
import { updateBots } from './bots.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const colorCss = (c) => '#' + c.toString(16).padStart(6, '0');
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Ajustes de administrador por jugador. Los límites son deliberadamente
// generosos (es una herramienta de desarrollo), pero nunca dejan entrar NaN
// ni valores que puedan romper la simulación.
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
        const firstJoin = !client.joined;
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
        if (firstJoin) {
          client.ws.send(JSON.stringify({ t: 'lobby', ...lobbySummary() }));
        }
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
        send(client.ws, { t: 'adminTeleport', ok: true, x: r1(p.x), z: r1(p.z) });
        break;
      }
      case 'cast': {
        const p = client.player;
        if (!p) return;
        const slot = msg.slot === 1 ? 1 : 0;
        const ability = msg.ability === 1 ? 1 : 0;
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

  function lobbySummary() {
    return {
      t: 'lobby',
      players: joinedClients().map((c) => ({ id: c.id, name: c.name, look: c.look })),
      bots: Math.max(0, MATCH_PLAYERS - joinedClients().length),
      countdown: state.phase === 'lobby' ? Math.max(0, Math.ceil(state.lobbyTimer)) : 0,
      inProgress: state.phase !== 'lobby',
      phase: state.phase,
      hostId: hostClient()?.id || 0,
      capacity: MATCH_PLAYERS,
    };
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
        think: Math.random() * 0.3,
        goal: null,
        mode: 'loot',
        targetId: 0,
        strafe: Math.random() < 0.5 ? 1 : -1,
        stuck: 0,
        lastX: bot.x,
        lastZ: bot.z,
        castCd: Math.random() * 0.8,
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
      cds: {
        fire: [0, 0],
        water: [0, 0],
        wind: [0, 0],
        earth: [0, 0],
      },
      comboCd: 0,
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
        spawnPickup('power', ELEMENT_KEYS[(Math.random() * 4) | 0], rarity, x, z);
      }
    }

    // Un poder y un cristal de vida junto a cada punto de aparición.
    for (const spawn of spawns) {
      const near = findOpenSpot(world, spawn.x + (Math.random() - 0.5) * 40, spawn.z + (Math.random() - 0.5) * 40, Math.random, 6);
      spawnPickup('power', ELEMENT_KEYS[(Math.random() * 4) | 0], rollRarity(), near.x, near.z);
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
      p.hp = Math.min(MAX_HP, p.hp + 28);
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

  function castAbility(p, slotIdx, abilityIdx, ax, az) {
    if (state.phase !== 'match' || !p || !p.alive) return false;
    if (slotIdx !== 0 && slotIdx !== 1) return false;
    if (abilityIdx !== 0 && abilityIdx !== 1) return false;
    const tune = adminTune(p);
    const slot = p.slots[slotIdx];
    if (!slot) return false;
    const element = slot.element;
    const meta = ELEMENTS[element]?.abilities[abilityIdx];
    if (!meta) return false;
    if (p.cds[element][abilityIdx] > 0) return false;
    const manaCost = meta.mana * tune.manaCost;
    if (p.mana < manaCost) return false;

    p.mana -= manaCost;
    p.cds[element][abilityIdx] = meta.cd * tune.cooldown;
    p.active = slotIdx;

    const aim = aimFrom(p, ax, az, meta.range * tune.range);
    p.yaw = Math.atan2(aim.x - p.x, aim.z - p.z);
    p.aimX = aim.x;
    p.aimZ = aim.z;

    const mult = rarityPower(slot.rarity) * (hasElement(p, 'fire') ? 1.12 : 1) * tune.power;
    state.fx.push({ k: 'cast', x: p.x, z: p.z, el: element, ab: meta.id, i: p.id, c: colorCss(ELEMENTS[element].color) });

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
          dmg: 17 * mult,
          radius: 2.6 * tune.projSize,
          splash: 60 * tune.projSize,
          splashDmg: 9 * mult,
        });
        break;
      case 'flamewall': {
        const dist = Math.max(80, aim.dist);
        state.zones.push({
          id: state.nextEntityId++,
          type: 'wall',
          style: 'fire',
          x: p.x + aim.dx * dist,
          z: p.z + aim.dz * dist,
          dx: aim.dx,
          dz: aim.dz,
          width: 155 * tune.projSize,
          life: 7 * tune.duration,
          maxLife: 7 * tune.duration,
          dps: 13 * mult,
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
          dmg: 12 * mult,
          radius: 3.2 * tune.projSize,
          pierce: true,
          hit: new Set(),
          slow: { factor: 0.62, duration: 0.8 },
        });
        break;
      case 'tsunami': {
        state.zones.push({
          id: state.nextEntityId++,
          type: 'wave',
          style: 'water',
          x: p.x + aim.dx * 24,
          z: p.z + aim.dz * 24,
          dx: aim.dx,
          dz: aim.dz,
          width: 200 * tune.projSize,
          speed: 230 * tune.projSpeed,
          life: 3 * tune.duration,
          maxLife: 3 * tune.duration,
          dmg: 15 * mult,
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
          dmg: 7 * mult,
          radius: 9 * tune.projSize,
          knock: 60,
        });
        break;
      case 'tornado':
        state.zones.push({
          id: state.nextEntityId++,
          type: 'tornado',
          style: 'wind',
          x: aim.x,
          z: aim.z,
          dx: aim.dx,
          dz: aim.dz,
          r: 95 * tune.projSize,
          pull: 235 * tune.projSpeed,
          speed: 26 * tune.projSpeed,
          life: 6 * tune.duration,
          maxLife: 6 * tune.duration,
          dps: 10 * mult,
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
            dmg: 15 * mult,
            radius: 3.4 * tune.projSize,
            knock: 22,
          });
        }
        break;
      }
      case 'quake': {
        const radius = 175 * tune.projSize;
        state.fx.push({ k: 'quake', x: p.x, z: p.z, r: radius, i: p.id });
        for (const target of state.players) {
          if (!target.alive || target.id === p.id) continue;
          if (Math.hypot(target.x - p.x, target.z - p.z) > radius) continue;
          applyDamage(target, 18 * mult, p);
          applySlow(target, 0.55, 2.2);
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
    const mult = (1 + (hasElement(p, 'fire') ? 0.12 : 0)) * tune.power;

    state.fx.push({ k: 'combo', x: aim.x, z: aim.z, id: combo.id, name: combo.name, i: p.id });

    const zone = (extra) => {
      state.zones.push({
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
        zone({ type: 'meteor', style: 'fire', x: aim.x, z: aim.z, r: 115 * tune.projSize, delay: 0.7, life: 1.2 * tune.duration, dmg: 32 * mult });
        break;
      case 'thunderstorm':
        zone({ type: 'storm', style: 'storm', x: aim.x, z: aim.z, r: 175 * tune.projSize, life: 6 * tune.duration, dps: 9 * mult, slowFactor: 0.75, strikeTimer: 0.4 });
        break;
      case 'mud':
        zone({ type: 'mud', style: 'earth', x: aim.x, z: aim.z, r: 150 * tune.projSize, life: 7 * tune.duration, dps: 4 * mult, slowFactor: 0.5 });
        break;
      case 'firestorm':
        zone({ type: 'tornado', style: 'fire', x: aim.x, z: aim.z, r: 110 * tune.projSize, pull: 250 * tune.projSpeed, speed: 30 * tune.projSpeed, life: 6 * tune.duration, dps: 14 * mult, strikeTimer: 0.3 });
        break;
      case 'steam':
        zone({ type: 'steam', style: 'steam', x: aim.x, z: aim.z, r: 160 * tune.projSize, life: 7 * tune.duration, dps: 2 * mult, slowFactor: 0.6 });
        break;
      case 'sandstorm':
        zone({ type: 'sandstorm', style: 'sand', x: aim.x, z: aim.z, r: 180 * tune.projSize, life: 7 * tune.duration, dps: 7 * mult, slowFactor: 0.6 });
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
    let dmg = amount;
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
      const wantsSprint = p.input.sprint && (Math.abs(p.input.x) + Math.abs(p.input.z) > 0.1) && p.stamina > 2;
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
      let speed = tune.walkSpeed;
      if (hasElement(p, 'wind')) speed *= 1.1;
      if (p.slowUntil > s.matchTime) speed *= p.slowFactor;
      if (p.input.sprint && p.stamina > 2) speed *= tune.runMult;
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
        for (const p of s.players) {
          if (!p.alive || p.id === pr.owner) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) <= pr.radius + adminTune(p).radius) {
            if (pr.pierce) {
              if (!pr.hit.has(p.id)) {
                pr.hit.add(p.id);
                applyDamage(p, pr.dmg, getPlayer(pr.owner));
                if (pr.slow) applySlow(p, pr.slow.factor, pr.slow.duration);
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
        state.zones.push({
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
      default:
        break;
    }
  }

  function updateZones(dt) {
    const s = state;
    for (let i = s.zones.length - 1; i >= 0; i--) {
      const z = s.zones[i];
      z.life -= dt;
      const owner = getPlayer(z.owner);

      if (z.type === 'meteor') {
        z.delay -= dt;
        if (z.delay <= 0) {
          s.fx.push({ k: 'boom', x: r1(z.x), z: r1(z.z), r: 150, c: '#ff5a1f' });
          for (const p of s.players) {
            if (!p.alive || p.id === z.owner) continue;
            if (Math.hypot(p.x - z.x, p.z - z.z) <= z.r) applyDamage(p, z.dmg, owner);
          }
          s.zones.push({
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

      // Zonas de área (lava, barro, vapor, tormenta, arena).
      for (const p of s.players) {
        if (!p.alive || p.id === z.owner) continue;
        if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) continue;
        if (z.dps) applyDamage(p, z.dps * dt, owner, { silent: true });
        if (z.slowFactor) applySlow(p, z.slowFactor, 0.35);
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
        sf: p.slowUntil > s.matchTime ? 1 : 0,
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
