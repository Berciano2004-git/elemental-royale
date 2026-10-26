// Resuelve la cinemática del brazo derecho (la izquierda es su espejo) para
// colocar la mano en un objetivo. Uso interno para ajustar poses.
import * as THREE from 'three';

const upper = new THREE.Object3D();
upper.position.set(-0.16, -0.015, -0.03);
const fore = new THREE.Object3D();
fore.position.set(-0.35, -0.015, -0.01);
const hand = new THREE.Object3D();
hand.position.set(-0.26, -0.01, 0);
upper.add(fore);
fore.add(hand);

function sample(uy, uz, fy, fz) {
  upper.rotation.set(0, uy, uz);
  fore.rotation.set(0, fy, fz);
  upper.updateMatrixWorld(true);
  return hand.getWorldPosition(new THREE.Vector3());
}

const range = (from, to, step) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(3));
  return out;
};

function solve(target, { elbow = 1.15, lower = 1.0, maxForward = 0.35 } = {}) {
  let best = null;
  for (const uz of range(0.25, 1.3, 0.05)) {
    for (const uy of range(-0.6, 1.2, 0.1)) {
      for (const fy of range(-1.6, 1.6, 0.1)) {
        for (const fz of range(-1.5, 0.7, 0.1)) {
          const p = sample(uy, uz, fy, fz);
          const d = p.distanceTo(target);
          if (d > 0.16) continue;
          const bend = Math.abs(fy) + Math.abs(fz);
          const forward = Math.max(0, Math.abs(uy) - maxForward) * 2.5;
          const score = d * 3 + Math.abs(bend - elbow) * 0.2 + Math.abs(uz - lower) * 0.25 + forward;
          if (!best || score < best.score) {
            best = { score: +score.toFixed(3), uy, uz, fy, fz, hand: p.toArray().map((v) => +v.toFixed(3)), d: +d.toFixed(3) };
          }
        }
      }
    }
  }
  return best;
}

const cases = [
  ['reposo mano libre', new THREE.Vector3(-0.14, -0.2, 0.32)],
  ['reposo mano baston', new THREE.Vector3(-0.46, -0.45, 0.1)],
  ['hechizo mano libre', new THREE.Vector3(-0.12, -0.02, 0.38)],
  ['hechizo mano baston', new THREE.Vector3(-0.06, -0.02, 0.4)],
  ['carrera mano libre', new THREE.Vector3(-0.12, -0.18, 0.3)],
];

for (const [label, target] of cases) {
  const r = solve(target);
  if (!r) {
    console.log(label, 'sin solución');
    continue;
  }
  console.log(label, JSON.stringify(r));
  console.log('   izquierdo espejado:', JSON.stringify({ uy: -r.uy, uz: -r.uz, fy: -r.fy, fz: -r.fz }));
}
