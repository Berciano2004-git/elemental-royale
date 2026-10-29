// Mago del jugador: modelo con esqueleto y animaciones (public/models/mago.glb)
// más los gorros y bastones procedurales, que se cuelgan de sus huesos.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/mago.glb`;
const MODEL_SCALE = 1.62;
const HAT_SCALE = 0.35;
// La cabeza mide 0,36 de radio en las unidades de los gorros. Cada pieza baja
// su escala para apoyar el borde en el cráneo en vez de flotar: las capuchas
// necesitan algo más de holgura por el pelo, los sombreros de copa algo menos.
const HAT_FIT = {
  pointy: 0.8,
  wide: 0.84,
  horns: 0.88,
  leaves: 0.92,
  dark: 0.92,
  crystal: 0.88,
  crown: 0.87,
  viking: 0.88,
  laurel: 0.9,
  top: 0.85,
};
const hatFit = (hat) => HAT_FIT[hat] ?? 0.86;
const STAFF_SCALE = 0.62;
const STAFF_GRIP = 1.32;

// Agarre: la mano del mago nace abierta con los dedos paralelos al asta, así
// que no puede abrazarla. Se rueda la muñeca lo justo para que la pinza quede
// horizontal y se cierran los dedos sobre el bastón; el asta se compensa para
// seguir vertical.
const GRIP_ROLL = 0.52;
const GRIP_CURL = -1.5;
const GRIP_FOLD = 1.15;
const GRIP_AXIS = new THREE.Vector3(1, 0, 0);

const GEO = {
  shaft: new THREE.CylinderGeometry(0.06, 0.075, 2.85, 6),
  smallCyl: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5),
  orb: new THREE.OctahedronGeometry(0.26, 0),
  glow: new THREE.SphereGeometry(0.16, 8, 6),
  shadow: new THREE.CircleGeometry(1.15, 24),
  shard: new THREE.OctahedronGeometry(0.12, 0),
};

// Materiales por región de la malla que se tiñen con la apariencia elegida.
const TINTS = { Tunica: 'robe', Piel: 'skin', Pelo: 'hair' };
// Tono al que se acerca el cuero de los gorros cuando se tiñe.
const LEATHER_TONE = new THREE.Color('#4a3322');

// El atlas de piel del GLB trae sombreado pintado: bajo la mandíbula hay una
// banda grisácea que no responde a la luz y que, al teñir la piel, se lee como
// una mancha sucia entre cara y cuello. Se aplana la iluminación de gran escala
// (difuminado) y se conservan los rasgos finos (ojos, cejas, boca), que siguen
// en la textura. Se hace una sola vez y se comparte entre todos los magos.
let skinMapCache = null;
function cleanSkinTexture(map) {
  if (!map || !map.image || !map.image.width) return map;
  if (skinMapCache && skinMapCache.source === map) return skinMapCache.texture;
  const size = 512;
  const lowSize = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return map;
  context.drawImage(map.image, 0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;

  const low = document.createElement('canvas');
  low.width = lowSize;
  low.height = lowSize;
  const lowContext = low.getContext('2d', { willReadFrequently: true });
  lowContext.imageSmoothingEnabled = true;
  lowContext.drawImage(canvas, 0, 0, lowSize, lowSize);
  const lowData = lowContext.getImageData(0, 0, lowSize, lowSize).data;
  const luma = (i) => (0.2126 * lowData[i] + 0.7152 * lowData[i + 1] + 0.0722 * lowData[i + 2]) / 255;

  // 0.86 deja la piel cerca del color elegido sin llegar a quemarla.
  const target = 0.86;
  for (let y = 0; y < size; y++) {
    const gy = Math.min(lowSize - 1, Math.max(0, ((y + 0.5) / size) * lowSize - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(lowSize - 1, y0 + 1);
    const ty = gy - y0;
    for (let x = 0; x < size; x++) {
      const gx = Math.min(lowSize - 1, Math.max(0, ((x + 0.5) / size) * lowSize - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(lowSize - 1, x0 + 1);
      const tx = gx - x0;
      const a = luma((y0 * lowSize + x0) * 4);
      const b = luma((y0 * lowSize + x1) * 4);
      const c = luma((y1 * lowSize + x0) * 4);
      const d = luma((y1 * lowSize + x1) * 4);
      const soft = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const gain = Math.min(3, Math.max(0.6, target / Math.max(0.04, soft)));
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, data[i] * gain);
      data[i + 1] = Math.min(255, data[i + 1] * gain);
      data[i + 2] = Math.min(255, data[i + 2] * gain);
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = map.flipY;
  texture.colorSpace = map.colorSpace;
  texture.wrapS = map.wrapS;
  texture.wrapT = map.wrapT;
  texture.anisotropy = map.anisotropy;
  texture.needsUpdate = true;
  skinMapCache = { source: map, texture };
  return texture;
}

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.62)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

// --------------------------------------------------------------- gorros
// Los gorros salen de la misma familia de materiales (fieltro teñible, cuero
// oscuro, latón envejecido y pespuntes) para que parezcan piezas del mismo
// taller. La textura es un gris claro con grano: el color del taller la tiñe y
// conserva las fibras y el desgaste.
let hatTexture = null;
function getHatTexture() {
  if (hatTexture) return hatTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#dad5cc';
  ctx.fillRect(0, 0, size, size);
  // Trama diagonal del fieltro: es lo que hace que la tela se lea como tela.
  ctx.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 9) {
    ctx.strokeStyle = i % 18 ? 'rgba(255,255,255,0.12)' : 'rgba(58,48,38,0.1)';
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - size, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.06;
  for (let y = 0; y < size; y += 4) {
    ctx.fillStyle = y % 8 ? '#ffffff' : '#000000';
    ctx.fillRect(0, y, size, 1);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const length = 5 + Math.random() * 13;
    const angle = (Math.random() - 0.5) * 0.6;
    const light = Math.random() < 0.5;
    ctx.lineWidth = 1 + Math.random();
    ctx.strokeStyle = `rgba(${light ? 255 : 40},${light ? 250 : 36},${light ? 240 : 30},${0.05 + Math.random() * 0.07})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 26 + Math.random() * 70;
    const dark = Math.random() < 0.65;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${dark ? 50 : 255},${dark ? 44 : 250},${dark ? 36 : 240},${dark ? 0.1 : 0.06})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  hatTexture = new THREE.CanvasTexture(canvas);
  hatTexture.colorSpace = THREE.SRGBColorSpace;
  hatTexture.wrapS = THREE.RepeatWrapping;
  hatTexture.wrapT = THREE.RepeatWrapping;
  hatTexture.repeat.set(1, 1);
  hatTexture.anisotropy = 4;
  return hatTexture;
}

// Cuero curtido: grano fino, manchas de curtido y grietas cortas. Se tiñe con
// el color del taller igual que el fieltro, así que conserva el tono elegido.
let leatherTexture = null;
function getLeatherTexture() {
  if (leatherTexture) return leatherTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d4cabb';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 2 + Math.random() * 4;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,250,240,0.13)' : 'rgba(36,24,14,0.15)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 30 + Math.random() * 70;
    const dark = Math.random() < 0.6;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${dark ? 42 : 255},${dark ? 30 : 246},${dark ? 18 : 232},${dark ? 0.15 : 0.08})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.strokeStyle = 'rgba(30,20,12,0.2)';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const length = 4 + Math.random() * 11;
    const angle = Math.random() * Math.PI;
    ctx.lineWidth = 0.6 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  leatherTexture = new THREE.CanvasTexture(canvas);
  leatherTexture.colorSpace = THREE.SRGBColorSpace;
  leatherTexture.wrapS = THREE.RepeatWrapping;
  leatherTexture.wrapT = THREE.RepeatWrapping;
  leatherTexture.repeat.set(2, 2);
  leatherTexture.anisotropy = 4;
  return leatherTexture;
}

// Veta de madera: gris claro con fibras verticales. Se multiplica por el color
// elegido, así que el asta conserva el tono del taller y gana grano de cerca.
let woodTexture = null;
function getWoodTexture() {
  if (woodTexture) return woodTexture;
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8dfcf';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * w;
    const y0 = Math.random() * h;
    const length = 26 + Math.random() * 100;
    const drift = (Math.random() - 0.5) * 10;
    const dark = Math.random() < 0.6;
    ctx.strokeStyle = dark
      ? `rgba(92,72,52,${0.05 + Math.random() * 0.15})`
      : `rgba(255,250,240,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + drift, y0 + length * 0.5, x + drift * 0.4, y0 + length);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = 20 + Math.random() * (w - 40);
    const y = 40 + Math.random() * (h - 80);
    ctx.strokeStyle = 'rgba(74,54,36,0.22)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 2.4, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  woodTexture = new THREE.CanvasTexture(canvas);
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.anisotropy = 4;
  return woodTexture;
}

function placed(geometry, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

// Unidad de los gorros: la cabeza mide 0,36 de radio y la coronilla queda 0,19
// por encima de la línea de la frente, que es el origen de cada pieza.

// Cono curvado: la copa de un sombrero de fieltro no es un cono recto, la
// punta cae hacia un lado. Se construye con anillos sobre una curva y radio
// decreciente. `belly` controla lo llena que es la copa (0,7 = abombada).
function bentConeGeometry({ height, radius, tip = 0.04, bendX = 0, bendZ = 0, segments = 12, radial = 24, belly = 0.8 }) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(bendX * 0.12, height * 0.32, bendZ * 0.12),
    new THREE.Vector3(bendX * 0.5, height * 0.64, bendZ * 0.5),
    new THREE.Vector3(bendX, height, bendZ),
  ]);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = curve.getPointAt(t);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const r = Math.max(tip, radius * Math.pow(1 - t, belly) + tip * (1 - t));
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        center.x + (normal.x * cos + binormal.x * sin) * r,
        center.y + (normal.y * cos + binormal.y * sin) * r,
        center.z + (normal.z * cos + binormal.z * sin) * r
      );
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Ala con grosor, caída y ondulación de fieltro. El borde sube ligeramente,
// como el de un sombrero de fieltro gastado.
function brimGeometry({ inner = 0.4, outer = 0.66, droop = 0.06, thickness = 0.03, wave = 0.025, radial = 40, phase = 0.4 }) {
  const middle = inner + (outer - inner) * 0.55;
  const points = [
    new THREE.Vector2(inner, thickness * 0.35),
    new THREE.Vector2(middle, thickness * 0.6),
    new THREE.Vector2(outer, thickness * 0.2 - droop),
    new THREE.Vector2(outer + thickness * 0.55, -droop + thickness * 0.28),
    new THREE.Vector2(outer - thickness * 0.2, -droop - thickness * 0.72),
    new THREE.Vector2(middle, -thickness * 0.85 - droop * 0.35),
    new THREE.Vector2(inner, -thickness * 0.55),
  ];
  const geometry = new THREE.LatheGeometry(points, radial);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    const k = Math.min(1, Math.max(0, (r - inner) / (outer - inner)));
    const angle = Math.atan2(x, z);
    position.setY(i, position.getY(i) + Math.sin(angle * 3 + phase) * wave * k * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Casquete que sigue el cráneo: sirve de base al casco, a la diadema y a los
// gorros. Los pliegues laterales se apagan en el borde para que asiente.
function capShellGeometry({ radius = 0.4, height = 0.26, radial = 30, rings = 10, folds = 0, foldAmp = 0, phase = 0 }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const theta = t * Math.PI * 0.5;
    const y = height * Math.sin(theta);
    for (let j = 0; j <= radial; j++) {
      const phi = (j / radial) * Math.PI * 2;
      const fold = foldAmp * Math.sin(phi * folds + phase) * Math.sin(Math.PI * t);
      const r = (radius + fold) * Math.cos(theta);
      positions.push(Math.sin(phi) * r, y, Math.cos(phi) * r);
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// La abertura de la capucha se cierra en la frente y bajo la barbilla: es una
// elipse, no una ranura vertical. `gapAt` da la anchura de la abertura en cada
// altura de la calota.
function hoodGapAt(t, gap) {
  // La calota cubre la frente hasta la ceja; la abertura empieza ahí y sigue
  // abierta hasta el dobladillo.
  return gap * THREE.MathUtils.smoothstep(t, 0.55, 0.72);
}

// Capucha: calota con abertura facial elíptica y vuelo en la nuca.
function hoodShellGeometry({
  radius = 0.43, height = 0.245, gap = 2, flare = 0.12, radial = 34, rings = 16,
  folds = 0, foldAmp = 0, phase = 0,
}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const thetaMax = Math.PI * 0.78;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const theta = t * thetaMax;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const width = hoodGapAt(t, gap);
    for (let j = 0; j <= radial; j++) {
      const phi = width / 2 + (j / radial) * (Math.PI * 2 - width);
      const fold = foldAmp * Math.sin(phi * folds + phase) * Math.sin(Math.PI * t);
      const r = radius * sinTheta * (1 + Math.max(0, -cosTheta) * flare) + fold;
      positions.push(Math.sin(phi) * r, height * cosTheta, Math.cos(phi) * r);
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Borde inferior de la capucha, para rematarlo con un dobladillo.
function hoodHemPoints({ radius, height, gap, flare = 0, radial = 34 }) {
  const theta = Math.PI * 0.78;
  const width = hoodGapAt(1, gap);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const r = radius * sinTheta * (1 + Math.max(0, -cosTheta) * flare);
  const points = [];
  for (let j = 0; j <= radial; j++) {
    const phi = width / 2 + (j / radial) * (Math.PI * 2 - width);
    points.push(new THREE.Vector3(Math.sin(phi) * r, height * cosTheta, Math.cos(phi) * r));
  }
  return points;
}

// Borde de la abertura facial, para pasarlo por un dobladillo o pespunte.
function hoodRimPoints({ radius, height, gap, rings = 16, side = 1 }) {
  const points = [];
  const thetaMax = Math.PI * 0.78;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const theta = t * thetaMax;
    const width = hoodGapAt(t, gap) / 2;
    const phi = side > 0 ? width : Math.PI * 2 - width;
    points.push(new THREE.Vector3(
      Math.sin(phi) * Math.sin(theta) * radius,
      height * Math.cos(theta),
      Math.cos(phi) * Math.sin(theta) * radius
    ));
  }
  return points;
}

// Banda cónica: carrilleras, guardanuca, ribetes. `length` menor que 2π deja
// libre el rostro.
function bandGeometry({ radiusTop = 0.4, radiusBottom = 0.46, top = 0, bottom = -0.2, start = 0, length = Math.PI * 2, radial = 30, rings = 3, drop = 0 }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = radiusTop + (radiusBottom - radiusTop) * t;
    for (let j = 0; j <= radial; j++) {
      const phi = start + (j / radial) * length;
      // `drop` hunde el borde en la nuca y lo sube hacia la cara.
      const y = top + (bottom - top) * t - drop * t * Math.cos(phi);
      positions.push(Math.sin(phi) * r, y, Math.cos(phi) * r);
      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Arruga radial suave sobre una pieza ya construida: pliegues de paño y
// abolladuras de fieltro sin tocar la silueta.
function addFolds(geometry, { count = 7, amp = 0.012, phase = 0, from = 0, to = 0.3 } = {}) {
  const position = geometry.attributes.position;
  const span = Math.max(0.001, to - from);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    if (y < from || y > to) continue;
    const r = Math.hypot(x, z);
    if (r < 0.02) continue;
    const ramp = Math.sin(Math.PI * Math.min(1, Math.max(0, (y - from) / span)));
    const delta = Math.sin(Math.atan2(x, z) * count + phase) * amp * ramp;
    const k = (r + delta) / r;
    position.setX(i, x * k);
    position.setZ(i, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Sombreado horneado en los vértices: caras que miran al suelo (el interior de
// las alas) más oscuras y un desgaste irregular. Es lo que separa una pieza de
// fieltro de un primitivo liso.
function shadeHatGeometry(geometry, { weather = 0.14, underside = 0.26 } = {}) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ny = normal ? normal.getY(i) : 0.4;
    const hash = Math.sin(x * 41.7 + y * 97.3 + z * 63.1) * 43758.5453;
    const noise = hash - Math.floor(hash) - 0.5;
    let shade = 1 - underside * Math.max(0, -ny);
    shade *= 1 + noise * weather;
    shade *= 0.94 + 0.06 * Math.min(1, Math.max(0, (y + 0.22) / 0.34));
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Hondón de fieltro: empuja una zona de la copa hacia dentro para que la pieza
// parezca moldeada a mano y no torneada.
function dentGeometry(geometry, { x = 0, y = 0.4, z = 0, radius = 0.24, depth = 0.05 } = {}) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const distance = Math.hypot(px - x, py - y, pz - z);
    if (distance > radius) continue;
    const falloff = Math.pow(Math.cos((distance / radius) * Math.PI * 0.5), 2);
    const r = Math.hypot(px, pz);
    if (r < 0.001) continue;
    const k = (r - depth * falloff) / r;
    position.setX(i, px * k);
    position.setZ(i, pz * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function tubeFromPoints(points, radius, radial = 4, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.25);
  return new THREE.TubeGeometry(curve, Math.max(12, points.length * 2), radius, radial, closed);
}

function ringPoints(radius, y, count = 40) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius));
  }
  return points;
}

function stitchRing(list, { radius, y, count, size = 0.018 }) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const stitch = new THREE.BoxGeometry(size * 2.4, size * 0.55, size);
    placed(stitch, { x: Math.sin(angle) * radius, y, z: Math.cos(angle) * radius, ry: angle });
    list.push(stitch);
  }
}

// Pespuntes a lo largo de una costura o un dobladillo, orientados con la curva.
function stitchAlong(list, points, { count = 18, size = 0.011, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.25);
  const spaced = curve.getSpacedPoints(Math.max(2, count));
  const tangent = new THREE.Vector3();
  for (let i = 0; i < spaced.length - 1; i++) {
    const point = spaced[i];
    curve.getTangentAt(i / (spaced.length - 1), tangent);
    const stitch = new THREE.BoxGeometry(size * 2.3, size * 0.5, size);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    stitch.applyQuaternion(quaternion);
    stitch.translate(point.x, point.y, point.z);
    list.push(stitch);
  }
}

let assetPromise = null;
function loadAsset() {
  if (!assetPromise) {
    assetPromise = new GLTFLoader().loadAsync(MODEL_URL).catch((error) => {
      assetPromise = null;
      throw error;
    });
  }
  return assetPromise;
}

const CLIPS = ['idle', 'walk', 'run', 'start', 'stop', 'cast', 'hit', 'death'];
const ONE_SHOT = new Set(['start', 'stop', 'cast', 'hit', 'death']);
const tempQuat = new THREE.Quaternion();
const tempQuatB = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

// Alarga un hueso sobre el eje en el que nace su hijo, sin engordarlo. Las
// piernas y los brazos del rig crecen en ejes distintos (Y y X), así que el
// eje se deduce del propio esqueleto.
function stretchBone(bone, factor) {
  if (!bone) return;
  const child = bone.children.find((c) => c.isBone);
  if (!child) return;
  const d = child.position;
  const ax = Math.abs(d.x) >= Math.abs(d.y) && Math.abs(d.x) >= Math.abs(d.z) ? 'x' : Math.abs(d.y) >= Math.abs(d.z) ? 'y' : 'z';
  bone.scale.set(ax === 'x' ? factor : 1, ax === 'y' ? factor : 1, ax === 'z' ? factor : 1);
}

function percentToHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
}

export function createWizard(look) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const materials = [];

  const hatColor = percentToHex(look.hatColor);
  const hatMat = new THREE.MeshStandardMaterial({
    color: hatColor,
    map: getHatTexture(),
    bumpMap: getHatTexture(),
    bumpScale: 0.06,
    roughness: 0.97,
    metalness: 0,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  // Cuero curtido: se tiñe con el color del taller, así que el tono elegido se
  // nota, pero la pieza se lee como cuero y no como plástico.
  const hatLeatherMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hatColor).lerp(LEATHER_TONE, 0.34),
    map: getLeatherTexture(),
    bumpMap: getLeatherTexture(),
    bumpScale: 0.07,
    roughness: 0.82,
    metalness: 0.03,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  // Cintas y ribetes: el mismo cuero, más oscuro, para que la silueta tenga
  // contraste aunque el gorro sea claro.
  const hatStrapMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hatColor).lerp(LEATHER_TONE, 0.58).multiplyScalar(0.9),
    map: getLeatherTexture(),
    bumpMap: getLeatherTexture(),
    bumpScale: 0.045,
    roughness: 0.78,
    metalness: 0.04,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  // Tela interior que asoma en los bordes: da grosor a las alas.
  const hatLiningMat = new THREE.MeshStandardMaterial({
    color: '#c2b294',
    // Un poco de emisión simula la luz que rebota dentro de la capucha; sin
    // ella el forro se lee como un agujero negro.
    emissive: new THREE.Color('#3d3527'),
    emissiveIntensity: 0.6,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  // Sin mapa de entorno, un metal muy metálico se ve negro: se queda en un
  // latón viejo con algo de difusión.
  const hatMetalMat = new THREE.MeshStandardMaterial({
    color: '#a8874f',
    roughness: 0.5,
    metalness: 0.22,
    flatShading: true,
  });
  const hatStitchMat = new THREE.MeshStandardMaterial({
    color: '#cdb98f',
    roughness: 0.82,
    metalness: 0.02,
    flatShading: true,
  });
  // Pelo de la vuelta del cuero: no se tiñe, es el remate natural de la piel.
  const hatFurMat = new THREE.MeshStandardMaterial({
    color: '#a18a63',
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  // Cuerno del casco vikingo: hueso claro, sin tinte, para que se lea contra el
  // latón y la tela del resto de piezas.
  const hatHornMat = new THREE.MeshStandardMaterial({
    color: '#dccbaa',
    roughness: 0.58,
    metalness: 0.03,
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const staffMat = lambert(look.staffColor);
  const magicMat = lambert(look.magic, { emissive: new THREE.Color(look.magic), emissiveIntensity: 0.4 });
  const darkMat = lambert('#1a1626');
  materials.push(hatMat, hatLeatherMat, hatStrapMat, hatLiningMat, hatMetalMat, hatStitchMat, hatFurMat, hatHornMat, staffMat, magicMat, darkMat);

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const shadow = new THREE.Mesh(GEO.shadow, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  group.add(shadow);

  // ------------------------------------------------------------------ gorro
  const hatGroup = new THREE.Group();
  hatGroup.name = 'Gorro';
  hatGroup.scale.setScalar(HAT_SCALE * hatFit(look.hat));
  const hatPivot = new THREE.Group();
  hatPivot.name = 'GorroPivote';
  // La frente queda a 0,58 del mentón y la coronilla a 0,86: el borde de los
  // gorros apoya en la frente y la copa tiene que subir 0,35 para taparla.
  hatPivot.position.y = 0.205;
  hatPivot.add(hatGroup);

  // Los seis gorros son piezas del mismo taller: fieltro teñible, cuero
  // curtido, ribetes cosidos y herrajes de latón. Cambian la forma, no el
  // lenguaje, y todas envuelven el cráneo en vez de posarse encima.
  const hatFelt = [];
  const hatLeather = [];
  const hatStrap = [];
  const hatLining = [];
  const hatMetal = [];
  const hatStitches = [];
  const hatFur = [];
  const hatHorn = [];
  const addHatPart = (list, geometry, options) => list.push(placed(geometry, options));
  // Cinta de cuero con sus dos ribetes cosidos.
  const addStrapBand = (radius, height, y, tube = 0.007) => {
    addHatPart(hatStrap, new THREE.CylinderGeometry(radius, radius * 1.008, height, 32, 1, true), { y });
    addHatPart(hatStrap, new THREE.TorusGeometry(radius + 0.001, tube, 4, 40), { y: y + height / 2, rx: Math.PI / 2 });
    addHatPart(hatStrap, new THREE.TorusGeometry(radius + 0.001, tube, 4, 40), { y: y - height / 2, rx: Math.PI / 2 });
  };
  const addBuckle = (y, z, width = 0.08) => {
    const height = width * 0.72;
    const bar = 0.013;
    addHatPart(hatMetal, new THREE.BoxGeometry(width, bar, 0.02), { y: y + height / 2, z });
    addHatPart(hatMetal, new THREE.BoxGeometry(width, bar, 0.02), { y: y - height / 2, z });
    addHatPart(hatMetal, new THREE.BoxGeometry(bar, height, 0.02), { x: -width / 2, y, z });
    addHatPart(hatMetal, new THREE.BoxGeometry(bar, height, 0.02), { x: width / 2, y, z });
  };
  // Borde enrollado del ala: le da grosor y remata la silueta.
  const addBrimEdge = (outer, y, tube = 0.016) => {
    addHatPart(hatStrap, new THREE.TorusGeometry(outer, tube, 5, 48), { y, rx: Math.PI / 2 });
  };
  // Pelo de la vuelta del rostro: mechones cónicos repartidos por el borde.
  const addFurAlong = (points, count = 34, length = 0.036, radius = 0.012) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const spaced = curve.getSpacedPoints(count);
    for (let i = 0; i < spaced.length; i++) {
      const point = spaced[i];
      const outward = new THREE.Vector3(point.x, 0.1, point.z).normalize();
      outward.x += (((i * 0.618) % 1) - 0.5) * 0.35;
      outward.z += (((i * 0.37) % 1) - 0.5) * 0.35;
      outward.y += 0.06 + ((i * 0.29) % 1) * 0.16;
      outward.normalize();
      const height = length * (0.7 + ((i * 0.53) % 1) * 0.6);
      const spike = new THREE.ConeGeometry(radius * (0.85 + ((i * 0.41) % 1) * 0.45), height, 5);
      spike.translate(0, height / 2, 0);
      spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward));
      spike.translate(point.x, point.y, point.z);
      hatFur.push(spike);
    }
  };
  // Pespunte del ala siguiendo su ondulación.
  const brimStitches = (inner, outer, radius, y, wave, phase = 0.4, count = 44) => {
    const points = [];
    const k = Math.min(1, Math.max(0, (radius - inner) / (outer - inner)));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.sin(angle) * radius,
        y + Math.sin(angle * 3 + phase) * wave * k * k,
        Math.cos(angle) * radius
      ));
    }
    return points;
  };

  switch (look.hat) {
    case 'wide': {
      // Sombrero de caminante: ala ancha y caída, copa baja con el hundimiento
      // del fieltro y cordón de cuero anudado al lado.
      addHatPart(hatFelt, brimGeometry({ inner: 0.42, outer: 0.685, droop: 0.1, thickness: 0.04, wave: 0.058 }), { y: 0 });
      addBrimEdge(0.69, -0.108, 0.022);
      addHatPart(hatLining, new THREE.TorusGeometry(0.423, 0.01, 4, 40), { y: -0.014, rx: Math.PI / 2 });
      stitchAlong(hatStitches, brimStitches(0.42, 0.685, 0.646, -0.084, 0.048, 0.4, 52), { count: 52, size: 0.008, closed: true });
      const crown = new THREE.LatheGeometry([
        new THREE.Vector2(0.422, 0),
        new THREE.Vector2(0.424, 0.12),
        new THREE.Vector2(0.405, 0.24),
        new THREE.Vector2(0.335, 0.34),
        new THREE.Vector2(0.205, 0.392),
        new THREE.Vector2(0.075, 0.35),
        new THREE.Vector2(0, 0.328),
      ], 36);
      addFolds(crown, { count: 9, amp: 0.012, phase: 0.5, from: 0.03, to: 0.36 });
      dentGeometry(crown, { x: 0, y: 0.33, z: 0.24, radius: 0.2, depth: 0.04 });
      addHatPart(hatFelt, crown, {});
      // Cordón con nudo y dos cabos colgando por delante.
      addHatPart(hatStrap, new THREE.TorusGeometry(0.428, 0.019, 5, 44), { y: 0.078, rx: Math.PI / 2 });
      addHatPart(hatStrap, new THREE.SphereGeometry(0.028, 8, 6), { x: -0.285, y: 0.072, z: 0.315 });
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.011, 0.015, 0.2, 5), { x: -0.315, y: -0.02, z: 0.33, rz: 0.16, rx: 0.1 });
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.009, 0.012, 0.16, 5), { x: -0.245, y: -0.014, z: 0.352, rz: -0.22, rx: 0.12 });
      stitchRing(hatStitches, { radius: 0.425, y: 0.045, count: 30, size: 0.008 });
      break;
    }
    case 'horns': {
      // Casco de cuero hervido: calota de cuatro gajos con costura en relieve,
      // cinta de la frente con remaches y guardanuca con carrilleras. Sin
      // cuernos: es una pieza de armería, no un disfraz.
      addHatPart(hatLeather, new THREE.LatheGeometry([
        new THREE.Vector2(0.422, 0),
        new THREE.Vector2(0.425, 0.08),
        new THREE.Vector2(0.41, 0.18),
        new THREE.Vector2(0.355, 0.27),
        new THREE.Vector2(0.24, 0.34),
        new THREE.Vector2(0, 0.405),
      ], 32), {});
      for (let i = 0; i < 4; i++) {
        const phi = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const seam = [];
        for (let k = 0; k <= 7; k++) {
          const t = k / 7;
          const theta = t * Math.PI * 0.46;
          const radius = 0.425 - t * 0.31;
          seam.push(new THREE.Vector3(
            Math.sin(phi) * radius,
            0.004 + Math.sin(theta) * 0.39,
            Math.cos(phi) * radius
          ));
        }
        addHatPart(hatStrap, tubeFromPoints(seam, 0.015, 4), {});
        stitchAlong(hatStitches, seam.map((p) => p.clone().multiplyScalar(1.01)), { count: 10, size: 0.008 });
      }
      addStrapBand(0.43, 0.075, 0.026, 0.008);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        addHatPart(hatMetal, new THREE.SphereGeometry(0.014, 6, 4), {
          x: Math.sin(angle) * 0.435,
          y: 0.026,
          z: Math.cos(angle) * 0.435,
        });
      }
      // Una sola pieza de cuero para carrilleras y nuca, abierta en el rostro.
      addHatPart(hatLeather, bandGeometry({
        radiusTop: 0.425,
        radiusBottom: 0.49,
        top: -0.006,
        bottom: -0.21,
        start: 0.72,
        length: Math.PI * 2 - 1.44,
        radial: 36,
        rings: 4,
        drop: 0.055,
      }), {});
      const guardHem = [];
      for (let i = 0; i <= 22; i++) {
        const phi = 0.72 + (i / 22) * (Math.PI * 2 - 1.44);
        guardHem.push(new THREE.Vector3(
          Math.sin(phi) * 0.492,
          -0.212 - 0.055 * Math.cos(phi),
          Math.cos(phi) * 0.492
        ));
      }
      addHatPart(hatStrap, tubeFromPoints(guardHem, 0.012, 4), {});
      stitchAlong(hatStitches, guardHem, { count: 26, size: 0.008 });
      addHatPart(hatMetal, new THREE.BoxGeometry(0.085, 0.1, 0.018), { y: 0.0, z: 0.428, rx: -0.06 });
      break;
    }
    case 'leaves': {
      // Capucha de cuero: cubre cráneo y nuca, con dobladillo cosido en la
      // abertura del rostro y lazo al cuello.
      const radius = 0.452;
      const height = 0.4;
      const gap = 2.05;
      addHatPart(hatLeather, hoodShellGeometry({ radius, height, gap, flare: 0.1, rings: 16 }), {});
      // Forro claro por dentro: la abertura deja de ser un agujero negro.
      addHatPart(hatLining, hoodShellGeometry({ radius: radius * 0.988, height: height * 0.985, gap, flare: 0.1, rings: 14 }), {});
      for (const side of [1, -1]) {
        const rim = hoodRimPoints({ radius, height, gap, side, rings: 16 });
        addHatPart(hatStrap, tubeFromPoints(rim, 0.014, 5), {});
        stitchAlong(hatStitches, rim, { count: 22, size: 0.009 });
        addFurAlong(rim.slice(8), 30, 0.032, 0.011);
      }
      // Costura dorsal, de la coronilla a la nuca.
      const seam = [];
      for (let k = 0; k <= 7; k++) {
        const theta = (k / 7) * Math.PI * 0.62;
        seam.push(new THREE.Vector3(0, height * Math.cos(theta), -Math.sin(theta) * radius));
      }
      addHatPart(hatStrap, tubeFromPoints(seam, 0.012, 4), {});
      // Dobladillo del borde inferior, de mandíbula a mandíbula.
      const hem = hoodHemPoints({ radius, height, gap, flare: 0.1, radial: 26 });
      addHatPart(hatStrap, tubeFromPoints(hem, 0.013, 4), {});
      stitchAlong(hatStitches, hem, { count: 28, size: 0.009 });
      // Correa al cuello con pasador.
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.016, 0.018, 0.22, 5), { x: -0.06, y: -0.16, z: 0.285, rz: 1.32, rx: 0.3 });
      addHatPart(hatMetal, new THREE.BoxGeometry(0.038, 0.032, 0.024), { y: -0.185, z: 0.322 });
      break;
    }
    case 'dark': {
      // Capucha de paño: pliegues blandos, caída larga en la nuca y vueltas
      // cosidas. La forma es hermana de la capucha de cuero; el material, no.
      const radius = 0.462;
      const height = 0.405;
      const gap = 2.2;
      addHatPart(hatFelt, hoodShellGeometry({
        radius,
        height,
        gap,
        flare: 0.18,
        rings: 18,
        folds: 6,
        foldAmp: 0.012,
        phase: 0.6,
      }), {});
      addHatPart(hatLining, hoodShellGeometry({ radius: radius * 0.968, height: height * 0.98, gap, flare: 0.18, rings: 14 }), {});
      for (const side of [1, -1]) {
        const rim = hoodRimPoints({ radius, height, gap, side, rings: 18 });
        addHatPart(hatStrap, tubeFromPoints(rim, 0.016, 6), {});
        stitchAlong(hatStitches, rim, { count: 24, size: 0.01 });
      }
      // Falda de paño con pliegues sobre la nuca y los hombros.
      // Dobladillo del borde inferior y pasador al cuello.
      const hem = hoodHemPoints({ radius, height, gap, flare: 0.18, radial: 30 });
      addHatPart(hatStrap, tubeFromPoints(hem, 0.015, 4), {});
      stitchAlong(hatStitches, hem, { count: 30, size: 0.01 });
      addHatPart(hatMetal, new THREE.BoxGeometry(0.05, 0.034, 0.026), { y: -0.152, z: 0.33 });
      break;
    }
    case 'crystal': {
      // Diadema rúnica: casquete de cuero ceñido, aro de latón con placas y una
      // gema engastada. Se apoya en la cabeza, no flota.
      addHatPart(hatLeather, capShellGeometry({ radius: 0.416, height: 0.39, radial: 32, rings: 12 }), {});
      // Costura de unión de los dos gajos del casquete.
      const capSeam = [];
      for (let k = 0; k <= 8; k++) {
        const theta = (k / 8) * Math.PI * 0.46;
        capSeam.push(new THREE.Vector3(0, Math.sin(theta) * 0.39, -Math.cos(theta) * 0.416));
      }
      addHatPart(hatStrap, tubeFromPoints(capSeam, 0.009, 4), {});
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.42, 0.422, 0.05, 32, 1, true), { y: 0.014 });
      stitchRing(hatStitches, { radius: 0.422, y: 0.036, count: 34, size: 0.008 });
      addHatPart(hatMetal, new THREE.CylinderGeometry(0.422, 0.423, 0.055, 34, 1, true), { y: 0.095 });
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        addHatPart(hatMetal, new THREE.BoxGeometry(0.06, 0.075, 0.016), {
          x: Math.sin(angle) * 0.424,
          y: 0.095,
          z: Math.cos(angle) * 0.424,
          ry: angle,
        });
      }
      addHatPart(hatMetal, new THREE.CylinderGeometry(0.058, 0.05, 0.03, 8), { y: 0.1, z: 0.42, rx: Math.PI / 2, ry: 0.4 });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.072, 0), magicMat);
      gem.position.set(0, 0.1, 0.434);
      gem.scale.set(0.78, 1.25, 0.7);
      hatGroup.add(gem);
      for (const side of [-1, 1]) {
        const stud = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), magicMat);
        stud.position.set(side * 0.19, 0.1, 0.38);
        hatGroup.add(stud);
      }
      break;
    }
    case 'crown': {
      // Corona de rey mago: aro de latón con puntas, terciopelo por dentro y
      // gemas engastadas al frente. Se ciñe al cráneo en vez de flotar.
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.418, 0.424, 0.104, 34, 1, true), { y: 0.052 });
      addHatPart(hatMetal, new THREE.CylinderGeometry(0.426, 0.432, 0.1, 34, 1, true), { y: 0.052 });
      addHatPart(hatMetal, new THREE.TorusGeometry(0.432, 0.012, 4, 46), { y: 0.102, rx: Math.PI / 2 });
      addHatPart(hatMetal, new THREE.TorusGeometry(0.436, 0.013, 4, 46), { y: 0.002, rx: Math.PI / 2 });
      for (let i = 0; i < 8; i++) {
        const phi = (i / 8) * Math.PI * 2;
        addHatPart(hatMetal, new THREE.ConeGeometry(0.062, 0.13 + (i % 2) * 0.02, 4), {
          x: Math.sin(phi) * 0.43,
          y: 0.16 + (i % 2) * 0.01,
          z: Math.cos(phi) * 0.43,
          ry: phi,
          sz: 0.38,
        });
      }
      for (const [phi, size] of [[0, 0.03], [-0.5, 0.022], [0.5, 0.022], [-0.95, 0.016], [0.95, 0.016]]) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), magicMat);
        gem.position.set(Math.sin(phi) * 0.44, 0.052, Math.cos(phi) * 0.44);
        gem.scale.set(0.8, 1.2, 0.55);
        gem.rotation.y = phi;
        hatGroup.add(gem);
      }
      break;
    }
    case 'viking': {
      // Casco vikingo: calota de latón, banda de cuero con remaches, guardanuca
      // y nasal. Los cuernos salen del aro y curvan hacia arriba.
      addHatPart(hatMetal, capShellGeometry({ radius: 0.423, height: 0.33, radial: 32, rings: 10 }), {});
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.427, 0.437, 0.082, 32, 1, true), { y: 0.026 });
      addHatPart(hatStrap, new THREE.TorusGeometry(0.43, 0.009, 4, 44), { y: 0.066, rx: Math.PI / 2 });
      addHatPart(hatStrap, new THREE.TorusGeometry(0.44, 0.01, 4, 44), { y: -0.014, rx: Math.PI / 2 });
      addHatPart(hatStrap, bandGeometry({
        radiusTop: 0.43,
        radiusBottom: 0.472,
        top: -0.012,
        bottom: -0.19,
        start: 0.95,
        length: Math.PI * 2 - 1.9,
        radial: 32,
        rings: 3,
        drop: 0.05,
      }), {});
      for (let i = 0; i < 8; i++) {
        const phi = (i / 8) * Math.PI * 2 + 0.2;
        addHatPart(hatMetal, new THREE.SphereGeometry(0.014, 6, 4), {
          x: Math.sin(phi) * 0.441,
          y: 0.026,
          z: Math.cos(phi) * 0.441,
        });
      }
      // Nasal: tira de metal que baja por la frente hasta la nariz.
      addHatPart(hatMetal, new THREE.BoxGeometry(0.056, 0.13, 0.018), { y: -0.05, z: 0.418, rx: 0.05 });
      addHatPart(hatMetal, new THREE.ConeGeometry(0.031, 0.06, 4), { y: -0.135, z: 0.422, rx: Math.PI, ry: Math.PI / 4 });
      for (const side of [1, -1]) {
        const horn = bentConeGeometry({
          height: 0.3,
          radius: 0.075,
          tip: 0.014,
          bendX: -side * 0.13,
          bendZ: 0.025,
          segments: 9,
          radial: 14,
          belly: 0.62,
        });
        addHatPart(hatHorn, horn, { x: side * 0.39, y: 0.13, rz: -side * 1.16 });
        addHatPart(hatMetal, new THREE.CylinderGeometry(0.084, 0.078, 0.05, 12), {
          x: side * 0.398,
          y: 0.13,
          rz: -side * 1.16,
        });
      }
      break;
    }
    case 'laurel': {
      // Corona de laurel: aro fino de latón con hojas alternas y cintas al
      // final. Abre el frente para dejar ver la cara.
      addHatPart(hatMetal, new THREE.TorusGeometry(0.452, 0.012, 4, 48), { y: 0.008, rx: Math.PI / 2 });
      const gap = 0.5;
      const count = 16;
      for (let i = 0; i < count; i++) {
        const phi = gap + (i / (count - 1)) * (Math.PI * 2 - gap * 2);
        const side = i % 2 === 0 ? 1 : -1;
        // Indexada como el aro: mergeGeometries no mezcla mallas con y sin
        // índice, y la corona entera desaparecía al fusionar las hojas.
        const leaf = mergeVertices(new THREE.OctahedronGeometry(0.075, 0));
        addHatPart(hatMetal, leaf, {
          x: Math.sin(phi) * 0.458,
          y: 0.03 + (i % 2) * 0.03,
          z: Math.cos(phi) * 0.458,
          ry: phi,
          rz: side * 0.75,
          rx: -0.25,
          sx: 0.42,
          sy: 1.35,
          sz: 0.17,
        });
      }
      // Cintas anudadas en la nuca.
      addHatPart(hatStrap, new THREE.BoxGeometry(0.022, 0.13, 0.007), { x: -0.045, y: -0.04, z: -0.458, rz: 0.22, rx: 0.2 });
      addHatPart(hatStrap, new THREE.BoxGeometry(0.018, 0.11, 0.007), { x: 0.015, y: -0.055, z: -0.463, rz: -0.16, rx: 0.16 });
      addHatPart(hatMetal, new THREE.SphereGeometry(0.022, 8, 6), { y: 0.005, z: -0.458, sx: 1.1, sy: 0.8 });
      break;
    }
    case 'top': {
      // Sombrero de copa: fieltro alto de copa recta, ala corta y cinta con
      // hebilla. La pieza más formal del taller.
      addHatPart(hatFelt, brimGeometry({ inner: 0.42, outer: 0.625, droop: 0.018, thickness: 0.032, wave: 0.014 }), { y: 0.003 });
      addBrimEdge(0.629, -0.02, 0.012);
      addHatPart(hatLining, new THREE.TorusGeometry(0.423, 0.008, 4, 42), { y: -0.006, rx: Math.PI / 2 });
      addHatPart(hatFelt, new THREE.CylinderGeometry(0.37, 0.392, 0.5, 34), { y: 0.25 });
      addHatPart(hatStrap, new THREE.CylinderGeometry(0.394, 0.398, 0.088, 34, 1, true), { y: 0.06 });
      addBuckle(0.06, 0.405, 0.072);
      stitchRing(hatStitches, { radius: 0.372, y: 0.492, count: 32, size: 0.008 });
      break;
    }
    case 'pointy':
    default: {
      // Sombrero de archimago: copa de fieltro con la punta doblada, ala corta
      // y cinta de cuero con hebilla.
      addHatPart(hatFelt, brimGeometry({ inner: 0.42, outer: 0.66, droop: 0.06, thickness: 0.042, wave: 0.038 }), { y: 0.005 });
      addBrimEdge(0.664, -0.066, 0.02);
      addHatPart(hatLining, new THREE.TorusGeometry(0.423, 0.008, 4, 40), { y: -0.008, rx: Math.PI / 2 });
      stitchAlong(hatStitches, brimStitches(0.42, 0.66, 0.632, -0.042, 0.03, 0.4, 46), { count: 46, size: 0.008, closed: true });
      const coneCrown = bentConeGeometry({ height: 0.62, radius: 0.425, tip: 0.05, bendX: 0.18, bendZ: -0.11, segments: 18, radial: 30, belly: 0.68 });
      addFolds(coneCrown, { count: 7, amp: 0.016, phase: 1.2, from: 0.06, to: 0.58 });
      dentGeometry(coneCrown, { x: 0.08, y: 0.32, z: 0.26, radius: 0.3, depth: 0.055 });
      addHatPart(hatFelt, coneCrown, { y: 0.005 });
      addHatPart(hatFelt, new THREE.SphereGeometry(0.052, 8, 6), { x: 0.203, y: 0.683, z: -0.122, sy: 0.58 });
      addStrapBand(0.438, 0.072, 0.052);
      addBuckle(0.052, 0.446, 0.08);
      stitchRing(hatStitches, { radius: 0.437, y: 0.086, count: 28, size: 0.008 });
      break;
    }
  }

  const addHatMesh = (parts, material) => {
    if (!parts.length) return;
    for (const part of parts) if (!part.attributes.color) shadeHatGeometry(part);
    const merged = mergeGeometries(parts, false);
    if (!merged) return;
    hatGroup.add(new THREE.Mesh(merged, material));
  };
  addHatMesh(hatFelt, hatMat);
  addHatMesh(hatLeather, hatLeatherMat);
  addHatMesh(hatStrap, hatStrapMat);
  addHatMesh(hatLining, hatLiningMat);
  addHatMesh(hatMetal, hatMetalMat);
  addHatMesh(hatFur, hatFurMat);
  addHatMesh(hatHorn, hatHornMat);
  addHatMesh(hatStitches, hatStitchMat);

  // ------------------------------------------------------------------ bastón
  const staffGroup = new THREE.Group();
  staffGroup.name = 'Baston';
  staffGroup.scale.setScalar(STAFF_SCALE);
  const staffArt = new THREE.Group();
  // El puño agarra algo por debajo de la punta: el bastón queda apoyado en el
  // suelo (o flotando apenas unos centímetros, siendo mágico) y no a la altura
  // de la cadera como un bastón de juguete.
  staffArt.position.y = -STAFF_GRIP - 0.1;
  staffGroup.add(staffArt);

  // Herrajes y cuero del asta: contera de latón, anillos y una empuñadura
  // envuelta, para que el bastón no sea un cilindro desnudo.
  const staffDeep = lambert(new THREE.Color(percentToHex(look.staffColor)).multiplyScalar(0.55));
  const staffWrapMat = lambert('#4a3322');
  const vineMat = lambert('#4e6b3a');
  const staffMetalMat = new THREE.MeshStandardMaterial({
    color: '#b08b4f',
    roughness: 0.42,
    metalness: 0.45,
    flatShading: true,
  });
  const staffIronMat = new THREE.MeshStandardMaterial({
    color: '#2b2733',
    roughness: 0.55,
    metalness: 0.4,
    flatShading: true,
  });
  staffMat.map = getWoodTexture();
  staffMat.bumpMap = staffMat.map;
  staffMat.bumpScale = 0.03;
  materials.push(staffDeep, staffWrapMat, staffMetalMat, staffIronMat, vineMat);

  // El asta se afina hacia la punta y lleva contera, puño envuelto y
  // abrazaderas de latón: la misma gramática en los seis bastones.
  // El asta es fina de verdad: si el puño es más grueso que la mano, el mago
  // no puede cerrar los dedos y parece que sostiene un poste, no un bastón.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.04, 2.62, 7, 1), staffMat);
  shaft.position.y = 1.35;
  staffArt.add(shaft);

  const buttCap = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.038, 0.0),
    new THREE.Vector2(0.052, 0.04),
    new THREE.Vector2(0.055, 0.1),
    new THREE.Vector2(0.046, 0.18),
    new THREE.Vector2(0.0, 0.21),
  ], 10), staffMetalMat);
  buttCap.position.y = 0.035;
  staffArt.add(buttCap);

  for (const y of [0.95, 1.57]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.032, 10), staffMetalMat);
    band.position.y = y;
    staffArt.add(band);
  }
  // Puño: manguito de cuero con surcos y una costura en hélice. Se agarra con
  // la mano entera y se lee como cuero, no como una rosca metálica.
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.037, 0.56, 9), staffWrapMat);
  sleeve.position.y = 1.29;
  staffArt.add(sleeve);
  for (let i = 0; i < 5; i++) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0055, 4, 10), staffDeep);
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 1.05 + i * 0.12;
    staffArt.add(groove);
  }
  const seam = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const angle = t * Math.PI * 2 * 3.4;
    seam.push(new THREE.Vector3(Math.cos(angle) * 0.037, 1.02 + t * 0.54, Math.sin(angle) * 0.037));
  }
  staffArt.add(new THREE.Mesh(tubeFromPoints(seam, 0.008, 3), staffDeep));
  for (const [x, y, z, r] of [[0.028, 0.7, 0.008, 0.028], [-0.026, 2.2, -0.016, 0.022]]) {
    const knot = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), staffMat);
    knot.position.set(x, y, z);
    staffArt.add(knot);
  }

  // La gema es el único punto saturado del bastón: el emisivo va contenido para
  // que el tone mapping no la lave a blanco y el color se lea a distancia.
  const gemColor = new THREE.Color(look.magic);
  const orbMat = new THREE.MeshStandardMaterial({
    color: gemColor.clone().multiplyScalar(0.62),
    emissive: gemColor.clone(),
    emissiveIntensity: 0.38,
    roughness: 0.34,
    metalness: 0,
    flatShading: true,
  });
  materials.push(orbMat);

  // Cabeza del bastón: un engarce de latón y, sobre él, la gema. Los seis
  // comparten el orden contera → asta → puño → abrazadera → engarce → gema,
  // y solo cambia la pieza que la sostiene, para que se lean como un taller.
  const headBase = 2.6;
  const addSocket = (radius = 0.095, height = 0.22, y = headBase) => {
    const cup = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.0, height * 0.02),
      new THREE.Vector2(radius * 0.66, 0.0),
      new THREE.Vector2(radius * 0.74, height * 0.1),
      new THREE.Vector2(radius * 0.86, height * 0.46),
      new THREE.Vector2(radius * 1.06, height * 0.72),
      new THREE.Vector2(radius * 1.02, height * 0.82),
      new THREE.Vector2(radius * 0.7, height * 0.86),
      new THREE.Vector2(radius * 0.56, height * 0.58),
      new THREE.Vector2(0.0, height * 0.44),
    ], 12), staffMetalMat);
    cup.position.y = y;
    staffArt.add(cup);
    return cup;
  };
  // Engaste de joyería: dientes cortos alrededor de la base de la gema.
  const addBezel = (radius, y, count = 6, height = 0.14, material = staffMetalMat) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.022, height, 4), material);
      tooth.position.set(Math.cos(angle) * radius, y + height * 0.5, Math.sin(angle) * radius);
      tooth.rotation.y = -angle;
      staffArt.add(tooth);
    }
  };
  const addGem = (y, size, tall = 1.5, { material = orbMat, shape = 'shard' } = {}) => {
    const gem = new THREE.Mesh(
      shape === 'orb' ? new THREE.IcosahedronGeometry(size, 0) : new THREE.OctahedronGeometry(size, 0),
      material
    );
    gem.position.y = y;
    if (shape === 'shard') gem.scale.set(0.78, tall, 0.78);
    staffArt.add(gem);
    return gem;
  };

  let orb = null;
  let glowAnchor = null;
  let glowScale = null;
  switch (look.staff) {
    case 'wood': {
      // Madera viva: raíces de la misma madera que abren la gema.
      addSocket(0.088, 0.22, 2.54);
      addBezel(0.118, 2.68, 5, 0.16, staffMat);
      orb = addGem(2.98, 0.2, 1.75);
      break;
    }
    case 'fire': {
      // Brasero de latón con una corona de llamas y un ascua encendida dentro.
      const bowl = new THREE.Mesh(new THREE.LatheGeometry([
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.09, 0.01),
        new THREE.Vector2(0.16, 0.08),
        new THREE.Vector2(0.185, 0.17),
        new THREE.Vector2(0.17, 0.19),
        new THREE.Vector2(0.1, 0.11),
        new THREE.Vector2(0, 0.08),
      ], 12), staffMetalMat);
      bowl.position.y = 2.56;
      staffArt.add(bowl);
      // Llama: perfil de gota (lleno en la base y afilado arriba), no una púa.
      const flameGeometry = (height, radius) => new THREE.LatheGeometry([
        new THREE.Vector2(0.0, 0),
        new THREE.Vector2(radius * 0.55, height * 0.07),
        new THREE.Vector2(radius, height * 0.34),
        new THREE.Vector2(radius * 0.78, height * 0.6),
        new THREE.Vector2(radius * 0.42, height * 0.82),
        new THREE.Vector2(radius * 0.14, height * 0.94),
        new THREE.Vector2(0.0, height),
      ], 7);
      const flameMat = new THREE.MeshStandardMaterial({
        color: gemColor.clone().multiplyScalar(0.6),
        emissive: gemColor.clone(),
        emissiveIntensity: 0.5,
        roughness: 0.72,
        metalness: 0,
        flatShading: true,
      });
      materials.push(flameMat);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.5;
        const flame = new THREE.Mesh(
          flameGeometry(0.34 + (i % 2) * 0.12, 0.062 + (i % 2) * 0.012),
          flameMat
        );
        flame.position.set(Math.cos(angle) * 0.05, 2.71, Math.sin(angle) * 0.05);
        flame.rotation.set(Math.sin(angle) * 0.22, 0, -Math.cos(angle) * 0.22);
        staffArt.add(flame);
      }
      const core = new THREE.Mesh(flameGeometry(0.5, 0.045), orbMat);
      core.position.y = 2.72;
      staffArt.add(core);
      orb = addGem(2.86, 0.075, 1, { shape: 'orb' });
      glowAnchor = 2.98;
      glowScale = 0.52;
      break;
    }
    case 'ice': {
      // Abanico de esquirlas: una central alta y cuatro que abren el ramillete.
      addSocket(0.082, 0.19, 2.58);
      addBezel(0.11, 2.7, 6, 0.12);
      orb = addGem(3.04, 0.16, 2.4);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.6;
        const shard = addGem(2.94 + (i % 2) * 0.04, 0.075, 2.1 + (i % 2) * 0.45);
        shard.position.x = Math.cos(angle) * 0.09;
        shard.position.z = Math.sin(angle) * 0.09;
        shard.rotation.set(Math.sin(angle) * 0.28, 0, -Math.cos(angle) * 0.28);
      }
      break;
    }
    case 'roots': {
      // Liana que sube por el asta y se enrosca en un nido de raíces.
      const vine = [];
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const angle = t * Math.PI * 2 * 3.2 + 0.6;
        const radius = 0.074 - t * 0.012;
        vine.push(new THREE.Vector3(Math.cos(angle) * radius, 1.62 + t * 0.94, Math.sin(angle) * radius));
      }
      staffArt.add(new THREE.Mesh(tubeFromPoints(vine, 0.019, 4), vineMat));
      addSocket(0.085, 0.22, 2.58);
      orb = addGem(2.94, 0.17, 1, { shape: 'orb' });
      // Nido: un anillo de raíz bajo la gema y cuatro puntas que la abrazan.
      const nest = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.026, 5, 14), vineMat);
      nest.position.y = 2.79;
      nest.rotation.x = Math.PI / 2;
      staffArt.add(nest);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.9;
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), staffDeep);
        claw.position.set(Math.cos(angle) * 0.135, 2.87, Math.sin(angle) * 0.135);
        claw.rotation.y = -angle;
        staffArt.add(claw);
      }
      break;
    }
    case 'dark': {
      // Hierro negro: la gema flota dentro de un anillo forjado, sin garra.
      addSocket(0.085, 0.2, 2.56);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.013, 5, 18), staffIronMat);
      ring.position.y = 2.98;
      ring.rotation.set(0.16, 0.42, 0.1);
      staffArt.add(ring);
      const keeper = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.013, 5, 10), staffMetalMat);
      keeper.position.y = 2.77;
      keeper.rotation.x = Math.PI / 2;
      staffArt.add(keeper);
      orb = addGem(2.98, 0.17, 1, { shape: 'orb' });
      break;
    }
    case 'crystal':
    default: {
      // Espolón de cristal engastado en latón, con dientes de joyería.
      addSocket(0.08, 0.26, 2.54);
      addBezel(0.12, 2.68, 6, 0.15);
      orb = addGem(2.98, 0.195, 2.05);
      break;
    }
  }
  if (!orb) {
    orb = new THREE.Mesh(GEO.glow, orbMat);
    orb.position.y = 2.98;
    staffArt.add(orb);
  }
  orb.name = 'Gema';

  const glowMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: look.magic,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const haloMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: look.magic,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(glowMat, haloMat);
  // El halo se ajusta al tamaño de la gema (el mismo brillo en una esquirla
  // alta que en un orbe) y se centra en ella, no en el engarce.
  orb.geometry.computeBoundingSphere();
  const gemRadius = orb.geometry.boundingSphere.radius * Math.max(orb.scale.x, orb.scale.y, orb.scale.z);
  const glowBase = glowScale ?? gemRadius * 1.6;
  const haloBase = glowBase * 1.45;
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(orb.position);
  if (glowAnchor !== null) glow.position.y = glowAnchor;
  glow.position.y += gemRadius * 0.12;
  glow.scale.setScalar(glowBase);
  staffArt.add(glow);
  const halo = new THREE.Sprite(haloMat);
  halo.position.copy(glow.position);
  halo.scale.setScalar(haloBase);
  staffArt.add(halo);

  // --------------------------------------------------------------- esqueleto
  let model = null;
  let mixer = null;
  let current = null;
  let headBone = null;
  let handBone = null;
  let disposed = false;
  const actions = {};
  const bones = {};
  const glbBases = [];
  let boneAxes = [];
  let boneAxesOn = false;
  let adminCfg = null;
  let loadedOnce = false;
  let currentElement = null;

  function adminValue(key, fallback) {
    const value = adminCfg ? adminCfg[key] : undefined;
    return Number.isFinite(value) ? value : fallback;
  }

  function adminFlag(key, fallback) {
    const value = adminCfg ? adminCfg[key] : undefined;
    return typeof value === 'boolean' ? value : fallback;
  }
  // Orientación de la empuñadura fijada una sola vez respecto a la mano: así
  // el bastón se mueve con la muñeca (agarre real) en vez de quedarse clavado
  // en vertical mientras la mano se separa de él.
  const gripRoll = new THREE.Quaternion().setFromAxisAngle(GRIP_AXIS, GRIP_ROLL);
  const staffGrip = new THREE.Quaternion();
  const staffGripOffset = new THREE.Vector3(0.0305, 0.0325, 0.0051);
  const gripTemp = new THREE.Quaternion();
  let staffReady = false;

  // ------------------------------------------------------- ajustes de admin

  function applyAdminBody() {
    const s = adminValue('size.scale', 1);
    group.scale.set(s * adminValue('size.x', 1), s * adminValue('size.y', 1), s * adminValue('size.z', 1));
    if (headBone) headBone.scale.setScalar(adminValue('size.head', 1));
    if (bones.Spine) bones.Spine.scale.setScalar(adminValue('size.torso', 1));
    stretchBone(bones.UpperArm_L, adminValue('size.arms', 1));
    stretchBone(bones.UpperArm_R, adminValue('size.arms', 1));
    stretchBone(bones.UpperLeg_L, adminValue('size.legs', 1));
    stretchBone(bones.UpperLeg_R, adminValue('size.legs', 1));
    // Las piernas más largas hunden los pies: se sube el rig lo justo para que
    // la planta vuelva a tocar el suelo.
    rig.position.y = (adminValue('size.legs', 1) - 1) * 0.79 * MODEL_SCALE;
  }

  function applyAdminAppearance() {
    if (!adminCfg) return;
    const tint = {
      Tunica: percentToHex(adminCfg['look.robe']),
      Piel: percentToHex(adminCfg['look.skin']),
      Pelo: percentToHex(adminCfg['look.hair']),
      Detalle: adminCfg['look.detail'] === '#ffffff' ? null : percentToHex(adminCfg['look.detail']),
    };
    const style = adminCfg['look.material'] || 'original';
    const styleProps = {
      mate: { roughness: 1, metalness: 0 },
      satinado: { roughness: 0.32, metalness: 0.16 },
      metalico: { roughness: 0.24, metalness: 0.82 },
    }[style];
    const emissive = adminValue('look.emissive', 0);
    for (const base of glbBases) {
      const material = base.material;
      const color = tint[base.name];
      if (color) material.color.set(color);
      else material.color.copy(base.color);
      if (styleProps) {
        material.roughness = styleProps.roughness;
        material.metalness = styleProps.metalness;
      } else {
        material.roughness = base.roughness;
        material.metalness = base.metalness;
      }
      if (material.emissive) {
        material.emissive.copy(material.color);
        // La piel conserva un levante mínimo propio aunque el panel ponga el
        // emisivo general a cero: el cuello nunca queda en sombra cerrada.
        material.emissiveIntensity = Math.max(base.name === 'Piel' ? 0.06 : 0, emissive);
      }
    }

    const robe = percentToHex(adminCfg['look.robe']);
    const hatColor = percentToHex(adminCfg['look.hatColor']);
    const staffColor = percentToHex(adminCfg['look.staffColor']);
    const magic = percentToHex(adminCfg['look.magic']);
    const orbColor = currentElement || magic;
    hatMat.color.set(hatColor);
    hatLeatherMat.color.set(hatColor).lerp(LEATHER_TONE, 0.34);
    hatStrapMat.color.set(hatColor).lerp(LEATHER_TONE, 0.58).multiplyScalar(0.9);
    staffMat.color.set(staffColor);
    magicMat.color.set(magic);
    magicMat.emissive.set(magic);
    magicMat.emissiveIntensity = 0.4 + emissive;
    darkMat.color.set(robe).multiplyScalar(0.35);
    orbMat.color.set(orbColor).multiplyScalar(0.62);
    orbMat.emissive.set(orbColor);
    glowMat.color.set(orbColor);
    haloMat.color.set(orbColor);

    hatPivot.visible = adminFlag('look.hatVisible', true);
    staffGroup.visible = adminFlag('look.staffVisible', true);
    shadow.visible = adminFlag('look.shadow', true) && !dead;
    hatGroup.scale.setScalar(HAT_SCALE * hatFit(look.hat) * adminValue('size.hat', 1));
    staffGroup.scale.setScalar(STAFF_SCALE * adminValue('size.staff', 1));
  }

  function setBoneAxes(enabled) {
    const targets = Object.values(bones);
    if (!enabled) {
      if (!boneAxes.length) return;
      for (const helper of boneAxes) {
        helper.parent?.remove(helper);
        helper.geometry?.dispose();
        helper.material?.dispose();
      }
      boneAxes = [];
      boneAxesOn = false;
      return;
    }
    if (boneAxesOn && boneAxes.length === targets.length) return;
    for (const helper of boneAxes) {
      helper.parent?.remove(helper);
      helper.geometry?.dispose();
      helper.material?.dispose();
    }
    boneAxes = [];
    for (const bone of targets) {
      const helper = new THREE.AxesHelper(0.32);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.renderOrder = 50;
      bone.add(helper);
      boneAxes.push(helper);
    }
    boneAxesOn = true;
  }

  function clipSpeed(name) {
    let speed = adminValue('anim.master', 1);
    if (name === 'idle') speed *= adminValue('anim.idle', 1);
    else if (name === 'walk') speed *= adminValue('anim.walk', 1);
    else if (name === 'run') speed *= adminValue('anim.run', 1);
    else if (name === 'cast') speed *= adminValue('anim.cast', 1) * adminValue('magic.castSpeed', 1);
    return Math.max(0, speed);
  }

  function applyClipSpeeds() {
    for (const [name, action] of Object.entries(actions)) action.setEffectiveTimeScale(clipSpeed(name));
  }

  function play(name, fade = 0.18) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(clipSpeed(name));
    next.setEffectiveWeight(1);
    // Andar y correr comparten la fase del paso: al cambiar de uno a otro el
    // pie que apoya no salta de sitio a mitad de zancada.
    const from = current ? current.getClip().name : null;
    if ((name === 'walk' || name === 'run') && (from === 'walk' || from === 'run')) {
      const fromDuration = current.getClip().duration || 1;
      const toDuration = next.getClip().duration || 1;
      next.time = ((current.time % fromDuration) / fromDuration) * toDuration;
    }
    const scale = adminValue('anim.transition', 0.18) / 0.18;
    if (current) next.crossFadeFrom(current, Math.max(0, fade * scale), false);
    next.play();
    current = next;
  }

  loadAsset()
    .then((gltf) => {
      if (disposed) return;
      model = cloneSkinned(gltf.scene);
      model.scale.setScalar(MODEL_SCALE);
      model.traverse((object) => {
        if (object.isMesh) {
          object.frustumCulled = false;
          const material = object.material.clone();
          const field = TINTS[material.name];
          if (field && look[field]) {
            // El pelo usa una textura neutra (luminancia) desde el GLB: así el
            // color elegido manda y las luces y sombras del mechón se conservan.
            material.color.set(look[field]);
          }
          if (material.name === 'Piel') {
            // La banda oscura del cuello venía del sombreado pintado en el atlas
            // (y el mapa de normales añadía grano). Se aplana la textura y se
            // quita el normal map: la piel queda limpia y el color elegido se
            // mantiene de la cara al cuello.
            material.normalMap = null;
            material.map = cleanSkinTexture(material.map);
            material.emissive.copy(material.color).multiplyScalar(0.06);
            material.emissiveIntensity = 1;
          }
          material.roughness = Math.min(1, material.roughness ?? 0.9);
          object.material = material;
          materials.push(material);
          glbBases.push({
            material,
            name: material.name,
            color: material.color.clone(),
            emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
            emissiveIntensity: material.emissiveIntensity ?? 0,
            roughness: material.roughness ?? 0.9,
            metalness: material.metalness ?? 0,
          });
        }
        if (object.isBone) {
          bones[object.name] = object;
          if (object.name === 'Head') headBone = object;
          if (object.name === 'Hand_L') handBone = object;
        }
      });
      rig.add(model);
      loadedOnce = true;
      if (headBone) headBone.add(hatPivot);
      if (handBone) handBone.add(staffGroup);
      applyAdminAppearance();
      applyAdminBody();
      applyClipSpeeds();
      if (adminFlag('debug.bones', false)) setBoneAxes(true);

      mixer = new THREE.AnimationMixer(model);
      for (const name of CLIPS) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, name);
        if (!clip) continue;
        const action = mixer.clipAction(clip);
        if (ONE_SHOT.has(name)) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions[name] = action;
      }      applyClipSpeeds();
      play('idle', 0);
      mixer.update(0);

      model.updateMatrixWorld(true);
      if (handBone) {
        // La pose de reposo define la vertical del bastón; a partir de ahí la
        // empuñadura queda rígida y el bastón acompaña al brazo.
        const rigQuat = rig.getWorldQuaternion(tempQuat).clone();
        const handQuat = handBone.getWorldQuaternion(tempQuatB).clone();
        const handRelative = rigQuat.invert().multiply(handQuat);
        const restTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.025, 0, -0.035));
        // Se quita el giro de muñeca para que el asta siga vertical aunque la
        // mano ruede sobre sí misma.
        staffGrip
          .copy(handRelative.invert().multiply(restTilt))
          .premultiply(gripTemp.copy(gripRoll).invert());
        staffGroup.position.copy(staffGripOffset);
        staffReady = true;
      }
    })
    .catch((error) => {
      console.error('No se pudo cargar el mago:', error);
    });

  let castTimer = 0;
  let hitTimer = 0;
  let startTimer = 0;
  let stopTimer = 0;
  let wasMoving = false;
  let dead = false;

  // Mirada. Los ojos van pintados en la cara, así que el gesto nace del cuello:
  // la cabeza abre el giro, el pecho lo acompaña un poco y, quieto, el mago
  // reparte miradas a los lados en lugar de quedarse siempre de frente. Sin
  // esto la cara se quedaba clavada aunque el cuerpo apuntara a otro lado.
  const GAZE_YAW = 0.52;
  const GAZE_PITCH = 0.26;
  let gazeTargetYaw = 0;
  let gazeTargetPitch = 0;
  let gazeYaw = 0;
  let gazePitch = 0;
  let gazeHold = 0;
  let glanceTimer = 1.4 + Math.random() * 2.4;

  function updateGaze(dt, moving) {
    const gain = adminFlag('anim.secondary', true) ? adminValue('anim.head', 1) : 0;
    if (dead) {
      gazeTargetYaw = 0;
      gazeTargetPitch = 0;
      gazeHold = 0;
    } else if (gazeHold > 0) {
      // Mirada fijada desde fuera (el taller, por ejemplo).
      gazeHold = Math.max(0, gazeHold - dt);
    } else if (!moving) {
      glanceTimer -= dt;
      if (glanceTimer <= 0) {
        glanceTimer = 2.4 + Math.random() * 3.6;
        if (Math.random() < 0.38) {
          // Revisa el bastón de reojo.
          gazeTargetYaw = (Math.random() < 0.5 ? 1 : -1) * 0.44;
          gazeTargetPitch = 0.2;
        } else {
          gazeTargetYaw = (Math.random() * 2 - 1) * 0.4;
          gazeTargetPitch = (Math.random() * 2 - 1) * 0.09;
        }
      }
    } else {
      // Al andar vuelve al frente, con un poco más de prisa que un giro normal.
      const back = Math.min(1, dt * 2.6);
      gazeTargetYaw *= 1 - back;
      gazeTargetPitch *= 1 - back;
    }
    const ease = 1 - Math.exp(-dt * (gazeHold > 0 ? 8.5 : 4));
    gazeYaw += (gazeTargetYaw - gazeYaw) * ease;
    gazePitch += (gazeTargetPitch - gazePitch) * ease;
    if (!bones.Head) return;
    bones.Head.rotateY(gazeYaw * gain);
    bones.Head.rotateX(-gazePitch * gain);
    bones.Spine?.rotateY(gazeYaw * gain * 0.16);
  }

  // Movimiento secundario procedural: se suma DESPUÉS del mixer, así que no
  // ensucia los clips ni se acumula entre fotogramas.
  function applySecondary(time, moving, running) {
    if (!adminFlag('anim.secondary', true) || dead) return;
    if (adminValue('anim.master', 1) <= 0.001) return;
    const gait = (moving ? (running ? 11 : 7) : 1.6) * adminValue('anim.master', 1);
    const swing = Math.sin(time * gait);
    const armAmt = (adminValue('anim.arm', 1) - 1) * 0.16;
    if (armAmt) {
      bones.UpperArm_L?.rotateY(swing * armAmt);
      bones.UpperArm_R?.rotateY(-swing * armAmt);
    }
    const torsoAmt = (adminValue('anim.torso', 1) - 1) * 0.05;
    if (torsoAmt) {
      bones.Spine?.rotateZ(Math.sin(time * gait * 0.5 + 0.3) * torsoAmt);
      bones.Spine?.rotateX(Math.sin(time * gait + 0.8) * torsoAmt * 0.6);
    }
    const headAmt = (adminValue('anim.head', 1) - 1) * 0.09;
    if (headAmt) {
      bones.Head?.rotateY(Math.sin(time * 0.9 + 0.5) * headAmt);
      bones.Head?.rotateX(Math.sin(time * 0.7) * headAmt * 0.6);
    }
    const clothAmt = (adminValue('anim.cloth', 1) - 1) * 0.06;
    if (clothAmt) bones.Hips?.rotateZ(Math.sin(time * gait + 0.4) * clothAmt);
  }

  const api = {
    group,
    rig,
    look,
    shadow,
    grip: { staffGrip, gripRoll, staffGripOffset },
    get loaded() {
      return !!model;
    },
    get dead() {
      return dead;
    },
    get clip() {
      return current ? current.getClip().name : null;
    },
    get clipInfo() {
      if (!current) return { name: null, time: 0, duration: 1, paused: adminFlag('anim.paused', false) };
      const duration = current.getClip().duration || 1;
      return {
        name: current.getClip().name,
        time: current.time / duration,
        duration,
        paused: adminFlag('anim.paused', false),
      };
    },
    get height() {
      return 4.5 * group.scale.y + rig.position.y;
    },
    get bones() {
      return bones;
    },
    applyAdmin(cfg) {
      adminCfg = cfg;
      applyAdminBody();
      applyAdminAppearance();
      applyClipSpeeds();
      setBoneAxes(adminFlag('debug.bones', false));
    },
    playClip(name) {
      if (!actions[name]) return;
      play(name, 0.1);
      if (current) {
        current.reset();
        current.enabled = true;
        current.setEffectiveTimeScale(clipSpeed(name));
        current.play();
      }
      mixer?.update(0);
    },
    restartClip() {
      if (current) current.time = 0;
      mixer?.update(0);
    },
    scrub(fraction) {
      if (!current || !mixer) return;
      const duration = current.getClip().duration || 1;
      current.enabled = true;
      current.paused = false;
      current.play();
      current.time = Math.max(0, Math.min(1, fraction)) * duration;
      mixer.update(0);
    },
    stepClip(seconds) {
      if (!current) return;
      const duration = current.getClip().duration || 1;
      api.scrub(current.time / duration + seconds / duration);
    },
    setElement(cssColor) {
      currentElement = cssColor;
      orbMat.color.set(cssColor).multiplyScalar(0.62);
      orbMat.emissive.set(cssColor);
      glowMat.color.set(cssColor);
      haloMat.color.set(cssColor);
    },
    flashCast() {
      // Debe cubrir el clip completo (1,1 s) o el gesto se corta a la mitad.
      castTimer = 1.1;
    },
    flashHit() {
      hitTimer = 0.45;
    },
    setDead() {
      dead = true;
    },
    setGaze(yaw, pitch = 0) {
      gazeTargetYaw = Math.max(-GAZE_YAW, Math.min(GAZE_YAW, yaw));
      gazeTargetPitch = Math.max(-GAZE_PITCH, Math.min(GAZE_PITCH, pitch));
      gazeHold = 0.25;
    },
    clearGaze() {
      gazeTargetYaw = 0;
      gazeTargetPitch = 0;
      gazeHold = 0;
      glanceTimer = 1.4 + Math.random() * 2.4;
    },
    update(dt, time, moving, running = false) {
      castTimer = Math.max(0, castTimer - dt);
      hitTimer = Math.max(0, hitTimer - dt);
      startTimer = Math.max(0, startTimer - dt);
      stopTimer = Math.max(0, stopTimer - dt);

      // Arranque y frenada: clips de un disparo que empalman con el ciclo.
      if (moving !== wasMoving) {
        if (moving) startTimer = 0.34;
        else stopTimer = 0.32;
        wasMoving = moving;
      }

      const paused = adminFlag('anim.paused', false);
      const forced = adminCfg && adminCfg['anim.clip'] !== 'auto' ? adminCfg['anim.clip'] : null;
      const forcedAction = forced ? actions[forced] : null;

      if (dead) {
        play('death', 0.12);
        shadow.visible = false;
        glow.visible = false;
      } else if (mixer) {
        shadow.visible = adminFlag('look.shadow', true);
        if (forcedAction) play(forced, 0.12);
        else if (hitTimer > 0) play('hit', 0.1);
        else if (castTimer > 0) play('cast', 0.14);
        else if (startTimer > 0) play('start', 0.1);
        else if (stopTimer > 0) play('stop', 0.1);
        else if (moving) play(running ? 'run' : 'walk', 0.18);
        else play('idle', 0.22);
      }

      if (mixer && !paused) {
        mixer.update(dt);
        applySecondary(time, moving, running);
        updateGaze(dt, moving);
        // El clip de idle deja la mano abierta: la muñeca rueda y los dedos se
        // cierran sobre el asta para que el bastón quede agarrado de verdad.
        if (bones.Hand_L) bones.Hand_L.quaternion.multiply(gripRoll);
        if (bones.Fingers_L) bones.Fingers_L.rotation.set(0, GRIP_CURL, GRIP_FOLD);
      }

      const access = adminFlag('anim.secondary', true) ? adminValue('anim.accessory', 1) : 0;
      if (staffReady) {
        // La empuñadura es rígida; solo hay un dejarse mecer de la muñeca y un
        // flotar mínimo, que da vida al bastón sin despegarlo de la mano.
        const sway = (Math.sin(time * 1.15) * 0.012 + Math.sin(time * 0.47 + 1.3) * 0.006) * access;
        tempEuler.set(sway * 0.6, 0, sway);
        tempQuat.setFromEuler(tempEuler);
        staffGroup.quaternion.copy(staffGrip).multiply(tempQuat);
        staffGroup.position.set(
          staffGripOffset.x,
          staffGripOffset.y + Math.sin(time * 1.55 + 0.4) * 0.009 * access,
          staffGripOffset.z
        );
      }

      if (hatPivot.parent && !dead) {
        hatGroup.rotation.y = Math.sin(time * 0.8) * 0.04 * access;
      }

      if (!dead) {
        const magicGlow = adminValue('look.magicGlow', 1);
        glow.scale.setScalar(glowBase * (1 + Math.sin(time * 3) * 0.05) * magicGlow);
        glow.material.opacity = Math.min(1, 0.42 * magicGlow);
        halo.scale.setScalar(haloBase * (1 + Math.sin(time * 1.7 + 0.8) * 0.05) * magicGlow);
        halo.material.opacity = 0.09 * magicGlow;
        orbMat.emissiveIntensity = 0.38 * magicGlow;
        orb.rotation.y = time * 0.9;
        orb.rotation.x = Math.sin(time * 0.7) * 0.06;
      }
    },
    dispose() {
      disposed = true;
      setBoneAxes(false);
      if (mixer) mixer.stopAllAction();
      for (const material of materials) material.dispose();
      shadowMat.dispose();
      group.clear();
      model = null;
      mixer = null;
      headBone = null;
      handBone = null;
    },
  };
  return api;
}
