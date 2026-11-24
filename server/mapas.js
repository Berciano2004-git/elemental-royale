// Carga de mapas horneados en el servidor. Los archivos viven en
// assets/maps/<id>/ y se leen una sola vez por proceso: cada sala comparte el
// mismo mundo, que es inmutable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBakedWorld } from '../shared/mapabaked.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();

export function mapDir(id, base = root) {
  return path.join(base, 'assets', 'maps', id);
}

export function loadBakedMap(id, base = root) {
  if (!id) throw new Error('Falta el identificador del mapa');
  const cached = cache.get(id);
  if (cached) return cached;

  const dir = mapDir(id, base);
  const metaPath = path.join(dir, 'meta.json');
  const binPath = path.join(dir, 'terreno.bin');
  if (!fs.existsSync(metaPath) || !fs.existsSync(binPath)) {
    throw new Error(`No existe el mapa «${id}»: horneálo con npm run mapa:hornear`);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const cells = Number(meta.cells);
  const buffer = fs.readFileSync(binPath);
  const expected = cells * cells * 3;
  if (buffer.length !== expected) {
    throw new Error(`terreno.bin de «${id}» mide ${buffer.length} B y deberían ser ${expected} B`);
  }

  // Copia alineada: Int16Array exige un offset par y el Buffer no lo garantiza.
  const heightBytes = buffer.subarray(0, cells * cells * 2);
  const heights = new Int16Array(heightBytes.buffer.slice(heightBytes.byteOffset, heightBytes.byteOffset + heightBytes.length));
  const biomes = new Uint8Array(buffer.subarray(cells * cells * 2));

  const world = createBakedWorld(meta, heights, biomes);
  cache.set(id, world);
  return world;
}

export function listMaps(base = root) {
  const dir = path.join(base, 'assets', 'maps');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'meta.json')))
    .map((entry) => entry.name);
}
