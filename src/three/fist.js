// Puño cerrado del mago para el bastón.
//
// La malla del mago trae la mano abierta y un solo hueso para los cuatro dedos,
// así que no se puede cerrar con animación. Este puño se modela aparte, en el
// espacio del bastón (eje Y = asta, -Z = muñeca), y se cuelga del grupo del
// bastón: la palma queda detrás del asta y los dedos la envuelven por delante.
import * as THREE from 'three';

const FINGERS = [
  { y: 0.056, sweep: 2.02, radius: 0.0555, thickness: 0.0158 },
  { y: 0.022, sweep: 2.14, radius: 0.0558, thickness: 0.016 },
  { y: -0.012, sweep: 2.04, radius: 0.0552, thickness: 0.0155 },
  { y: -0.046, sweep: 1.86, radius: 0.0546, thickness: 0.0146 },
];

export function createGripFist({ color = '#e8c9a8' } = {}) {
  const group = new THREE.Group();
  group.name = 'Puno';

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });
  group.userData.material = material;

  const add = (geometry, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  };

  // Dorso de la mano: un bloque facetado que recoge la muñeca y sirve de
  // apoyo a nudillos y dedos. Bajo él queda escondida la mano original.
  add(new THREE.SphereGeometry(1, 9, 6), { x: 0, y: 0.002, z: -0.048, sx: 0.061, sy: 0.074, sz: 0.057 });
  // Muñeca: cierra el puño contra el puño de la manga y tapa la piel que
  // asoma entre el guante original y el borde de la túnica.
  add(new THREE.SphereGeometry(1, 8, 6), { x: 0.002, y: 0.026, z: -0.072, sx: 0.05, sy: 0.054, sz: 0.044 });
  // Base del pulgar, en el canto exterior.
  add(new THREE.SphereGeometry(1, 7, 5), { x: 0.046, y: 0.024, z: -0.03, sx: 0.032, sy: 0.042, sz: 0.036 });

  // Cuatro dedos cerrados: cada uno arranca en el nudillo (detrás del asta) y
  // da casi media vuelta alrededor del asta hasta el frente. Los radios dejan
  // el asta dentro del puño, rozando las yemas.
  for (const finger of FINGERS) {
    const start = -0.06;
    const end = start - finger.sweep;
    const points = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = start + (end - start) * t;
      const radius = finger.radius - 0.006 * t * t;
      points.push(new THREE.Vector3(Math.sin(angle) * radius, finger.y + Math.sin(t * Math.PI) * 0.002, -Math.cos(angle) * radius));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    add(new THREE.TubeGeometry(curve, 10, finger.thickness, 6, false));
    const knuckle = points[0];
    add(new THREE.SphereGeometry(0.0135, 6, 5), { x: knuckle.x, y: finger.y, z: knuckle.z + 0.008 });
    const tip = points[points.length - 1];
    add(new THREE.SphereGeometry(0.0152, 6, 5), { x: tip.x, y: tip.y, z: tip.z });
  }

  // Pulgar cruzado por delante de los dedos, de arriba abajo.
  const thumbCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.054, 0.043, -0.03),
    new THREE.Vector3(0.059, 0.022, 0.002),
    new THREE.Vector3(0.048, 0.0, 0.028),
    new THREE.Vector3(0.028, -0.02, 0.043),
    new THREE.Vector3(0.008, -0.033, 0.046),
  ]);
  add(new THREE.TubeGeometry(thumbCurve, 12, 0.0172, 6, false));
  add(new THREE.SphereGeometry(0.0158, 6, 5), { x: 0.008, y: -0.033, z: 0.046 });

  return group;
}
