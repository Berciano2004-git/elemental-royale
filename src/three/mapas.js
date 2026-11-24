// Carga en el navegador un mapa horneado: meta.json + terreno.bin.
// Se cachea por id: en una misma sesión, todas las partidas del mismo mapa
// reutilizan los bytes ya descargados.

import { createBakedWorld } from '../../shared/mapabaked.js';

const cache = new Map();

export async function cargarMapa(id) {
  const cached = cache.get(id);
  if (cached) return cached;

  const metaUrl = new URL(`maps/${id}/meta.json`, document.baseURI).href;
  const binUrl = new URL(`maps/${id}/terreno.bin`, document.baseURI).href;

  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error(`No se pudo cargar el mapa «${id}» (${metaRes.status})`);
  const meta = await metaRes.json();

  const binRes = await fetch(binUrl);
  if (!binRes.ok) throw new Error(`No se pudo cargar el terreno de «${id}» (${binRes.status})`);
  const bin = await binRes.arrayBuffer();

  const cells = Number(meta.cells);
  const count = cells * cells;
  if (bin.byteLength !== count * 3) {
    throw new Error(`El terreno de «${id}» mide ${bin.byteLength} B y deberían ser ${count * 3} B`);
  }

  const heights = new Int16Array(bin.slice(0, count * 2));
  const biomes = new Uint8Array(bin.slice(count * 2));
  const world = createBakedWorld(meta, heights, biomes);
  cache.set(id, world);
  return world;
}
