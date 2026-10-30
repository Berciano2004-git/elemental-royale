// Consulta el historial de partidas guardado en el disco Archil del proyecto.
//
//   npm run history             últimas partidas guardadas
//   npm run history -- --json   volcado completo en JSON

import { historyEnabled, openHistoryDisk, readHistory } from '../server/history.js';

// Carga .env (y .env.local) si existen, para leer ARCHIL_API_KEY sin exportarla
// a mano en la consola.
for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile?.(file);
  } catch {
    // El fichero no existe: se usan las variables del sistema.
  }
}

if (!historyEnabled()) {
  console.error('Falta ARCHIL_API_KEY. Crea una clave en https://archil.com y guárdala en .env.');
  process.exit(1);
}

try {
  const disk = await openHistoryDisk();
  const history = await readHistory();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(history, null, 2));
  } else {
    console.log(`✦ Disco Archil ${disk.name} (${disk.id}) · ${history.length} partida(s)`);
    for (const match of history.slice(0, 10)) {
      const winner = match.winner ? `${match.winner} (${match.kills || 0} bajas)` : 'sin ganador';
      console.log(`· ${match.at} · ${winner} · ${match.players} magos · ${match.durationS}s · semilla ${match.seed}`);
    }
    if (history.length > 10) console.log(`· … y ${history.length - 10} partidas más`);
  }
} catch (error) {
  console.error(`Archil no respondió: ${error.message}`);
  process.exit(1);
}
