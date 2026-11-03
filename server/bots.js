// IA de los magos controlados por el servidor.

import { ELEMENTS, RARITIES } from '../shared/constants.js';
import { canTraverse } from '../shared/movement.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Sondas de la IA: el mago ocupa un círculo y no puede atravesar troncos,
// rocas ni paredes. Se mira medio paso y un paso entero por delante para
// reaccionar antes de chocar, no después.
const PROBE_RADIUS = 3.2;
// Se muestrea a lo largo del recorrido: mirar solo el final dejaba pasar
// rumbos que atravesaban un tronco por el medio.
const PROBE_STEPS = [8, 16, 26];

// Ritmo de la IA. Los bots siguen usando los mismos hechizos y la misma
// simulación que el jugador; lo que cambia es su tiempo de reacción, la espera
// entre lanzamientos y la precisión con la que anticipan el movimiento.
const BOT_THINK_MIN = 0.42;
const BOT_THINK_MAX = 0.76;
const BOT_CAST_CD_MIN = 2.1;
const BOT_CAST_CD_MAX = 3.4;
const BOT_COMBO_CHANCE = 0.06;
const BOT_AIM_LEAD = 0.18;
const BOT_AIM_JITTER = 58;

function rotated(ux, uz, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { mx: ux * cos - uz * sin, mz: ux * sin + uz * cos };
}

function pathClear(world, x, z, ux, uz) {
  for (const distance of PROBE_STEPS) {
    if (!canTraverse(world, x + ux * distance, z + uz * distance, PROBE_RADIUS)) return false;
  }
  return true;
}

function clearHeading(world, x, z, ux, uz, sign, angles) {
  for (const angle of angles) {
    const heading = rotated(ux, uz, angle * sign);
    if (pathClear(world, x, z, heading.mx, heading.mz)) return { ...heading, angle };
  }
  return null;
}

// Ataque local: si el rumbo deseado está tapado, gira lo justo hacia el lado
// más despejado y mantiene ese lado medio segundo para no oscilar. Sin esto
// los bots caminaban de frente contra el primer árbol y solo se soltaban con
// un rodeo aleatorio cuando ya llevaban medio segundo parados.
export function steerAround(world, x, z, mx, mz, memory, time) {
  const len = Math.hypot(mx, mz);
  if (len < 0.001) return { mx: 0, mz: 0 };
  if (!memory) memory = {};
  const ux = mx / len;
  const uz = mz / len;
  if (pathClear(world, x, z, ux, uz)) {
    memory.sign = 0;
    memory.until = 0;
    return { mx: ux, mz: uz };
  }
  if (memory.sign && memory.until > time) {
    const side = clearHeading(world, x, z, ux, uz, memory.sign, [0.35, 0.7, 1.05, 1.4]);
    if (side) return { mx: side.mx, mz: side.mz };
  }
  const right = clearHeading(world, x, z, ux, uz, 1, [0.55, 1.05, 1.5]);
  const left = clearHeading(world, x, z, ux, uz, -1, [0.55, 1.05, 1.5]);
  const pick = !right ? left : !left ? right : right.angle <= left.angle ? right : left;
  if (pick) {
    memory.sign = pick === right ? 1 : -1;
    memory.lastSign = memory.sign;
    memory.until = time + 0.6;
    return { mx: pick.mx, mz: pick.mz };
  }
  // Sin salida: empuja de lado para que el deslizamiento del movimiento
  // resuelva la esquina en lugar de quedarse clavado de frente.
  const sign = memory.sign || memory.lastSign || 1;
  memory.sign = sign;
  memory.lastSign = sign;
  memory.until = time + 0.4;
  const slide = rotated(ux, uz, 1.2 * sign);
  return { mx: slide.mx, mz: slide.mz };
}

function hasPower(bot) {
  return bot.slots.some((s) => s);
}

function elementReady(bot, element, index) {
  const cd = bot.cds[element];
  return cd && cd[index] <= 0;
}

function pickupValue(bot, pickup) {
  if (pickup.kind === 'heal') {
    return bot.hp < 55 ? 120 : bot.hp < 80 ? 35 : -100;
  }
  const rarity = RARITIES[pickup.rarity] || RARITIES.common;
  const empty = bot.slots.some((s) => !s);
  const current = bot.slots.filter(Boolean).map((s) => (RARITIES[s.rarity] || RARITIES.common).power);
  const weakest = current.length ? Math.min(...current) : 0;
  let value = 10 + rarity.power * 40 + (empty ? 90 : 0);
  if (!empty && rarity.power <= weakest + 0.05) value -= 55;
  if (pickup.blockedFor === bot.id) value -= 200;
  return value;
}

function nearestPickup(game, bot, maxDist) {
  let best = null;
  let bestScore = -Infinity;
  for (const pickup of game.pickups) {
    const d = Math.hypot(pickup.x - bot.x, pickup.z - bot.z);
    if (d > maxDist) continue;
    if (pickup.blockedFor === bot.id && game.matchTime < pickup.blockedUntil) continue;
    const value = pickupValue(bot, pickup) - d * 0.12;
    if (value > bestScore) {
      bestScore = value;
      best = pickup;
    }
  }
  return best;
}

function nearestEnemy(game, bot, maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (const other of game.players) {
    if (!other.alive || other.id === bot.id) continue;
    const d = Math.hypot(other.x - bot.x, other.z - bot.z);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

function safeSpot(game, bot) {
  const storm = game.storm;
  if (!storm) return { x: 0, z: 0 };
  const target = storm.next || { x: storm.cx, z: storm.cz, r: storm.r };
  const offsetAngle = (bot.id * 2.399) % (Math.PI * 2);
  const spread = Math.min(target.r * 0.55, 260);
  const x = target.x + Math.cos(offsetAngle) * spread * 0.55;
  const z = target.z + Math.sin(offsetAngle) * spread * 0.55;
  if (game.world.canStand(x, z, 3)) return { x, z };
  return { x: target.x, z: target.z };
}

function outsideSafe(game, bot) {
  const storm = game.storm;
  if (!storm) return false;
  const target = storm.next || { x: storm.cx, z: storm.cz, r: storm.r };
  return Math.hypot(bot.x - target.x, bot.z - target.z) > target.r - 90;
}

function chooseGoal(game, bot) {
  const ai = bot.ai;
  const targetId = ai.targetId;
  ai.targetId = 0;

  if (outsideSafe(game, bot)) {
    ai.mode = 'safe';
    ai.goal = safeSpot(game, bot);
    return;
  }

  const healing = nearestPickup(game, bot, 480);
  if (healing && healing.kind === 'heal' && bot.hp < 55) {
    ai.mode = 'heal';
    ai.goal = { x: healing.x, z: healing.z };
    return;
  }

  const enemy = nearestEnemy(game, bot, hasPower(bot) ? 480 : 320);
  const loot = nearestPickup(game, bot, 820);
  const armed = bot.slots.filter(Boolean).length;

  // Los primeros segundos importan más para saquear que para cazar.
  if (loot && loot.kind === 'power' && (armed === 0 || (armed < 2 && game.matchTime < 55))) {
    if (!enemy || Math.hypot(enemy.x - bot.x, enemy.z - bot.z) > 240 || armed === 0) {
      ai.mode = 'loot';
      ai.goal = { x: loot.x, z: loot.z };
      ai.targetId = 0;
      return;
    }
  }

  if (enemy && hasPower(bot) && bot.hp < 32) {
    ai.mode = 'flee';
    const away = Math.atan2(bot.z - enemy.z, bot.x - enemy.x);
    const spot = safeSpot(game, bot);
    const fleeX = bot.x + Math.cos(away) * 180 + (spot.x - bot.x) * 0.35;
    const fleeZ = bot.z + Math.sin(away) * 180 + (spot.z - bot.z) * 0.35;
    ai.goal = game.world.canStand(fleeX, fleeZ, 3) ? { x: fleeX, z: fleeZ } : spot;
    ai.targetId = 0;
    return;
  }

  if (enemy && hasPower(bot)) {
    ai.mode = 'fight';
    ai.targetId = enemy.id;
    ai.goal = { x: enemy.x, z: enemy.z };
    return;
  }

  if (!hasPower(bot) && loot && loot.kind === 'power') {
    ai.mode = 'loot';
    ai.goal = { x: loot.x, z: loot.z };
    ai.targetId = 0;
    return;
  }

  if (loot && (loot.kind === 'heal' ? bot.hp < 85 : true) && pickupValue(bot, loot) > 0) {
    ai.mode = 'loot';
    ai.goal = { x: loot.x, z: loot.z };
    return;
  }

  const spot = safeSpot(game, bot);
  const angle = Math.random() * Math.PI * 2;
  const radius = 60 + Math.random() * 260;
  const wx = spot.x + Math.cos(angle) * radius;
  const wz = spot.z + Math.sin(angle) * radius;
  ai.mode = 'wander';
  ai.goal = game.world.canStand(wx, wz, 3) ? { x: wx, z: wz } : spot;
  void targetId;
}

function predictedAim(bot, target, jitter) {
  return {
    x: target.x + (target.velX || 0) * BOT_AIM_LEAD + (Math.random() - 0.5) * jitter,
    z: target.z + (target.velZ || 0) * BOT_AIM_LEAD + (Math.random() - 0.5) * jitter,
  };
}

function tryCast(game, bot, target) {
  const ai = bot.ai;
  if (ai.castCd > 0) return;
  if (!target || !target.alive) return;
  const distance = dist(bot, target);
  if (distance > 600) return;

  const options = [];
  for (let slot = 0; slot < 2; slot++) {
    const power = bot.slots[slot];
    if (!power) continue;
    const meta = ELEMENTS[power.element];
    if (!meta) continue;
    for (let index = 0; index < meta.abilities.length; index++) {
      const ability = meta.abilities[index];
      // Los bots no usan los desplazamientos ni los saltos mágicos: se
      // teleportarían lejos del combate y dejarían de leer la situación.
      if (ability.fx && (ability.fx.kind === 'dash' || ability.fx.kind === 'leap')) continue;
      if (!elementReady(bot, power.element, index)) continue;
      if (bot.mana < ability.mana) continue;
      if (ability.range > 0 && distance > ability.range * 0.92) continue;
      if (ability.range === 0 && distance > 200) continue;
      options.push({ slot, ability, index, element: power.element });
    }
  }
  if (options.length === 0) return;

  // Prefiere el hechizo secundario a corta distancia y el primario a larga.
  options.sort((a, b) => {
    const aScore = (a.ability.range === 0 ? 20 : 0) + (a.index === 1 ? 6 : 0) + Math.random() * 10;
    const bScore = (b.ability.range === 0 ? 20 : 0) + (b.index === 1 ? 6 : 0) + Math.random() * 10;
    const aRange = a.ability.range || 180;
    const bRange = b.ability.range || 180;
    if (distance < 220) {
      if (a.index !== b.index) return b.index - a.index;
      return bScore - aScore;
    }
    return aRange > bRange ? -1 : 1;
  });

  const choice = options[0];
  const jitter = BOT_AIM_JITTER + distance * 0.16;
  const aim = predictedAim(bot, target, jitter);
  ai.castCd = BOT_CAST_CD_MIN + Math.random() * (BOT_CAST_CD_MAX - BOT_CAST_CD_MIN);
  game.castAbility(bot, choice.slot, choice.index, aim.x, aim.z);

  const hasBoth = bot.slots[0] && bot.slots[1];
  if (hasBoth && bot.comboCd <= 0 && bot.mana >= 35 && Math.random() < BOT_COMBO_CHANCE) {
    const comboAim = predictedAim(bot, target, 55);
    game.castCombo(bot, comboAim.x, comboAim.z);
  }
}

export function updateBots(game, dt) {
  for (const bot of game.players) {
    if (!bot.bot || !bot.alive) continue;
    const ai = bot.ai;
    if (!ai) continue;

    ai.think -= dt;
    ai.castCd -= dt;
    ai.clock = (ai.clock || 0) + dt;
    if (!ai.steer) ai.steer = { sign: 0, until: 0, lastSign: 1 };
    ai.stuckTimer = (ai.stuckTimer || 0) + dt;

    if (ai.think <= 0) {
      ai.think = BOT_THINK_MIN + Math.random() * (BOT_THINK_MAX - BOT_THINK_MIN);
      chooseGoal(game, bot);
      if (Math.random() < 0.32) ai.strafe *= -1;
    }

    let target = ai.targetId ? game.players.find((p) => p.id === ai.targetId && p.alive) : null;
    if (!target && ai.mode === 'fight') {
      target = nearestEnemy(game, bot, 500);
      ai.targetId = target ? target.id : 0;
    }

    let mx = 0;
    let mz = 0;
    let sprint = false;

    if (target && ai.mode === 'fight') {
      const dx = target.x - bot.x;
      const dz = target.z - bot.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d;
      const nz = dz / d;
      const preferred = 260;
      if (d > preferred + 70) {
        mx += nx;
        mz += nz;
        sprint = d > 380 && bot.stamina > 45;
      } else if (d < preferred - 90) {
        mx -= nx * 0.9;
        mz -= nz * 0.9;
      }
      mx += -nz * ai.strafe * 0.85;
      mz += nx * ai.strafe * 0.85;
      bot.aimX = target.x;
      bot.aimZ = target.z;
      tryCast(game, bot, target);
    } else if (ai.goal) {
      const dx = ai.goal.x - bot.x;
      const dz = ai.goal.z - bot.z;
      const d = Math.hypot(dx, dz);
      if (d > 8) {
        mx = dx / d;
        mz = dz / d;
        bot.aimX = ai.goal.x;
        bot.aimZ = ai.goal.z;
      } else if (ai.mode !== 'fight') {
        ai.think = 0;
      }
      sprint =
        (ai.mode === 'safe' && d > 120) ||
        (ai.mode === 'flee' && d > 60) ||
        (ai.mode === 'loot' && d > 240);
    }

    // Ataque local de obstáculos: gira el rumbo deseado lo justo para no
    // empotrarse contra un tronco o una roca. El servidor sigue decidiendo si
    // el paso es válido; esto solo evita que la IA empuje de frente.
    if ((mx || mz) && game.world) {
      const steered = steerAround(game.world, bot.x, bot.z, mx, mz, ai.steer, ai.clock);
      mx = steered.mx;
      mz = steered.mz;
    }

    // Detección de bloqueos: cambia de lado y recalcula el rumbo sin
    // abandonar el objetivo. Antes un bot en plena huida podía ponerse a
    // vagar y quedarse fuera del círculo seguro.
    if (ai.stuckTimer > 0.7) {
      const moved = Math.hypot(bot.x - ai.lastX, bot.z - ai.lastZ);
      ai.stuckTimer = 0;
      ai.lastX = bot.x;
      ai.lastZ = bot.z;
      if (moved < 3 && (mx || mz)) {
        ai.strafe *= -1;
        if (ai.steer.sign) ai.steer.sign *= -1;
        ai.steer.lastSign = ai.steer.sign || ai.steer.lastSign;
        ai.steer.until = ai.clock + 0.45;
        ai.think = 0;
        if (ai.mode === 'loot' || ai.mode === 'wander') ai.goal = null;
      }
    }

    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      bot.input.x = mx / len;
      bot.input.z = mz / len;
    } else {
      bot.input.x = 0;
      bot.input.z = 0;
    }
    bot.input.sprint = sprint;
  }
}
