// Mundo a partir de un mapa horneado: rejilla de alturas, biomas y colisiones.
// Sustituye a createWorld(seed) cuando la partida corre en un mapa importado.
// Servidor y cliente cargan los mismos bytes, así que ven lo mismo y colisionan
// contra lo mismo; el servidor sigue siendo el único que decide el movimiento.

export const BIOME_NAMES = ['water', 'beach', 'desert', 'grass', 'forest', 'highland', 'mountain', 'snow'];

// Humedad aproximada por bioma: el render la usa para mezclar los dos tonos.
const BIOME_MOISTURE = [0.5, 0.55, 0.22, 0.5, 0.74, 0.44, 0.4, 0.4];

export function createBakedWorld(meta, heights, biomes) {
  const size = meta.size;
  const halfSize = size / 2;
  const cells = meta.cells;
  const cell = size / cells;
  const precision = meta.precision || 10;
  const seaLevel = meta.seaLevel ?? 0;
  const maxSlope = meta.maxSlope ?? 0.62;
  const colliders = meta.colisiones || [];
  const spawns = meta.apariciones || [];

  function rawHeight(ix, iz) {
    const x = ix < 0 ? 0 : ix >= cells ? cells - 1 : ix;
    const z = iz < 0 ? 0 : iz >= cells ? cells - 1 : iz;
    return heights[z * cells + x] / precision;
  }

  // Interpolación bilineal: con celdas de 10-16 m el terreno se ve suave y el
  // mago no nota escalones al caminar.
  function heightAt(x, z) {
    const fx = (x + halfSize) / cell - 0.5;
    const fz = (z + halfSize) / cell - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = rawHeight(ix, iz);
    const h10 = rawHeight(ix + 1, iz);
    const h01 = rawHeight(ix, iz + 1);
    const h11 = rawHeight(ix + 1, iz + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  function biomeIndexAt(x, z) {
    const ix = Math.max(0, Math.min(cells - 1, Math.round((x + halfSize) / cell - 0.5)));
    const iz = Math.max(0, Math.min(cells - 1, Math.round((z + halfSize) / cell - 0.5)));
    return biomes[iz * cells + ix] || 0;
  }

  function biomeAt(x, z) {
    return BIOME_NAMES[biomeIndexAt(x, z)] || 'grass';
  }

  function sampleAt(x, z) {
    const height = heightAt(x, z);
    const index = biomeIndexAt(x, z);
    return {
      x,
      z,
      elev: height,
      height,
      biome: BIOME_NAMES[index] || 'grass',
      moisture: BIOME_MOISTURE[index] ?? 0.5,
    };
  }

  function depthAt(x, z) {
    return seaLevel - heightAt(x, z);
  }

  function isWater(x, z) {
    return depthAt(x, z) > 0.02;
  }

  // Pendiente en metros por metro. Se mide en un radio corto para no bloquear
  // laderas suaves por una piedra suelta.
  function slopeAt(x, z) {
    const d = 4;
    const gx = heightAt(x + d, z) - heightAt(x - d, z);
    const gz = heightAt(x, z + d) - heightAt(x, z - d);
    return Math.hypot(gx, gz) / (2 * d);
  }

  function inBounds(x, z, pad = 10) {
    return x > -halfSize + pad && x < halfSize - pad && z > -halfSize + pad && z < halfSize - pad;
  }

  function colliderBlocked(x, z, radius = 2) {
    for (const c of colliders) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.t === 'cyl') {
        const rr = (c.r || 4) + radius * 0.6;
        if (dx * dx + dz * dz < rr * rr) return true;
        continue;
      }
      // Caja girada: se pasa el punto al espacio local del muro.
      const cos = Math.cos(-(c.rot || 0));
      const sin = Math.sin(-(c.rot || 0));
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const hx = (c.hx || 4) + radius * 0.6;
      const hz = (c.hz || 4) + radius * 0.6;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) return true;
    }
    return false;
  }

  function terrainBlocked(x, z) {
    if (!inBounds(x, z)) return true;
    const h = heightAt(x, z);
    if (h < seaLevel + 0.5) return true;
    return slopeAt(x, z) > maxSlope;
  }

  function canStand(x, z, radius = 2) {
    if (terrainBlocked(x, z)) return false;
    const r = radius * 0.55;
    if (
      terrainBlocked(x + r, z) ||
      terrainBlocked(x - r, z) ||
      terrainBlocked(x, z + r) ||
      terrainBlocked(x, z - r)
    ) {
      return false;
    }
    return !colliderBlocked(x, z, radius);
  }

  function canSwim(x, z, radius = 2) {
    if (!inBounds(x, z)) return false;
    const r = radius * 0.55;
    if (depthAt(x, z) < 0.14) return false;
    if (
      depthAt(x + r, z) < 0.14 ||
      depthAt(x - r, z) < 0.14 ||
      depthAt(x, z + r) < 0.14 ||
      depthAt(x, z - r) < 0.14
    ) {
      return false;
    }
    return !colliderBlocked(x, z, radius);
  }

  function canWade(x, z, radius = 2) {
    if (!inBounds(x, z)) return false;
    const r = radius * 0.55;
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
    return !colliderBlocked(x, z, radius);
  }

  return {
    baked: true,
    mapId: meta.id || null,
    name: meta.name || meta.id || 'Mapa',
    size,
    halfSize,
    waterSurface: seaLevel,
    seaLevel,
    props: [],
    landmarks: [],
    structures: colliders,
    spawns,
    heightAt,
    sampleAt,
    biomeAt,
    depthAt,
    isWater,
    slopeAt,
    canStand,
    canSwim,
    canWade,
    colliderBlocked,
    terrainBlocked,
    inBounds,
  };
}
