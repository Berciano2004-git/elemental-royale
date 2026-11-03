// Movimiento con deslizamiento contra terrain y props. Idéntico en cliente y servidor.

export function normalizeInput(mx, mz) {
  const len = Math.hypot(mx, mz);
  if (len < 0.001) return { mx: 0, mz: 0 };
  if (len > 1) return { mx: mx / len, mz: mz / len };
  return { mx, mz };
}

// Un punto es pisable si se puede andar, vadear la orilla o nadar. El nado
// comparte el mismo deslizamiento, así que bordear una isla a braza no cambia
// el tacto del control.
export function canTraverse(world, x, z, radius) {
  if (world.canStand(x, z, radius)) return true;
  if (world.canSwim && world.canSwim(x, z, radius)) return true;
  if (world.canWade && world.canWade(x, z, radius)) return true;
  return false;
}

export function moveWithCollision(world, x, z, dx, dz, radius) {
  const nx = x + dx;
  const nz = z + dz;
  if (dx === 0 && dz === 0) return { x, z };
  if (canTraverse(world, nx, nz, radius)) return { x: nx, z: nz };
  if (dx !== 0 && canTraverse(world, x + dx, z, radius)) return { x: x + dx, z };
  if (dz !== 0 && canTraverse(world, x, z + dz, radius)) return { x, z: z + dz };
  // Deslizar por el obstáculo: si el paso recto y los dos ejes fallan, se
  // prueban giros cortos hacia los lados. Sin esto el mago se quedaba clavado
  // contra troncos, rocas y esquinas y había que rodear a mano.
  const len = Math.hypot(dx, dz);
  if (len > 0.0001) {
    const ux = dx / len;
    const uz = dz / len;
    for (const angle of [0.45, -0.45, 0.9, -0.9]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = (ux * cos - uz * sin) * len;
      const rz = (ux * sin + uz * cos) * len;
      if (canTraverse(world, x + rx, z + rz, radius)) return { x: x + rx, z: z + rz };
    }
    // Pared larga (costa, risco, ladera): casi en paralelo y con paso corto, el
    // mago resbala a lo largo en vez de quedarse parado empujando de frente.
    for (const angle of [1.35, -1.35]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const slide = len * 0.6;
      const rx = (ux * cos - uz * sin) * slide;
      const rz = (ux * sin + uz * cos) * slide;
      if (canTraverse(world, x + rx, z + rz, radius)) return { x: x + rx, z: z + rz };
    }
  }
  return { x, z };
}

export function clampAimToRange(x, z, ax, az, range) {
  let dx = ax - x;
  let dz = az - z;
  const dist = Math.hypot(dx, dz) || 1;
  if (dist > range) {
    dx = (dx / dist) * range;
    dz = (dz / dist) * range;
  }
  return { x: x + dx, z: z + dz, dx: dx / (Math.hypot(dx, dz) || 1), dz: dz / (Math.hypot(dx, dz) || 1) };
}
