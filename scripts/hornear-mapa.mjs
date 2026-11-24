#!/usr/bin/env node
// Hornea un mapa jugable: rejilla de alturas, biomas, colisiones, puntos de
// aparición y minimapa. El servidor y el cliente leen después esos archivos, no
// el modelo original.
//
// Uso:
//   node scripts/hornear-mapa.mjs                        # mapa sintético de 8 x 8 km
//   node scripts/hornear-mapa.mjs --tamano=8000 --celdas=512 --salida=assets/maps/test-8km
//   node scripts/hornear-mapa.mjs --fuente=alturas.png --tamano=8000 --salida=assets/maps/mi-mapa
//
// La fuente `alturas.png` es un mapa de altura en escala de grises (negro = la
// cota mínima, blanco = la máxima). La fuente `sintetico` genera una isla de
// prueba determinista con montañas, río, lago, torres y muros.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args[key] = rest.length ? rest.join('=') : 'true';
}

const fuente = args.fuente || 'sintetico';
const size = Number(args.tamano || 8000);
const cells = Number(args.celdas || 512);
const salida = path.resolve(root, args.salida || 'assets/maps/test-8km');
const id = path.basename(salida);
const precision = 10; // alturas en decímetros: -3276,8 m a 3276,7 m

// --- ruido determinista -----------------------------------------------------

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
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// --- mapa sintético de prueba ----------------------------------------------

function sintetico() {
  const seed = 20261124;
  const half = size / 2;
  const cell = size / cells;
  const heights = new Float32Array(cells * cells);
  const moisture = new Float32Array(cells * cells);

  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const x = -half + (ix + 0.5) * cell;
      const z = -half + (iz + 0.5) * cell;
      const r = Math.hypot(x, z) / half;
      const coast = 1 - smoothstep(0.56, 0.98, r);

      const base = fbm(x * 0.00042 + 11, z * 0.00042 + 11, seed, 4);
      let h = (12 + (base - 0.38) * 150) * coast - 42 * (1 - coast);

      // Cordillera en el noreste.
      const ridgeRaw = fbm(x * 0.0007 + 300, z * 0.0007 + 300, seed + 17, 3);
      const ridge = 1 - Math.abs(ridgeRaw * 2 - 1);
      const rangeMask =
        smoothstep(0.42, 0.75, fbm(x * 0.0005 + 700, z * 0.0005 + 700, seed + 51, 2)) *
        coast *
        smoothstep(-0.15, 0.4, (x * 0.8 - z * 0.6) / size + 0.35);
      h += Math.pow(ridge, 2) * 280 * rangeMask;

      // Lago en el suroeste.
      const dl = Math.hypot(x + 1500, z - 1300);
      h -= 62 * Math.exp(-(dl * dl) / (430 * 430)) * coast;

      // Río que cruza la isla de norte a sur.
      const riverX = 200 + 800 * Math.sin(z * 0.00105 + 0.4);
      const dr = Math.abs(x - riverX);
      const carve = Math.exp(-(dr * dr) / (150 * 150));
      h -= 48 * carve * coast;

      // Meseta rocosa al sureste, para tener desnivel sin ser montaña.
      const mesa = smoothstep(0.75, 0.95, 1 - Math.hypot(x - 1700, z + 1500) / 900);
      h += 85 * mesa * coast;

      heights[iz * cells + ix] = clamp(h, -48, 340);

      const m =
        fbm(x * 0.00085 + 900, z * 0.00085 + 900, seed + 7, 3) * 0.8 + carve * 0.3 + mesa * 0.1;
      moisture[iz * cells + ix] = clamp(m, 0, 1);
    }
  }

  return { heights, moisture };
}

// --- fuente: mapa de altura en PNG -----------------------------------------

async function desdePng(archivo) {
  const minH = Number(args['altura-min'] ?? -40);
  const maxH = Number(args['altura-max'] ?? 340);
  const { data } = await sharp(archivo)
    .greyscale()
    .resize(cells, cells, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const heights = new Float32Array(cells * cells);
  const moisture = new Float32Array(cells * cells);
  const half = size / 2;
  const cell = size / cells;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const v = data[iz * cells + ix] / 255;
      heights[iz * cells + ix] = minH + (maxH - minH) * v;
      const x = -half + (ix + 0.5) * cell;
      const z = -half + (iz + 0.5) * cell;
      moisture[iz * cells + ix] = fbm(x * 0.0009 + 40, z * 0.0009 + 40, 991, 3);
    }
  }
  return { heights, moisture };
}

// --- biomas -----------------------------------------------------------------

function biomaDe(h, m) {
  if (h < 0.6) return 0; // water
  if (h < 4) return 1; // beach
  if (h > 250) return 7; // snow
  if (h > 170) return 6; // mountain
  if (h > 100) return 5; // highland
  if (m < 0.4) return 2; // desert
  if (m > 0.58) return 3 + 1; // forest
  return 3; // grass
}

const MINIMAP_COLORS = [
  [26, 66, 92],
  [220, 203, 148],
  [216, 176, 110],
  [103, 159, 73],
  [61, 122, 56],
  [139, 135, 104],
  [122, 117, 107],
  [232, 238, 240],
];

// --- colisiones y apariciones ----------------------------------------------

function pendiente(heights, ix, iz) {
  const cell = size / cells;
  const h = (a, b) => heights[clamp(b, 0, cells - 1) * cells + clamp(a, 0, cells - 1)];
  const gx = h(ix + 1, iz) - h(ix - 1, iz);
  const gz = h(ix, iz + 1) - h(ix, iz - 1);
  return Math.hypot(gx, gz) / (2 * cell);
}

function alturaEn(heights, x, z) {
  const half = size / 2;
  const cell = size / cells;
  const ix = clamp(Math.floor((x + half) / cell), 0, cells - 1);
  const iz = clamp(Math.floor((z + half) / cell), 0, cells - 1);
  return heights[iz * cells + ix];
}

function haySitio(heights, colisiones, x, z, radio) {
  if (Math.abs(x) > size / 2 - 120 || Math.abs(z) > size / 2 - 120) return false;
  const h = alturaEn(heights, x, z);
  if (h < 6) return false;
  const cell = size / cells;
  const ix = clamp(Math.floor((x + size / 2) / cell), 0, cells - 1);
  const iz = clamp(Math.floor((z + size / 2) / cell), 0, cells - 1);
  if (pendiente(heights, ix, iz) > 0.4) return false;
  for (const c of colisiones) {
    const r = c.t === 'cyl' ? c.r : Math.hypot(c.hx, c.hz);
    if (Math.hypot(c.x - x, c.z - z) < r + radio) return false;
  }
  return true;
}

function construirEstructuras(heights) {
  const colisiones = [];
  const anillo = size * 0.28;
  let intentos = 0;
  while (colisiones.length < 18 && intentos < 900) {
    intentos++;
    const ang = intentos * 2.39996; // espiral áurea: reparte sin amontonar
    const dist = anillo + (intentos % 7) * (size * 0.05);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (!haySitio(heights, colisiones, x, z, 70)) continue;
    const tipo = colisiones.length % 3;
    if (tipo === 0) {
      colisiones.push({ t: 'cyl', x, z, r: 7, h: 26, tipo: 'torre' });
    } else if (tipo === 1) {
      colisiones.push({ t: 'box', x, z, hx: 30, hz: 4, rot: ang * 0.5, h: 9, tipo: 'muro' });
    } else {
      colisiones.push({ t: 'box', x, z, hx: 12, hz: 12, rot: 0, h: 15, tipo: 'torreón' });
    }
  }
  return colisiones;
}

function construirApariciones(heights, colisiones) {
  const puntos = [];
  const total = 48;
  const radio = size * 0.4;
  for (let i = 0; i < total; i++) {
    const ang = (i / total) * Math.PI * 2;
    let colocado = false;
    for (let intento = 0; intento < 24 && !colocado; intento++) {
      const r = radio * (0.82 + intento * 0.02);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (!haySitio(heights, colisiones, x, z, 90)) continue;
      if (puntos.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue;
      puntos.push({ x: Math.round(x), z: Math.round(z) });
      colocado = true;
    }
  }
  // Si el terreno no dio para todos, se completa por dentro con búsqueda suelta.
  let intentos = 0;
  while (puntos.length < total && intentos < 4000) {
    intentos++;
    const x = (Math.random() * 2 - 1) * size * 0.42;
    const z = (Math.random() * 2 - 1) * size * 0.42;
    if (!haySitio(heights, colisiones, x, z, 90)) continue;
    if (puntos.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue;
    puntos.push({ x: Math.round(x), z: Math.round(z) });
  }
  return puntos;
}

// --- escritura --------------------------------------------------------------

async function main() {
  const inicio = Date.now();
  const { heights, moisture } = fuente === 'sintetico' ? sintetico() : await desdePng(path.resolve(root, args.fuente));

  const biomes = new Uint8Array(cells * cells);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    minHeight = Math.min(minHeight, heights[i]);
    maxHeight = Math.max(maxHeight, heights[i]);
    biomes[i] = biomaDe(heights[i], moisture[i]);
  }

  const colisiones = fuente === 'sintetico' ? construirEstructuras(heights) : [];
  const apariciones = construirApariciones(heights, colisiones);

  fs.mkdirSync(salida, { recursive: true });

  // Alturas en decímetros (Int16) y biomas (Uint8), uno detrás de otro.
  const buffer = Buffer.alloc(cells * cells * 3);
  for (let i = 0; i < heights.length; i++) {
    buffer.writeInt16LE(Math.round(clamp(heights[i], -3276, 3276) * precision), i * 2);
  }
  buffer.set(biomes, cells * cells * 2);
  fs.writeFileSync(path.join(salida, 'terreno.bin'), buffer);

  const meta = {
    id,
    name: fuente === 'sintetico' ? 'Mapa de prueba 8 × 8 km' : path.basename(args.fuente),
    fuente,
    size,
    cells,
    cell: Number((size / cells).toFixed(3)),
    precision,
    seaLevel: Number(args['nivel-mar'] ?? 0),
    maxSlope: Number(args.pendiente ?? 0.62),
    minHeight: Number(minHeight.toFixed(1)),
    maxHeight: Number(maxHeight.toFixed(1)),
    apariciones,
    colisiones,
    generado: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(salida, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  // Minimapa: color por bioma y sombreado según la pendiente, luz desde el noroeste.
  const rgba = Buffer.alloc(cells * cells * 4);
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const i = iz * cells + ix;
      const color = MINIMAP_COLORS[biomes[i]] || MINIMAP_COLORS[3];
      const l = heights[clamp(iz, 0, cells - 1) * cells + clamp(ix - 1, 0, cells - 1)];
      const r = heights[clamp(iz, 0, cells - 1) * cells + clamp(ix + 1, 0, cells - 1)];
      const u = heights[clamp(iz - 1, 0, cells - 1) * cells + clamp(ix, 0, cells - 1)];
      const d = heights[clamp(iz + 1, 0, cells - 1) * cells + clamp(ix, 0, cells - 1)];
      const shade = clamp(1 + (l - r + u - d) * 0.02, 0.55, 1.3);
      rgba[i * 4] = clamp(Math.round(color[0] * shade), 0, 255);
      rgba[i * 4 + 1] = clamp(Math.round(color[1] * shade), 0, 255);
      rgba[i * 4 + 2] = clamp(Math.round(color[2] * shade), 0, 255);
      rgba[i * 4 + 3] = 255;
    }
  }
  await sharp(rgba, { raw: { width: cells, height: cells, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(salida, 'minimapa.png'));

  const kb = (f) => Math.round(fs.statSync(path.join(salida, f)).size / 1024);
  console.log(`Mapa horneado en ${path.relative(root, salida)}`);
  console.log(`  Tamaño:      ${size} x ${size} m · ${cells} x ${cells} celdas (${(size / cells).toFixed(1)} m/celda)`);
  console.log(`  Alturas:     ${minHeight.toFixed(1)} a ${maxHeight.toFixed(1)} m`);
  console.log(`  Apariciones: ${apariciones.length}`);
  console.log(`  Colisiones:  ${colisiones.length}`);
  console.log(`  terreno.bin: ${kb('terreno.bin')} KB · minimapa.png: ${kb('minimapa.png')} KB`);
  console.log(`  Tiempo:      ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error('No se pudo hornear el mapa:', error.message);
  process.exitCode = 1;
});
