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
