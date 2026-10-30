// Historial de partidas en un disco Archil.
// Cada partida terminada se guarda como un JSON dentro del disco, de modo que
// los resultados sobreviven a los reinicios del servidor y se pueden consultar
// desde cualquier máquina con la misma clave (`npm run history`).
//
// Necesita ARCHIL_API_KEY; ARCHIL_REGION y ARCHIL_DISK son opcionales.

import * as archil from 'disk';

const HISTORY_KEY = 'historial/partidas.json';
const MAX_ENTRIES = 100;
const DEFAULT_REGION = 'aws-us-east-1';

let opening = null;

export function historyEnabled() {
  return Boolean(process.env.ARCHIL_API_KEY);
}

function diskName() {
  return process.env.ARCHIL_DISK || 'elemental-royale';
}

// Abre (o crea la primera vez) el disco del historial una sola vez por proceso.
export function openHistoryDisk() {
  if (!opening) {
    archil.configure({
      apiKey: process.env.ARCHIL_API_KEY,
      region: process.env.ARCHIL_REGION || DEFAULT_REGION,
    });
    opening = (async () => {
      const existing = await archil.listDisks({ name: diskName() });
      if (existing.length > 0) return existing[0];
      const { disk } = await archil.createDisk({ name: diskName() });
      return disk;
    })().catch((error) => {
      opening = null; // deja reintentar en la siguiente partida
      throw error;
    });
  }
  return opening;
}

export async function readHistory() {
  const disk = await openHistoryDisk();
  if (!(await disk.objectExists(HISTORY_KEY))) return [];
  const text = new TextDecoder().decode(await disk.getObject(HISTORY_KEY));
  try {
    const matches = JSON.parse(text);
    return Array.isArray(matches) ? matches : [];
  } catch {
    console.warn('Historial de Archil ilegible; se empieza uno nuevo.');
    return [];
  }
}

export async function recordMatch(match) {
  const disk = await openHistoryDisk();
  const entry = { at: new Date().toISOString(), ...match };
  const matches = [entry, ...(await readHistory())].slice(0, MAX_ENTRIES);
  await disk.putObject(HISTORY_KEY, JSON.stringify(matches, null, 2), 'application/json');
  return entry;
}

// Variante para el servidor: nunca lanza, porque el final de la partida no
// puede depender de la red ni de Archil.
export async function recordMatchSafely(match) {
  try {
    return await recordMatch(match);
  } catch (error) {
    console.warn(`⚠ No se pudo guardar la partida en Archil: ${error.message}`);
    return null;
  }
}
