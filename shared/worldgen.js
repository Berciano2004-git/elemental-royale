// Generación procedural del mundo, compartida por servidor y cliente.
// Todo es determinista a partir de la semilla para que ambos vean el mismo mapa.

import { HALF_WORLD, WORLD_SIZE } from './constants.js';

export const WATER_LEVEL = 0.4;
// Altura del plano de agua visible. El terreno queda por debajo en mares y lagos.
export const WATER_SURFACE = 0.12;
export const MOUNTAIN_LEVEL = 0.795;
export const BEACH_LEVEL = 0.437;
export const LAND_ELEV = 0.411;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const mix = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function fbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, z, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

export function elevationAt(x, z, seed) {
  const seedInt = seed | 0;
  const nx = x / HALF_WORLD;
  const nz = z / HALF_WORLD;
  const r = Math.sqrt(nx * nx + nz * nz);
  const edge = smoothstep(0.78, 1.06, r);

  const base = fbm(x * 0.00172 + 40, z * 0.00172 + 40, seedInt, 4);
  const ridgeRaw = fbm(x * 0.0031 + 210, z * 0.0031 + 210, seedInt + 17, 3);
  const ridge = 1 - Math.abs(ridgeRaw * 2 - 1);
  const mountainMask = smoothstep(0.5, 0.78, fbm(x * 0.00125 + 500, z * 0.00125 + 500, seedInt + 51, 2));

  let e = base * 0.55 + ridge * 0.35 * mountainMask + 0.215;
  e -= edge * 0.6;
  return e;
}

export function moistureAt(x, z, seed) {
  const m = fbm(x * 0.00205 + 900, z * 0.00205 + 900, (seed | 0) + 91, 3);
  return clamp((m - 0.5) * 1.45 + 0.5, 0, 1);
}

export function heightAt(x, z, seed) {
  const e = elevationAt(x, z, seed);
  if (e < WATER_LEVEL) return (e - WATER_LEVEL) * 150;
  let h = (e - WATER_LEVEL) * 118;
  // Pequeñas ondulaciones del terreno.
  h += (fbm(x * 0.018, z * 0.018, (seed | 0) + 303, 2) - 0.5) * 2.2;
  return h;
}

export function biomeAt(x, z, seed) {
  const e = elevationAt(x, z, seed);
  const m = moistureAt(x, z, seed);
  if (e < WATER_LEVEL) return 'water';
  if (e > MOUNTAIN_LEVEL) return e > 0.93 ? 'snow' : 'mountain';
  if (e < BEACH_LEVEL) return 'beach';
  if (e > 0.735) return 'highland';
  if (m < 0.43) return 'desert';
  if (m > 0.53) return 'forest';
  return 'grass';
}

export function sampleAt(x, z, seed) {
  return {
    x,
    z,
    elev: elevationAt(x, z, seed),
    height: heightAt(x, z, seed),
    biome: biomeAt(x, z, seed),
    moisture: moistureAt(x, z, seed),
  };
}

// Muestreo optimizado (una sola evaluación de ruido por campo) para mallas.
export function terrainSample(x, z, seed) {
  const elev = elevationAt(x, z, seed);
  const moisture = moistureAt(x, z, seed);
  let height;
  if (elev < WATER_LEVEL) height = (elev - WATER_LEVEL) * 150;
  else height = (elev - WATER_LEVEL) * 118 + (fbm(x * 0.018, z * 0.018, (seed | 0) + 303, 2) - 0.5) * 2.2;
  let biome;
  if (elev < WATER_LEVEL) biome = 'water';
  else if (elev > MOUNTAIN_LEVEL) biome = elev > 0.93 ? 'snow' : 'mountain';
  else if (elev < BEACH_LEVEL) biome = 'beach';
  else if (elev > 0.735) biome = 'highland';
  else if (moisture < 0.43) biome = 'desert';
  else if (moisture > 0.53) biome = 'forest';
  else biome = 'grass';
  return { elev, moisture, height, biome };
}

export function isWalkable(x, z, seed) {
  if (x < -HALF_WORLD + 8 || x > HALF_WORLD - 8 || z < -HALF_WORLD + 8 || z > HALF_WORLD - 8) return false;
  const e = elevationAt(x, z, seed);
  return e > LAND_ELEV && e < MOUNTAIN_LEVEL;
}

// --- Objetos decorativos con colisión ---------------------------------------

const PROP_CELL = 24;

function makeProp(type, x, z, seed, scale, collide, weight) {
  return {
    type,
    x,
    z,
    y: heightAt(x, z, seed),
    s: scale,
    rot: hash2(Math.round(x * 3), Math.round(z * 3), (seed | 0) + 77) * Math.PI * 2,
    r: collide,
  };
}

export function generateProps(seed) {
  const props = [];
  const seedInt = seed | 0;
  const cells = Math.ceil(WORLD_SIZE / PROP_CELL);

  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const j1 = hash2(gx, gz, seedInt + 301);
      const j2 = hash2(gx, gz, seedInt + 302);
      const pick = hash2(gx, gz, seedInt + 303);
      const x = -HALF_WORLD + (gx + 0.18 + j1 * 0.64) * PROP_CELL;
      const z = -HALF_WORLD + (gz + 0.18 + j2 * 0.64) * PROP_CELL;
      const e = elevationAt(x, z, seedInt);
      if (e < BEACH_LEVEL + 0.006 || e > MOUNTAIN_LEVEL) continue;
      const m = moistureAt(x, z, seedInt);
      if (e < WATER_LEVEL + 0.02) continue;

      let type = null;
      let scale = 1;
      let collide = 0;

      if (e > 0.74) {
        if (pick < 0.22) {
          type = 'rock';
          scale = 0.9 + j1 * 1.4;
          collide = scale * 1.1;
        } else if (pick < 0.28 && e < 0.79) {
          type = 'pine';
          scale = 0.75 + j2 * 0.4;
          collide = scale * 0.7;
        }
      } else if (e < BEACH_LEVEL + 0.045) {
        if (pick < 0.1) {
          type = 'palm';
          scale = 0.9 + j2 * 0.35;
          collide = scale * 0.62;
        }
      } else if (m < 0.435) {
        if (pick < 0.11) {
          type = 'cactus';
          scale = 0.8 + j2 * 0.6;
          collide = scale * 0.55;
        } else if (pick < 0.14) {
          type = 'rock';
          scale = 0.5 + j1 * 0.6;
          collide = scale * 0.9;
        }
      } else if (m > 0.53) {
        if (pick < 0.62) {
          type = j2 > 0.62 ? 'pine' : 'tree';
          scale = 0.85 + j1 * 0.45;
          collide = scale * 0.72;
        } else if (pick < 0.66) {
          type = 'bush';
          scale = 0.7 + j2 * 0.5;
          collide = 0;
        }
      } else {
        if (pick < 0.13) {
          type = j2 > 0.5 ? 'pine' : 'tree';
          scale = 0.8 + j1 * 0.45;
          collide = scale * 0.7;
        } else if (pick < 0.2) {
          type = 'bush';
          scale = 0.65 + j2 * 0.5;
          collide = 0;
        } else if (pick < 0.215) {
          type = 'rock';
          scale = 0.6 + j1 * 0.7;
          collide = scale * 0.95;
        }
      }

      if (type) props.push(makeProp(type, x, z, seedInt, scale, collide, pick));
    }
  }
  return props;
}

// --- Lugares especiales -----------------------------------------------------

function landmarkProp(type, x, z, seed, scale, collide, rot = 0) {
  return { type, x, z, y: heightAt(x, z, seed), s: scale, rot, r: collide };
}

function findSpot(seed, types, minR, maxR, existing) {
  const rng = mulberry32((seed ^ 0x51ed270b ^ (existing.length * 2654435761)) >>> 0);
  for (let i = 0; i < 400; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = minR + rng() * (maxR - minR);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (!isWalkable(x, z, seed)) continue;
    if (!types.includes(biomeAt(x, z, seed))) continue;
    if (existing.some((l) => Math.hypot(l.x - x, l.z - z) < 230)) continue;
    return { x, z };
  }
  return null;
}

export function generateLandmarks(seed) {
  const landmarks = [];
  const props = [];
  const seedInt = seed | 0;

  const arena = findSpot(seedInt, ['grass', 'forest', 'beach'], 0, 150, landmarks);
  if (arena) {
    landmarks.push({
      type: 'arena',
      name: 'Arena Antigua',
      x: arena.x,
      z: arena.z,
      y: heightAt(arena.x, arena.z, seedInt),
      clearR: 60,
    });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      props.push(
        landmarkProp('pillar', arena.x + Math.cos(a) * 42, arena.z + Math.sin(a) * 42, seedInt, 1.2, 1.8, a)
      );
    }
    props.push(landmarkProp('brazier', arena.x, arena.z, seedInt, 1.3, 1.4, 0));
  }

  const tower = findSpot(seedInt, ['grass', 'forest'], 250, 800, landmarks);
  if (tower) {
    landmarks.push({
      type: 'tower',
      name: 'Torre Arcana',
      x: tower.x,
      z: tower.z,
      y: heightAt(tower.x, tower.z, seedInt),
      clearR: 26,
    });
    props.push(landmarkProp('tower', tower.x, tower.z, seedInt, 1.15, 7.5, hash2(1, 2, seedInt) * 6));
  }

  const village = findSpot(seedInt, ['grass', 'forest'], 320, 950, landmarks);
  if (village) {
    landmarks.push({
      type: 'village',
      name: 'Aldea Olvidada',
      x: village.x,
      z: village.z,
      y: heightAt(village.x, village.z, seedInt),
      clearR: 34,
    });
    const baseAng = hash2(3, 4, seedInt) * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const a = baseAng + (i / 3) * Math.PI * 2;
      props.push(
        landmarkProp('hut', village.x + Math.cos(a) * 15, village.z + Math.sin(a) * 15, seedInt, 1, 4.2, -a)
      );
    }
    props.push(landmarkProp('brazier', village.x, village.z, seedInt, 1, 1.2, 0));
  }

  const ruins = findSpot(seedInt, ['desert', 'highland'], 280, 1000, landmarks);
  if (ruins) {
    landmarks.push({
      type: 'ruins',
      name: 'Ruinas del Sol',
      x: ruins.x,
      z: ruins.z,
      y: heightAt(ruins.x, ruins.z, seedInt),
      clearR: 32,
    });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const d = 12 + (i % 2) * 6;
      props.push(
        landmarkProp('pillar', ruins.x + Math.cos(a) * d, ruins.z + Math.sin(a) * d, seedInt, 0.8 + (i % 2) * 0.5, 1.5, a)
      );
    }
    props.push(landmarkProp('brazier', ruins.x, ruins.z, seedInt, 1, 1.2, 0));
  }

  const volcano = findSpot(seedInt, ['highland', 'desert'], 300, 1000, landmarks);
  if (volcano) {
    landmarks.push({
      type: 'volcano',
      name: 'Volcán Dormido',
      x: volcano.x,
      z: volcano.z,
      y: heightAt(volcano.x, volcano.z, seedInt),
      clearR: 48,
    });
    props.push(landmarkProp('volcano', volcano.x, volcano.z, seedInt, 1.25, 17, 0));
  }

  const sanctuary = findSpot(seedInt, ['forest', 'grass'], 300, 950, landmarks);
  if (sanctuary) {
    landmarks.push({
      type: 'sanctuary',
      name: 'Santuario Verde',
      x: sanctuary.x,
      z: sanctuary.z,
      y: heightAt(sanctuary.x, sanctuary.z, seedInt),
      clearR: 24,
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      props.push(
        landmarkProp('stone', sanctuary.x + Math.cos(a) * 9, sanctuary.z + Math.sin(a) * 9, seedInt, 1.1, 1.5, a)
      );
    }
    props.push(landmarkProp('brazier', sanctuary.x, sanctuary.z, seedInt, 0.9, 1.2, 0));
  }

  return { landmarks, props };
}

const BUCKET = 40;

function buildPropGrid(props) {
  const map = new Map();
  for (const p of props) {
    if (!p.r) continue;
    const bx = Math.floor(p.x / BUCKET);
    const bz = Math.floor(p.z / BUCKET);
    const key = bx + ',' + bz;
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(p);
  }
  return map;
}

export function createWorld(seed) {
  const special = generateLandmarks(seed);
  const landmarks = special.landmarks;
  const baseProps = generateProps(seed).filter(
    (p) => !landmarks.some((l) => Math.hypot(p.x - l.x, p.z - l.z) < l.clearR && p.r > 0)
  );
  const props = baseProps.concat(special.props);
  const grid = buildPropGrid(props);

  function terrainBlocked(x, z) {
    if (x < -HALF_WORLD + 10 || x > HALF_WORLD - 10 || z < -HALF_WORLD + 10 || z > HALF_WORLD - 10) return true;
    const e = elevationAt(x, z, seed);
    return e < LAND_ELEV || e > MOUNTAIN_LEVEL;
  }

  function propBlocked(x, z, radius) {
    const minBx = Math.floor((x - radius - 4) / BUCKET);
    const maxBx = Math.floor((x + radius + 4) / BUCKET);
    const minBz = Math.floor((z - radius - 4) / BUCKET);
    const maxBz = Math.floor((z + radius + 4) / BUCKET);
    for (let bx = minBx; bx <= maxBx; bx++) {
      for (let bz = minBz; bz <= maxBz; bz++) {
        const list = grid.get(bx + ',' + bz);
        if (!list) continue;
        for (const p of list) {
          const dx = x - p.x;
          const dz = z - p.z;
          const rr = radius + p.r;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  }

  function canStand(x, z, radius = 2) {
    if (terrainBlocked(x, z)) return false;
    const r = radius * 0.72;
    if (terrainBlocked(x + r, z) || terrainBlocked(x - r, z) || terrainBlocked(x, z + r) || terrainBlocked(x, z - r)) {
      return false;
    }
    return !propBlocked(x, z, radius);
  }

  function inBounds(x, z, pad = 10) {
    return x > -HALF_WORLD + pad && x < HALF_WORLD - pad && z > -HALF_WORLD + pad && z < HALF_WORLD - pad;
  }

  function depthAt(x, z) {
    return WATER_SURFACE - heightAt(x, z, seed);
  }

  // Nadar: el cuerpo entero dentro del agua y sin troncos ni rocas delante.
  // El radio de muestra es el mismo que usa el movimiento, de modo que la
  // transición orilla-agua no deja huecos por los que colarse.
  function canSwim(x, z, radius = 2) {
    if (!inBounds(x, z)) return false;
    const r = radius * 0.72;
    if (depthAt(x, z) < 0.14) return false;
    if (
      depthAt(x + r, z) < 0.14 ||
      depthAt(x - r, z) < 0.14 ||
      depthAt(x, z + r) < 0.14 ||
      depthAt(x, z - r) < 0.14
    ) {
      return false;
    }
    return !propBlocked(x, z, radius);
  }

  // Vado: arena mojada y agua baja. Es el puente entre caminar y nadar, para
  // que la orilla no sea un muro invisible.
  function canWade(x, z, radius = 2) {
    if (!inBounds(x, z)) return false;
    const r = radius * 0.72;
    const wadeable = (d) => d > -1.7 && d < 1.5;
    if (!wadeable(depthAt(x, z))) return false;
    if (
      !wadeable(depthAt(x + r, z)) ||
      !wadeable(depthAt(x - r, z)) ||
      !wadeable(depthAt(x, z + r)) ||
      !wadeable(depthAt(x, z - r))
    ) {
      return false;
    }
    return !propBlocked(x, z, radius);
  }

  return {
    seed,
    props,
    landmarks,
    waterSurface: WATER_SURFACE,
    heightAt: (x, z) => heightAt(x, z, seed),
    depthAt,
    isWater: (x, z) => depthAt(x, z) > 0.02,
    sampleAt: (x, z) => sampleAt(x, z, seed),
    biomeAt: (x, z) => biomeAt(x, z, seed),
    isWalkable: (x, z) => isWalkable(x, z, seed),
    canStand,
    canSwim,
    canWade,
    propBlocked,
    terrainBlocked,
  };
}

// Busca un punto caminable cerca de (x, z) usando una espiral determinista.
export function findOpenSpot(world, x, z, rand, minRadius = 4) {
  for (let i = 0; i < 90; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = minRadius + rand() * (i * 2 + 12);
    const px = clamp(x + Math.cos(ang) * dist, -HALF_WORLD + 40, HALF_WORLD - 40);
    const pz = clamp(z + Math.sin(ang) * dist, -HALF_WORLD + 40, HALF_WORLD - 40);
    if (world.canStand(px, pz, 3.2)) return { x: px, z: pz };
  }
  return { x, z };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
