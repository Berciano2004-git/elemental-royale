// Crea el esqueleto, pinta los pesos de piel y genera las animaciones del mago.
//
// Entrada: GLB optimizado (una sola malla estática en T-pose).
// Salida:  GLB con skin, huesos y clips: idle, walk, run, cast, hit y death.
//
// Uso: node tools/rig-wizard.mjs [origen] [destino]

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as THREE from 'three';

const source = process.argv[2] || 'assets-source/mago-optimizado.glb';
const target = process.argv[3] || 'public/models/mago.glb';

// ------------------------------------------------------------------ lectura

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('No es un GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binStart);
  const bin = buffer.subarray(binStart + 8, binStart + 8 + binLength);
  return { json, bin };
}

const COMPONENTS = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const component = COMPONENTS[accessor.componentType];
  const items = ITEMS[accessor.type];
  const bytes = component.size * items;
  const stride = view.byteStride || bytes;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new component.array(accessor.count * items);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < items; c++) {
      const at = offset + i * stride + c * component.size;
      out[i * items + c] = component.array === Float32Array
        ? bin.readFloatLE(at)
        : component.array === Uint32Array
          ? bin.readUInt32LE(at)
          : component.array === Uint16Array
            ? bin.readUInt16LE(at)
            : component.array === Uint8Array
              ? bin.readUInt8(at)
              : bin.readInt16LE(at);
    }
  }
  return out;
}

function readImage(json, bin, image) {
  const view = json.bufferViews[image.bufferView];
  return Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
}

// ------------------------------------------------------------------ esqueleto

const OFFSET = [0, 0.952036, 0.0419];

// Cada hueso: nombre, traslación local respecto al padre y padre.
const boneDefs = [
  { name: 'Root', t: [0, 0, 0.02], parent: null },
  { name: 'Hips', t: [0, 0.922, 0], parent: 'Root' },
  { name: 'Spine', t: [0, 0.13, 0], parent: 'Hips' },
  { name: 'Chest', t: [0, 0.2, 0], parent: 'Spine' },
  { name: 'Neck', t: [0, 0.25, 0], parent: 'Chest' },
  { name: 'Head', t: [0, 0.11, 0.012], parent: 'Neck' },
  { name: 'HeadTop_End', t: [0, 0.29, -0.012], parent: 'Head' },
  { name: 'Shoulder_L', t: [0.06, 0.18, 0.002], parent: 'Chest' },
  { name: 'UpperArm_L', t: [0.16, -0.015, -0.03], parent: 'Shoulder_L' },
  { name: 'Forearm_L', t: [0.35, -0.015, -0.01], parent: 'UpperArm_L' },
  { name: 'Hand_L', t: [0.26, -0.01, 0], parent: 'Forearm_L' },
  // Un único hueso de dedos por mano: cierra el puño alrededor del bastón y
  // permite gestos de mano abierta sin multiplicar el esqueleto.
  { name: 'Fingers_L', t: [0.055, -0.005, 0], parent: 'Hand_L' },
  { name: 'HandEnd_L', t: [0.045, -0.005, 0], parent: 'Fingers_L' },
  { name: 'Shoulder_R', t: [-0.06, 0.18, 0.002], parent: 'Chest' },
  { name: 'UpperArm_R', t: [-0.16, -0.015, -0.03], parent: 'Shoulder_R' },
  { name: 'Forearm_R', t: [-0.35, -0.015, -0.01], parent: 'UpperArm_R' },
  { name: 'Hand_R', t: [-0.26, -0.01, 0], parent: 'Forearm_R' },
  { name: 'Fingers_R', t: [-0.055, -0.005, 0], parent: 'Hand_R' },
  { name: 'HandEnd_R', t: [-0.045, -0.005, 0], parent: 'Fingers_R' },
  { name: 'UpperLeg_L', t: [0.115, -0.02, 0], parent: 'Hips' },
  { name: 'LowerLeg_L', t: [0.03, -0.43, 0.012], parent: 'UpperLeg_L' },
  { name: 'Foot_L', t: [0.01, -0.36, -0.01], parent: 'LowerLeg_L' },
  { name: 'Toe_L', t: [0, -0.08, 0.14], parent: 'Foot_L' },
  { name: 'UpperLeg_R', t: [-0.115, -0.02, 0], parent: 'Hips' },
  { name: 'LowerLeg_R', t: [-0.03, -0.43, 0.012], parent: 'UpperLeg_R' },
  { name: 'Foot_R', t: [-0.01, -0.36, -0.01], parent: 'LowerLeg_R' },
  { name: 'Toe_R', t: [0, -0.08, 0.14], parent: 'Foot_R' },
];

const boneWorld = {};
for (const bone of boneDefs) {
  const parent = bone.parent ? boneWorld[bone.parent] : [0, 0, 0];
  boneWorld[bone.name] = [
    parent[0] + bone.t[0],
    parent[1] + bone.t[1],
    parent[2] + bone.t[2],
  ];
}

// Segmento y grosor de influencia de cada hueso que deforma la malla.
const weightBones = [
  { name: 'Hips', a: 'Hips', b: 'Spine', sigma: 0.125 },
  { name: 'Spine', a: 'Spine', b: 'Chest', sigma: 0.13 },
  { name: 'Chest', a: 'Chest', b: 'Neck', sigma: 0.145 },
  { name: 'Neck', a: 'Neck', b: 'Head', sigma: 0.08 },
  { name: 'Head', a: 'Head', b: 'HeadTop_End', sigma: 0.125 },
  { name: 'Shoulder_L', a: 'Shoulder_L', b: 'UpperArm_L', sigma: 0.075 },
  { name: 'UpperArm_L', a: 'UpperArm_L', b: 'Forearm_L', sigma: 0.062 },
  { name: 'Forearm_L', a: 'Forearm_L', b: 'Hand_L', sigma: 0.052 },
  { name: 'Hand_L', a: 'Hand_L', b: 'HandEnd_L', sigma: 0.05 },
  { name: 'Shoulder_R', a: 'Shoulder_R', b: 'UpperArm_R', sigma: 0.075 },
  { name: 'UpperArm_R', a: 'UpperArm_R', b: 'Forearm_R', sigma: 0.062 },
  { name: 'Forearm_R', a: 'Forearm_R', b: 'Hand_R', sigma: 0.052 },
  { name: 'Hand_R', a: 'Hand_R', b: 'HandEnd_R', sigma: 0.05 },
  { name: 'UpperLeg_L', a: 'UpperLeg_L', b: 'LowerLeg_L', sigma: 0.09, side: 1 },
  { name: 'LowerLeg_L', a: 'LowerLeg_L', b: 'Foot_L', sigma: 0.075, side: 1 },
  { name: 'Foot_L', a: 'Foot_L', b: 'Toe_L', sigma: 0.062, side: 1 },
  { name: 'Toe_L', a: 'Toe_L', b: null, sigma: 0.05, side: 1 },
  { name: 'UpperLeg_R', a: 'UpperLeg_R', b: 'LowerLeg_R', sigma: 0.09, side: -1 },
  { name: 'LowerLeg_R', a: 'LowerLeg_R', b: 'Foot_R', sigma: 0.075, side: -1 },
  { name: 'Foot_R', a: 'Foot_R', b: 'Toe_R', sigma: 0.062, side: -1 },
  { name: 'Toe_R', a: 'Toe_R', b: null, sigma: 0.05, side: -1 },
];

function segmentDistance(px, py, pz, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = px - a[0];
  const apy = py - a[1];
  const apz = pz - a[2];
  const lengthSq = abx * abx + aby * aby + abz * abz;
  const t = lengthSq > 1e-8
    ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lengthSq))
    : 0;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------------------------ animación
// El esqueleto se apoya en T, sin rotaciones de reposo, así que los ejes de
// cada hueso son los del modelo:
//   +Z es el frente, +Y arriba. El brazo izquierdo (el del bastón) apunta a
//   +X y el derecho a -X, por eso sus ángulos son simétricos.
//   · Brazo izquierdo: Z negativo lo baja; Y negativo lo adelanta.
//   · Brazo derecho:   Z positivo lo baja; Y positivo lo adelanta.
//   · Muslo (apunta a -Y): X negativo adelanta; en la rodilla X positivo
//     flexiona. En el pie, X negativo levanta la puntera y X positivo sube el
//     talón; en el dedo, X negativo mantiene la planta apoyada cuando el tacón
//     se despega (si gira al revés, la punta se clava en el suelo).
//   · Torso y cabeza: X positivo inclina hacia delante, Y gira la mirada y Z
//     inclina a los lados.
//
// El horneado añade un ajuste vertical en Root (ver groundClamp) para que la
// planta quede exactamente sobre el suelo en todos los fotogramas.

const FPS = 30;
const TAU = Math.PI * 2;

function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// Postura de reposo: peso repartido, pecho alto, barbilla algo baja y la mano
// libre abierta a la altura del esternón, como si sostuviera una esfera de
// energía. El brazo del bastón queda relajado pero con el codo vivo, para que
// la empuñadura no parezca un palo colgando.
function basePose() {
  return {
    Root: { r: [0, 0, 0] },
    Hips: { r: [0, 0.02, 0.004], loc: [0.012, 0, 0] },
    Spine: { r: [0.028, -0.018, 0.006] },
    Chest: { r: [-0.018, -0.03, 0] },
    Neck: { r: [0.018, 0.018, 0] },
    Head: { r: [0.036, 0.04, 0.008] },
    Shoulder_L: { r: [0, 0.015, 0.028] },
    UpperArm_L: { r: [0, 0.28, -1.26] },
    Forearm_L: { r: [0, -1.35, -0.3] },
    Hand_L: { r: [0.61, 0.12, 0.1] },
    Fingers_L: { r: [0, 0, 1.15] },
    Shoulder_R: { r: [0, -0.015, 0.055] },
    UpperArm_R: { r: [0, 1.0, 0.85] },
    Forearm_R: { r: [0, 1.75, -0.3] },
    Hand_R: { r: [0.14, 0.16, -0.34] },
    Fingers_R: { r: [0, 0, -0.3] },
    UpperLeg_L: { r: [-0.03, 0.045, 0.02] },
    LowerLeg_L: { r: [0.075, 0, 0] },
    Foot_L: { r: [-0.02, -0.055, 0] },
    Toe_L: { r: [0, 0, 0] },
    UpperLeg_R: { r: [0.035, -0.05, -0.02] },
    LowerLeg_R: { r: [0.085, 0, 0] },
    Foot_R: { r: [-0.04, 0.05, 0] },
    Toe_R: { r: [0, 0, 0] },
  };
}

function pose(overrides = {}) {
  const out = basePose();
  for (const [bone, value] of Object.entries(overrides)) {
    if (!out[bone]) throw new Error(`Hueso desconocido: ${bone}`);
    if (Array.isArray(value)) out[bone].r = value;
    else Object.assign(out[bone], value);
  }
  return out;
}

// Refleja una pose de piernas/caderas para el paso contrario.
function mirrorLegs(step) {
  const out = {};
  for (const [bone, value] of Object.entries(step)) {
    if (bone === 'Hips') {
      out.Hips = {
        r: [value.r[0], -value.r[1], -value.r[2]],
        loc: [-value.loc[0], value.loc[1], value.loc[2]],
      };
      continue;
    }
    const target = bone.endsWith('_L') ? `${bone.slice(0, -2)}_R` : `${bone.slice(0, -2)}_L`;
    out[target] = [value[0], -value[1], -value[2]];
  }
  return out;
}

// ------------------------------------------------------------------- idle
// Respiración amplia, peso que viaja de un pie al otro y la mano libre
// dibujando un sigilo pequeño. La cabeza escanea el entorno con calma.
const IDLE_DURATION = 4;

function idleAt(phase) {
  const p = phase * TAU;
  const breathe = Math.sin(p);
  const sway = Math.sin(p - 0.85);
  const slow = Math.sin(p * 0.5 + 0.4);
  const orbit = Math.sin(p + 1.35);
  return {
    Hips: {
      r: [0, 0.02 + 0.012 * sway, 0.012 * sway],
      loc: [0.02 * sway, 0.004 * breathe - 0.002, 0],
    },
    Spine: [0.028 + 0.012 * breathe, -0.018 - 0.02 * sway, 0.006 + 0.006 * sway],
    Chest: [-0.04 + 0.016 * breathe, -0.03 - 0.028 * sway, 0.004 * sway],
    Neck: [0.018 - 0.008 * breathe, 0.018 + 0.03 * slow, 0],
    Head: [0.036 - 0.014 * breathe + 0.008 * slow, 0.04 + 0.055 * slow, 0.008 + 0.012 * sway],
    Shoulder_L: [0, 0.015, 0.028 + 0.012 * sway],
    UpperArm_L: [0, 0.28 + 0.022 * sway, -1.26 - 0.012 * breathe],
    Forearm_L: [0, -1.35 + 0.04 * breathe, -0.3],
    Hand_L: [0.61 + 0.03 * breathe, 0.12, 0.1],
    Fingers_L: [0, 0, 1.15 + 0.04 * breathe],
    Shoulder_R: [0, -0.015 - 0.012 * sway, 0.055 + 0.014 * sway],
    UpperArm_R: [0, 1.0 + 0.05 * sway, 0.85 - 0.03 * breathe],
    Forearm_R: [0, 1.75 + 0.08 * orbit, -0.3 - 0.05 * sway],
    Hand_R: [0.14 + 0.14 * orbit, 0.16 + 0.2 * Math.sin(p + 0.6), -0.34 - 0.12 * Math.cos(p + 0.6)],
    Fingers_R: [0, 0, -0.18 + 0.1 * Math.sin(p + 2.1)],
    UpperLeg_L: [-0.03 + 0.018 * sway, 0.045, 0.02],
    LowerLeg_L: [0.075 - 0.02 * sway, 0, 0],
    UpperLeg_R: [0.035 - 0.018 * sway, -0.05, -0.02],
    LowerLeg_R: [0.085 + 0.02 * sway, 0, 0],
  };
}

// ------------------------------------------------------------------- walk
// Ocho apoyos: contacto, absorción, paso y despegue. La cadera gira y cae del
// lado del pie que carga; el pecho contragira; el hombro del bastón se queda
// quieto porque el peso del bastón lo ancla y la mano libre traza el gesto.
const WALK_DURATION = 1.4;

const WALK_STEPS = {
  contact: {
    Hips: { r: [0, -0.055, 0.022], loc: [0.02, -0.004, 0] },
    UpperLeg_L: [-0.55, 0.045, 0.04],
    LowerLeg_L: [0.1, 0, 0],
    Foot_L: [-0.26, -0.055, 0],
    Toe_L: [0.02, 0, 0],
    UpperLeg_R: [0.36, -0.05, -0.04],
    LowerLeg_R: [0.34, 0, 0],
    Foot_R: [0.34, 0.05, 0],
    Toe_R: [-0.34, 0, 0],
  },
  down: {
    Hips: { r: [0, -0.02, 0.034], loc: [0.032, -0.016, 0] },
    UpperLeg_L: [-0.34, 0.045, 0.04],
    LowerLeg_L: [0.24, 0, 0],
    Foot_L: [-0.02, -0.055, 0],
    Toe_L: [0, 0, 0],
    UpperLeg_R: [0.46, -0.05, -0.04],
    LowerLeg_R: [0.66, 0, 0],
    Foot_R: [0.5, 0.05, 0],
    Toe_R: [-0.5, 0, 0],
  },
  passing: {
    Hips: { r: [0, 0.008, 0.03], loc: [0.026, 0.014, 0] },
    UpperLeg_L: [-0.06, 0.045, 0.04],
    LowerLeg_L: [0.2, 0, 0],
    Foot_L: [0.12, -0.055, 0],
    Toe_L: [0, 0, 0],
    UpperLeg_R: [-0.12, -0.05, -0.04],
    LowerLeg_R: [0.95, 0, 0],
    Foot_R: [0.15, 0.05, 0],
    Toe_R: [-0.05, 0, 0],
  },
  up: {
    Hips: { r: [0, 0.042, 0.016], loc: [0.012, 0.008, 0] },
    UpperLeg_L: [0.18, 0.045, 0.04],
    LowerLeg_L: [0.1, 0, 0],
    Foot_L: [0.3, -0.055, 0],
    Toe_L: [-0.34, 0, 0],
    UpperLeg_R: [-0.44, -0.05, -0.04],
    LowerLeg_R: [0.5, 0, 0],
    Foot_R: [-0.08, 0.05, 0],
    Toe_R: [0.02, 0, 0],
  },
};

function walkUpper(phase) {
  const p = phase * TAU;
  const swing = Math.cos(p);
  const lag = Math.sin(p - 0.5);
  const bob = Math.cos(p * 2);
  return {
    Spine: [0.034 + 0.008 * bob, 0.02 * swing - 0.01, 0.008],
    Chest: [-0.045 + 0.012 * bob, 0.115 * swing, 0.016 * Math.sin(p)],
    Neck: [0.016 - 0.006 * bob, -0.05 * swing, 0],
    Head: [
      0.038 + 0.012 * bob,
      0.04 - 0.075 * swing + 0.02 * Math.sin(p * 2 + 0.6),
      0.008 + 0.014 * Math.sin(p - 0.4),
    ],
    Shoulder_L: [0, 0.015, 0.028 + 0.012 * swing],
    UpperArm_L: [0, 0.28 - 0.025 * swing, -1.26 - 0.015 * bob],
    Forearm_L: [0, -1.35 + 0.03 * lag, -0.3],
    Hand_L: [0.61 + 0.02 * lag, 0.12, 0.1],
    Fingers_L: [0, 0, 1.15],
    Shoulder_R: [0, -0.015 - 0.02 * swing, 0.055 + 0.018 * swing],
    UpperArm_R: [0, 1.04 + 0.09 * swing, 0.82 + 0.04 * lag],
    Forearm_R: [0, 1.72 + 0.12 * lag + 0.05 * Math.sin(p * 2 + 0.9), -0.3 - 0.06 * swing],
    Hand_R: [0.15 + 0.16 * Math.sin(p + 1.7), 0.16 + 0.18 * Math.sin(p + 0.8), -0.34 - 0.14 * Math.cos(p + 0.8)],
    Fingers_R: [0, 0, -0.18 + 0.12 * Math.sin(p + 1.2)],
  };
}

function walkKey(stepName, phase, mirrored) {
  const legs = mirrored ? mirrorLegs(WALK_STEPS[stepName]) : WALK_STEPS[stepName];
  return pose({ ...legs, ...walkUpper(phase) });
}

const WALK_KEY_TIMES = [
  { step: 'contact', phase: 0, mirror: false },
  { step: 'down', phase: 0.125, mirror: false },
  { step: 'passing', phase: 0.25, mirror: false },
  { step: 'up', phase: 0.375, mirror: false },
  { step: 'contact', phase: 0.5, mirror: true },
  { step: 'down', phase: 0.625, mirror: true },
  { step: 'passing', phase: 0.75, mirror: true },
  { step: 'up', phase: 0.875, mirror: true },
];

// ------------------------------------------------------------------- run
// Carrera de mago: zancada larga, inclinación decidida, el bastón firme y
// vertical junto al cuerpo (no se agita) y la mano libre bombeando con la
// muñeca relajada. El vuelo mantiene la silueta.
const RUN_DURATION = 0.8;

const RUN_STEPS = {
  contact: {
    Hips: { r: [0, -0.07, 0.03], loc: [0.018, -0.03, 0] },
    UpperLeg_L: [-0.8, 0.04, 0.035],
    LowerLeg_L: [0.42, 0, 0],
    Foot_L: [-0.16, -0.05, 0],
    Toe_L: [0.04, 0, 0],
    UpperLeg_R: [0.5, -0.04, -0.035],
    LowerLeg_R: [0.85, 0, 0],
    Foot_R: [0.5, 0.05, 0],
    Toe_R: [-0.5, 0, 0],
  },
  push: {
    Hips: { r: [0, -0.02, 0.04], loc: [0.022, -0.01, 0] },
    UpperLeg_L: [-0.4, 0.04, 0.035],
    LowerLeg_L: [0.3, 0, 0],
    Foot_L: [0.3, -0.05, 0],
    Toe_L: [-0.5, 0, 0],
    UpperLeg_R: [0.75, -0.04, -0.035],
    LowerLeg_R: [0.8, 0, 0],
    Foot_R: [0.6, 0.05, 0],
    Toe_R: [-0.6, 0, 0],
  },
  flight: {
    Hips: { r: [0, 0.045, 0.012], loc: [0.006, 0.05, 0] },
    UpperLeg_L: [-0.1, 0.04, 0.035],
    LowerLeg_L: [0.85, 0, 0],
    Foot_L: [0.2, -0.05, 0],
    Toe_L: [0, 0, 0],
    UpperLeg_R: [0.2, -0.04, -0.035],
    LowerLeg_R: [1.25, 0, 0],
    Foot_R: [0.5, 0.05, 0],
    Toe_R: [-0.3, 0, 0],
  },
  reach: {
    Hips: { r: [0, 0.05, 0.008], loc: [0.008, 0.04, 0] },
    UpperLeg_L: [0.34, 0.04, 0.035],
    LowerLeg_L: [0.55, 0, 0],
    Foot_L: [0.3, -0.05, 0],
    Toe_L: [-0.2, 0, 0],
    UpperLeg_R: [-0.7, -0.04, -0.035],
    LowerLeg_R: [0.5, 0, 0],
    Foot_R: [0, 0.05, 0],
    Toe_R: [0.04, 0, 0],
  },
};

function runUpper(phase) {
  const p = phase * TAU;
  const swing = Math.cos(p);
  const lag = Math.sin(p - 0.7);
  return {
    Spine: [0.19 + 0.02 * Math.cos(p * 2), 0.025 * swing, 0.012],
    Chest: [0.06, 0.14 * swing, 0.02 * Math.sin(p)],
    Neck: [-0.1, -0.05 * swing, 0],
    Head: [-0.06, 0.04 - 0.07 * swing, 0.012],
    Shoulder_L: [0, 0.03, 0.05],
    UpperArm_L: [0, 0.24 - 0.02 * swing, -1.24],
    Forearm_L: [0, -1.37, -0.3],
    Hand_L: [0.61, 0.12, 0.1],
    Fingers_L: [0, 0, 1.15],
    Shoulder_R: [0, -0.02 - 0.03 * swing, 0.06 + 0.03 * swing],
    UpperArm_R: [0, 1.02 + 0.32 * swing, 0.85 + 0.06 * lag],
    Forearm_R: [0, 1.63 + 0.2 * lag, -0.32],
    Hand_R: [0.14 + 0.08 * Math.sin(p + 1.2), 0.16, -0.34 - 0.08 * Math.cos(p + 1.2)],
    Fingers_R: [0, 0, -0.34],
  };
}

function runKey(stepName, phase, mirrored) {
  const legs = mirrored ? mirrorLegs(RUN_STEPS[stepName]) : RUN_STEPS[stepName];
  return pose({ ...legs, ...runUpper(phase) });
}

const RUN_KEY_TIMES = [
  { step: 'contact', phase: 0, mirror: false },
  { step: 'push', phase: 0.125, mirror: false },
  { step: 'flight', phase: 0.25, mirror: false },
  { step: 'reach', phase: 0.375, mirror: false },
  { step: 'contact', phase: 0.5, mirror: true },
  { step: 'push', phase: 0.625, mirror: true },
  { step: 'flight', phase: 0.75, mirror: true },
  { step: 'reach', phase: 0.875, mirror: true },
];

// ------------------------------------------------------------------- clips
const clips = [];

const idleKeys = [];
for (let i = 0; i < 8; i++) {
  idleKeys.push({ t: (i / 8) * IDLE_DURATION, p: pose(idleAt(i / 8)) });
}
clips.push({ name: 'idle', duration: IDLE_DURATION, loop: true, keys: idleKeys });

clips.push({
  name: 'walk',
  duration: WALK_DURATION,
  loop: true,
  keys: WALK_KEY_TIMES.map(({ step, phase, mirror }) => ({
    t: phase * WALK_DURATION,
    p: walkKey(step, phase, mirror),
  })),
});

clips.push({
  name: 'run',
  duration: RUN_DURATION,
  loop: true,
  keys: RUN_KEY_TIMES.map(({ step, phase, mirror }) => ({
    t: phase * RUN_DURATION,
    p: runKey(step, phase, mirror),
  })),
});

const walkContact = walkKey('contact', 0, false);
const idleRest = pose(idleAt(0));

// Arranque: el peso cae atrás, la mano libre sube y la primera zancada
// termina en el contacto exacto del ciclo para que el fundido no salte.
clips.push({
  name: 'start',
  duration: 0.34,
  loop: false,
  keys: [
    { t: 0, p: idleRest },
    {
      t: 0.13,
      p: pose({
        ...WALK_STEPS.down,
        Hips: { r: [0, 0.03, 0.01], loc: [-0.006, -0.012, 0] },
        Spine: [0.012, 0.03, 0.004],
        Chest: [-0.03, 0.04, 0],
        Head: [0.02, 0.03, 0],
        UpperArm_L: [0, 0.24, -1.24],
        Forearm_L: [0, -1.3, -0.3],
        UpperArm_R: [0, 0.9, 0.87],
        Forearm_R: [0, 1.65, -0.35],
        Hand_R: [0.18, 0.22, -0.36],
      }),
    },
    { t: 0.34, p: walkContact },
  ],
});

// Freno: la zancada se acorta, el peso se reparte y el bastón se asienta.
clips.push({
  name: 'stop',
  duration: 0.32,
  loop: false,
  keys: [
    { t: 0, p: walkContact },
    {
      t: 0.14,
      p: pose({
        ...WALK_STEPS.down,
        Hips: { r: [0, 0.012, 0.018], loc: [0.018, -0.01, 0] },
        Spine: [0.04, -0.01, 0.006],
        Chest: [-0.01, -0.02, 0],
        Head: [0.045, 0.03, 0],
        UpperArm_L: [0, 0.29, -1.25],
        Forearm_L: [0, -1.36, -0.3],
        UpperArm_R: [0, 1.04, 0.87],
        Forearm_R: [0, 1.82, -0.32],
        Hand_R: [0.12, 0.14, -0.32],
      }),
    },
    { t: 0.32, p: idleRest },
  ],
});

// Hechizo: el mago recoge energía hacia el pecho con la mano libre, y la
// empuja al frente mientras el bastón se mantiene alto como foco. El peso
// viaja al pie adelantado y la cabeza acompaña el gesto.
clips.push({
  name: 'cast',
  duration: 1.1,
  loop: false,
  keys: [
    { t: 0, p: idleRest },
    {
      t: 0.2,
      p: pose({
        Hips: { r: [0, 0.12, 0.015], loc: [0.008, -0.012, 0] },
        Spine: [0.01, 0.14, 0.01],
        Chest: [-0.04, 0.2, 0.01],
        Neck: [0.02, -0.08, 0],
        Head: [0.06, 0.02, 0],
        Shoulder_L: [0, 0.02, 0.05],
        UpperArm_L: [0, 0.02, -0.9],
        Forearm_L: [0, -1.3, -0.16],
        Hand_L: [0.65, 0.14, 0.1],
        Shoulder_R: [0, 0.02, 0.03],
        UpperArm_R: [0, 1.02, 0.66],
        Forearm_R: [0, 2.0, -0.1],
        Hand_R: [0.24, 0.3, -0.5],
        Fingers_R: [0, 0, -0.55],
        UpperLeg_L: [-0.1, 0.045, 0.02],
        LowerLeg_L: [0.16, 0, 0],
        UpperLeg_R: [0.08, -0.05, -0.02],
        LowerLeg_R: [0.2, 0, 0],
      }),
    },
    {
      t: 0.36,
      p: pose({
        Hips: { r: [0, 0.04, 0.008], loc: [0.004, -0.02, 0] },
        Spine: [0.03, 0.06, 0.006],
        Chest: [-0.02, 0.1, 0],
        Neck: [0.02, -0.03, 0],
        Head: [0.05, 0.02, 0],
        UpperArm_L: [0, 0.04, -0.88],
        Forearm_L: [0, -1.34, -0.16],
        Hand_L: [0.65, 0.14, 0.1],
        UpperArm_R: [0, 1.1, 0.62],
        Forearm_R: [0, 2.05, -0.05],
        Hand_R: [0.3, 0.32, -0.6],
        Fingers_R: [0, 0, -0.62],
        UpperLeg_L: [-0.12, 0.045, 0.02],
        LowerLeg_L: [0.18, 0, 0],
        UpperLeg_R: [0.1, -0.05, -0.02],
        LowerLeg_R: [0.22, 0, 0],
      }),
    },
    {
      t: 0.52,
      p: pose({
        Hips: { r: [0, -0.16, 0.01], loc: [-0.01, -0.03, 0.02] },
        Spine: [0.1, -0.18, 0.004],
        Chest: [0.02, -0.26, 0],
        Neck: [-0.02, 0.12, 0],
        Head: [-0.02, 0.08, 0],
        Shoulder_L: [0, -0.03, 0.02],
        UpperArm_L: [0, -0.5, -1.02],
        Forearm_L: [0, -1.05, -0.12],
        Hand_L: [0.59, 0.1, 0.12],
        Shoulder_R: [0, 0.04, 0.02],
        UpperArm_R: [0, 1.32, 0.3],
        Forearm_R: [0, 0.6, -0.05],
        Hand_R: [0.16, 0.1, -0.28],
        Fingers_R: [0, 0, -0.04],
        UpperLeg_L: [-0.24, 0.045, 0.02],
        LowerLeg_L: [0.3, 0, 0],
        Foot_L: [-0.08, -0.055, 0],
        UpperLeg_R: [0.16, -0.05, -0.02],
        LowerLeg_R: [0.3, 0, 0],
        Foot_R: [0.2, 0.05, 0],
        Toe_R: [-0.2, 0, 0],
      }),
    },
    {
      t: 0.72,
      p: pose({
        Hips: { r: [0, -0.06, 0.014], loc: [-0.004, -0.018, 0.01] },
        Spine: [0.07, -0.08, 0.006],
        Chest: [0.005, -0.14, 0],
        Neck: [0, 0.06, 0],
        Head: [0.01, 0.05, 0],
        UpperArm_L: [0, -0.12, -0.98],
        Forearm_L: [0, -1.0, -0.14],
        Hand_L: [0.61, 0.12, 0.1],
        UpperArm_R: [0, 1.16, 0.5],
        Forearm_R: [0, 1.1, -0.1],
        Hand_R: [0.18, 0.14, -0.34],
        Fingers_R: [0, 0, -0.2],
        UpperLeg_L: [-0.16, 0.045, 0.02],
        LowerLeg_L: [0.22, 0, 0],
        UpperLeg_R: [0.1, -0.05, -0.02],
        LowerLeg_R: [0.24, 0, 0],
      }),
    },
    { t: 1.1, p: idleRest },
  ],
});

// Golpe: el pecho huye, la cabeza chasquea y el bastón se aprieta contra el
// cuerpo para protegerlo.
clips.push({
  name: 'hit',
  duration: 0.45,
  loop: false,
  keys: [
    { t: 0, p: idleRest },
    {
      t: 0.09,
      p: pose({
        Hips: { r: [0, 0.09, -0.055], loc: [-0.005, -0.018, -0.04] },
        Spine: [-0.16, 0.09, -0.04],
        Chest: [-0.2, 0.13, -0.035],
        Neck: [-0.1, -0.07, 0],
        Head: [-0.22, -0.1, 0.03],
        UpperArm_L: [0, 0.5, -1.1],
        Forearm_L: [0, -1.2, -0.5],
        Hand_L: [0.63, 0.12, 0.1],
        UpperArm_R: [0, 0.86, 0.7],
        Forearm_R: [0, 1.62, -0.1],
        Hand_R: [0.02, 0.1, -0.2],
        UpperLeg_L: [0.04, 0.045, 0.02],
        LowerLeg_L: [0.14, 0, 0],
        UpperLeg_R: [-0.06, -0.05, -0.02],
        LowerLeg_R: [0.28, 0, 0],
      }),
    },
    {
      t: 0.22,
      p: pose({
        Hips: { r: [0, 0.04, -0.025], loc: [0, -0.008, -0.016] },
        Spine: [-0.05, 0.04, -0.02],
        Chest: [-0.075, 0.06, -0.015],
        Head: [-0.1, -0.03, 0.015],
        UpperArm_L: [0, 0.48, -1.15],
        Forearm_L: [0, -1.16, -0.5],
        UpperArm_R: [0, 0.68, 0.84],
        Forearm_R: [0, 1.7, -0.16],
      }),
    },
    { t: 0.45, p: idleRest },
  ],
});

// Muerte: se le doblan las rodillas, el torso cae hacia atrás y acaba tumbado.
// La cadera rota y baja (no el Root, que pivotaría sobre los pies y hundiría el
// cuerpo); el ajuste al suelo del horneado evita cualquier hundimiento.
clips.push({
  name: 'death',
  duration: 1.5,
  loop: false,
  keys: [
    { t: 0, p: idleRest },
    {
      t: 0.22,
      p: pose({
        Hips: { r: [-0.14, 0.02, 0.02], loc: [0, -0.07, -0.015] },
        Spine: [-0.12, 0.02, 0.01],
        Chest: [-0.16, 0.02, 0],
        Neck: [-0.08, 0, 0],
        Head: [-0.24, 0.06, 0.02],
        UpperArm_L: [0, 0.02, -0.86],
        Forearm_L: [0, -0.6, 0.1],
        Hand_L: [0.67, 0.1, 0.14],
        UpperArm_R: [0, 0.3, 0.8],
        Forearm_R: [0, 1.2, -0.3],
        Hand_R: [0.2, 0.2, -0.2],
        UpperLeg_L: [-0.34, 0.05, 0.03],
        LowerLeg_L: [0.62, 0, 0],
        Foot_L: [-0.1, -0.055, 0],
        UpperLeg_R: [-0.3, -0.05, -0.03],
        LowerLeg_R: [0.7, 0, 0],
        Foot_R: [-0.06, 0.05, 0],
      }),
    },
    {
      t: 0.55,
      p: pose({
        Hips: { r: [-0.5, 0.02, 0.03], loc: [0, -0.2, -0.04] },
        Spine: [-0.16, 0.02, 0.02],
        Chest: [-0.12, 0.03, 0],
        Neck: [-0.06, 0, 0],
        Head: [-0.18, 0.08, 0.02],
        UpperArm_L: [0.1, 0.1, -0.62],
        Forearm_L: [0, -0.5, 0.25],
        Hand_L: [0.71, 0.08, 0.12],
        UpperArm_R: [0.1, 0.2, 0.55],
        Forearm_R: [0, 0.9, -0.5],
        Hand_R: [0.1, 0.16, -0.2],
        UpperLeg_L: [0.28, 0.06, 0.06],
        LowerLeg_L: [1.0, 0, 0],
        Foot_L: [0.12, -0.055, 0],
        UpperLeg_R: [0.22, -0.06, -0.06],
        LowerLeg_R: [1.05, 0, 0],
        Foot_R: [0.1, 0.05, 0],
      }),
    },
    {
      t: 0.9,
      p: pose({
        Hips: { r: [-1.05, 0.02, 0.04], loc: [0, -0.5, -0.06] },
        Spine: [-0.1, 0.04, 0.02],
        Chest: [-0.02, 0.04, 0],
        Neck: [0.05, 0.02, 0],
        Head: [0.12, 0.12, 0.02],
        UpperArm_L: [0.2, 0.35, -0.42],
        Forearm_L: [0, -0.3, 0.2],
        Hand_L: [0.67, 0.06, 0.18],
        UpperArm_R: [0.2, 0.4, 0.4],
        Forearm_R: [0, 0.45, -0.3],
        Hand_R: [0.1, 0.1, -0.2],
        UpperLeg_L: [0.35, 0.08, 0.08],
        LowerLeg_L: [0.85, 0, 0],
        Foot_L: [0.1, -0.055, 0],
        UpperLeg_R: [0.3, -0.08, -0.08],
        LowerLeg_R: [0.9, 0, 0],
        Foot_R: [0.08, 0.05, 0],
      }),
    },
    {
      t: 1.25,
      p: pose({
        Hips: { r: [-1.42, 0.02, 0.05], loc: [0, -0.7, -0.05] },
        Spine: [-0.04, 0.05, 0.02],
        Chest: [0.02, 0.05, 0],
        Neck: [0.1, 0.04, 0],
        Head: [0.2, 0.16, 0.03],
        UpperArm_L: [0.25, 0.5, -0.32],
        Forearm_L: [0, -0.2, 0.14],
        Hand_L: [0.69, 0.06, 0.16],
        UpperArm_R: [0.25, 0.52, 0.3],
        Forearm_R: [0, 0.3, -0.2],
        Hand_R: [0.12, 0.1, -0.16],
        UpperLeg_L: [0.32, 0.09, 0.1],
        LowerLeg_L: [0.5, 0, 0],
        Foot_L: [0.02, -0.055, 0],
        UpperLeg_R: [0.28, -0.09, -0.1],
        LowerLeg_R: [0.55, 0, 0],
        Foot_R: [0, 0.05, 0],
      }),
    },
    {
      t: 1.5,
      p: pose({
        Hips: { r: [-1.44, 0.02, 0.05], loc: [0, -0.705, -0.05] },
        Spine: [-0.03, 0.05, 0.02],
        Chest: [0.02, 0.05, 0],
        Neck: [0.1, 0.04, 0],
        Head: [0.21, 0.16, 0.03],
        UpperArm_L: [0.25, 0.5, -0.3],
        Forearm_L: [0, -0.2, 0.14],
        Hand_L: [0.69, 0.06, 0.16],
        UpperArm_R: [0.25, 0.52, 0.28],
        Forearm_R: [0, 0.3, -0.2],
        Hand_R: [0.12, 0.1, -0.16],
        UpperLeg_L: [0.32, 0.09, 0.1],
        LowerLeg_L: [0.5, 0, 0],
        Foot_L: [0.02, -0.055, 0],
        UpperLeg_R: [0.28, -0.09, -0.1],
        LowerLeg_R: [0.55, 0, 0],
        Foot_R: [0, 0.05, 0],
      }),
    },
  ],
});


// ------------------------------------------------------------------ horneado

function prepareTrack(keys, loop, duration) {
  const n = keys.length;
  return keys.map((key, i) => {
    let prev = keys[Math.max(0, i - 1)];
    let next = keys[Math.min(n - 1, i + 1)];
    let dtPrev = key.t - prev.t;
    let dtNext = next.t - key.t;
    if (loop) {
      if (i === 0) {
        prev = keys[n - 2];
        dtPrev = duration - prev.t;
      } else if (i === n - 1) {
        next = keys[1];
        dtNext = duration - key.t + next.t;
        next = { t: duration + next.t, v: next.v };
      }
      if (dtPrev <= 0) dtPrev += duration;
      if (dtNext <= 0) dtNext += duration;
    }
    const tangent = key.v.map((value, c) => (next.v[c] - prev.v[c]) / Math.max(1e-6, dtPrev + dtNext));
    return { t: key.t, v: key.v, tangent };
  });
}

function sampleTrack(track, t) {
  let i = 0;
  while (i < track.length - 2 && t > track[i + 1].t) i++;
  const a = track[i];
  const b = track[Math.min(track.length - 1, i + 1)];
  const span = b.t - a.t;
  if (span <= 1e-6) return b.v.slice();
  const u = Math.min(1, Math.max(0, (t - a.t) / span));
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return a.v.map(
    (value, c) => h00 * value + h10 * span * a.tangent[c] + h01 * b.v[c] + h11 * span * b.tangent[c]
  );
}

// Los huesos finales son marcadores de longitud: no se animan ni exportan.
const END_BONES = new Set(['HeadTop_End', 'HandEnd_L', 'HandEnd_R']);
const ANIMATED_BONES = boneDefs.filter((bone) => !END_BONES.has(bone.name));

function bakeClip(clip) {
  const keys = clip.loop
    ? [...clip.keys, { t: clip.duration, p: clip.keys[0].p }]
    : clip.keys;
  if (keys[0].t !== 0) throw new Error(`${clip.name}: la primera clave debe estar en t=0`);
  if (Math.abs(keys[keys.length - 1].t - clip.duration) > 1e-6) {
    throw new Error(`${clip.name}: la última clave debe estar en t=${clip.duration}`);
  }

  const tracks = new Map();
  for (const bone of ANIMATED_BONES) {
    const values = keys.map((key) => {
      const entry = key.p[bone.name];
      if (!entry) throw new Error(`${clip.name} @${key.t}: falta ${bone.name}`);
      return { t: key.t, v: entry.r };
    });
    tracks.set(`${bone.name}.r`, prepareTrack(values, clip.loop, clip.duration));
  }
  const hipsLoc = keys.map((key) => ({ t: key.t, v: key.p.Hips.loc }));
  const hipsTrack = prepareTrack(hipsLoc, clip.loop, clip.duration);

  const frameCount = Math.round(clip.duration * FPS) + 1;
  const times = new Float32Array(frameCount);
  const rotations = new Map();
  for (const bone of ANIMATED_BONES) rotations.set(bone.name, new Float32Array(frameCount * 4));
  const hipsTranslations = new Float32Array(frameCount * 3);

  for (let frame = 0; frame < frameCount; frame++) {
    const t = Math.min(clip.duration, (frame / (frameCount - 1)) * clip.duration);
    times[frame] = t;
    for (const bone of ANIMATED_BONES) {
      const [x, y, z] = sampleTrack(tracks.get(`${bone.name}.r`), t);
      rotations.get(bone.name).set(quatFromEuler(x, y, z), frame * 4);
    }
    const loc = sampleTrack(hipsTrack, t);
    const hips = boneDefs.find((bone) => bone.name === 'Hips');
    hipsTranslations[frame * 3] = hips.t[0] + loc[0];
    hipsTranslations[frame * 3 + 1] = hips.t[1] + loc[1];
    hipsTranslations[frame * 3 + 2] = hips.t[2] + loc[2];
  }

  return { times, rotations, hipsTranslations, frameCount };
}

// ------------------------------------------------------------------ suelo
// Para que la planta quede sobre el suelo se mide, fotograma a fotograma, el
// vértice más bajo de las botas y se sube el nodo Root esa diferencia. En el
// walk y el idle el ajuste es exacto (el pie de apoyo define la altura de la
// cadera); en la carrera solo se corrige el hundimiento para no matar el
// vuelo; en la muerte se mide todo el cuerpo, porque ya no hay pie de apoyo.
const worldMatrices = new Map();
const identityMatrix = new THREE.Matrix4();
const scratchVector = new THREE.Vector3();
const unitScale = new THREE.Vector3(1, 1, 1);

function poseWorldMatrices(baked, frame) {
  for (const bone of boneDefs) {
    const rotation = baked.rotations.get(bone.name);
    const quaternion = rotation
      ? new THREE.Quaternion(rotation[frame * 4], rotation[frame * 4 + 1], rotation[frame * 4 + 2], rotation[frame * 4 + 3])
      : new THREE.Quaternion();
    let translation;
    if (bone.name === 'Hips') {
      translation = new THREE.Vector3(
        baked.hipsTranslations[frame * 3],
        baked.hipsTranslations[frame * 3 + 1],
        baked.hipsTranslations[frame * 3 + 2]
      );
    } else {
      translation = new THREE.Vector3(bone.t[0], bone.t[1], bone.t[2]);
    }
    const local = new THREE.Matrix4().compose(translation, quaternion, unitScale);
    const parent = bone.parent ? worldMatrices.get(bone.parent) : identityMatrix;
    worldMatrices.set(bone.name, new THREE.Matrix4().multiplyMatrices(parent, local));
  }
}

function lowestSampleY(baked, frame, samples) {
  poseWorldMatrices(baked, frame);
  let lowest = Infinity;
  for (const sample of samples) {
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const weight = sample.w[i];
      if (weight <= 1e-4) continue;
      const bone = boneDefs[sample.j[i]];
      const rest = boneWorld[bone.name];
      scratchVector.set(sample.p[0] - rest[0], sample.p[1] - rest[1], sample.p[2] - rest[2]);
      scratchVector.applyMatrix4(worldMatrices.get(bone.name));
      y += scratchVector.y * weight;
    }
    if (y < lowest) lowest = y;
  }
  return lowest;
}

function groundOffsets(baked, clip) {
  const samples = clip.name === 'death' ? bodySamples : soleSamples;
  const exact = clip.name !== 'run' && clip.name !== 'death';
  const target = clip.name === 'death' ? 0.004 : 0.006;
  const offsets = new Float32Array(baked.frameCount);
  for (let frame = 0; frame < baked.frameCount; frame++) {
    const delta = target - lowestSampleY(baked, frame, samples);
    offsets[frame] = exact ? delta : Math.max(0, delta);
  }
  return offsets;
}

// ------------------------------------------------------------------ construir GLB

const { json, bin } = readGlb(source);
const primitive = json.meshes[0].primitives[0];
const positions = readAccessor(json, bin, primitive.attributes.POSITION);
const normals = readAccessor(json, bin, primitive.attributes.NORMAL);
const uvs = readAccessor(json, bin, primitive.attributes.TEXCOORD_0);
const indices = readAccessor(json, bin, primitive.indices);
const vertexCount = positions.length / 3;

// Centra el modelo y apoya los pies en y = 0.
for (let i = 0; i < vertexCount; i++) {
  positions[i * 3] += OFFSET[0];
  positions[i * 3 + 1] += OFFSET[1];
  positions[i * 3 + 2] += OFFSET[2];
}

// Pesos de piel.
const boneIndexByName = new Map(boneDefs.map((bone, index) => [bone.name, index]));
const deformIndices = weightBones.map((bone) => boneIndexByName.get(bone.name));
const jointData = new Uint16Array(vertexCount * 4);
const weightData = new Float32Array(vertexCount * 4);
const dominantBone = new Uint8Array(vertexCount);
let emptyVertices = 0;
let minInfluences = 4;

for (let v = 0; v < vertexCount; v++) {
  const px = positions[v * 3];
  const py = positions[v * 3 + 1];
  const pz = positions[v * 3 + 2];
  const candidates = [];

  let nearest = null;
  for (const bone of weightBones) {
    const a = boneWorld[bone.a];
    const b = bone.b
      ? boneWorld[bone.b]
      : [a[0], a[1], a[2] + 0.12];
    const distance = segmentDistance(px, py, pz, a, b);
    // Las piernas comparten el centro del cuerpo: se separan por lado para
    // que la pierna izquierda no arrastre a la derecha al dar zancadas.
    const gate = bone.side ? Math.max(0, Math.min(1, 0.5 + (px * bone.side) / 0.13)) : 1;
    const weight = Math.exp(-((distance / bone.sigma) ** 2)) * gate;
    if (!nearest || distance < nearest.distance) {
      nearest = { index: boneIndexByName.get(bone.name), distance };
    }
    if (weight > 0.004) {
      candidates.push({ index: boneIndexByName.get(bone.name), weight });
    }
  }  candidates.sort((a, b) => b.weight - a.weight);
  const chosen = candidates.slice(0, 4);
  let total = chosen.reduce((sum, item) => sum + item.weight, 0);
  if (!total) {
    emptyVertices++;
    chosen.push({ index: nearest ? nearest.index : 0, weight: 1 });
    total = 1;
  }
  minInfluences = Math.min(minInfluences, Math.max(1, chosen.length));
  dominantBone[v] = chosen[0] ? chosen[0].index : 0;


  // Normaliza y rellena hasta cuatro influencias.
  for (let i = 0; i < 4; i++) {
    const entry = chosen[i];
    jointData[v * 4 + i] = entry ? entry.index : 0;
    weightData[v * 4 + i] = entry ? entry.weight / total : 0;
  }
}

// Dedos: los vértices que pasan de la muñeca reciben peso del hueso de dedos
// para que el puño pueda cerrarse. El degradado empieza en la base de los
// dedos, no en la palma, para no arrugar el dorso de la mano.
{
  const hands = {
    L: { hand: boneIndexByName.get('Hand_L'), fingers: boneIndexByName.get('Fingers_L'), wrist: 0.83 },
    R: { hand: boneIndexByName.get('Hand_R'), fingers: boneIndexByName.get('Fingers_R'), wrist: -0.83 },
  };
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3];
    if (Math.abs(px) < 0.86) continue;
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    if (Math.abs(py - 1.39) > 0.12 || Math.abs(pz + 0.02) > 0.12) continue;
    const side = px > 0 ? 'L' : 'R';
    const info = hands[side];
    const along = side === 'L' ? px - info.wrist : info.wrist - px;
    if (along < 0.045) continue;
    const blend = Math.min(1, (along - 0.045) / 0.028) * 0.94;
    let handSlot = -1;
    for (let i = 0; i < 4; i++) {
      if (jointData[v * 4 + i] === info.hand && weightData[v * 4 + i] > 1e-4) handSlot = i;
    }
    if (handSlot < 0) continue;
    const take = Math.min(blend, weightData[v * 4 + handSlot] * 0.94);
    let slot = -1;
    for (let i = 0; i < 4; i++) {
      if (weightData[v * 4 + i] <= 1e-4) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      let smallest = Infinity;
      for (let i = 0; i < 4; i++) {
        if (jointData[v * 4 + i] !== info.hand && weightData[v * 4 + i] < smallest) {
          smallest = weightData[v * 4 + i];
          slot = i;
        }
      }
    }
    if (slot < 0) continue;
    jointData[v * 4 + slot] = info.fingers;
    weightData[v * 4 + slot] = take;
    weightData[v * 4 + handSlot] -= take;
  }
}

// Muestras para el ajuste al suelo: la planta de las botas y una muestra
// repartida de todo el cuerpo (sirve para la muerte, donde ya no apoya un pie).
const sampleVertex = (v) => ({
  p: [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]],
  j: [jointData[v * 4], jointData[v * 4 + 1], jointData[v * 4 + 2], jointData[v * 4 + 3]],
  w: [weightData[v * 4], weightData[v * 4 + 1], weightData[v * 4 + 2], weightData[v * 4 + 3]],
});
const soleSamples = [];
const bodySamples = [];
for (let v = 0; v < vertexCount; v++) {
  const name = boneDefs[dominantBone[v]].name;
  if (name === 'Foot_L' || name === 'Toe_L' || name === 'Foot_R' || name === 'Toe_R') {
    if (positions[v * 3 + 1] < 0.14) soleSamples.push(sampleVertex(v));
  }
  if (v % 4 === 0) bodySamples.push(sampleVertex(v));
}

// ------------------------------------------------------------------ regiones
// La malla se parte en cuatro primitivas para poder teñir por separado la
// ropa, la piel y el pelo con los colores elegidos en el taller. El resto
// (pantalón, botas y detalles) conserva su textura original.

const REGION = { ROBE: 0, SKIN: 1, HAIR: 2, DETAIL: 3 };
const REGION_META = [
  { name: 'Tunica' },
  { name: 'Piel' },
  { name: 'Pelo' },
  { name: 'Detalle' },
];
const triangleCount = indices.length / 3;

// Manos: la palma queda dominada por el antebrazo, así que el reparto por
// hueso la teñía como túnica y parecía un guante del color de la ropa. En el
// modelo las manos son piezas sueltas encerradas en la caja de la muñeca: se
// detectan por componente completa para devolverlas a la piel sin tocar la manga.
const HAND_BOX = { minX: 0.73, maxX: 0.96, minY: 1.31, maxY: 1.46, minZ: -0.13, maxZ: 0.13 };
const componentParent = new Int32Array(triangleCount);
for (let i = 0; i < triangleCount; i++) componentParent[i] = i;

function findComponent(index) {
  let root = index;
  while (componentParent[root] !== root) root = componentParent[root];
  while (componentParent[index] !== root) {
    const next = componentParent[index];
    componentParent[index] = root;
    index = next;
  }
  return root;
}

function joinComponents(a, b) {
  const rootA = findComponent(a);
  const rootB = findComponent(b);
  if (rootA !== rootB) componentParent[rootB] = rootA;
}

const trianglesByVertex = new Map();
for (let t = 0; t < triangleCount; t++) {
  for (let corner = 0; corner < 3; corner++) {
    const vertex = indices[t * 3 + corner];
    const list = trianglesByVertex.get(vertex);
    if (list) list.push(t);
    else trianglesByVertex.set(vertex, [t]);
  }
}
for (const list of trianglesByVertex.values()) {
  for (let i = 1; i < list.length; i++) joinComponents(list[0], list[i]);
}

const componentBoxes = new Map();
for (let t = 0; t < triangleCount; t++) {
  const root = findComponent(t);
  let box = componentBoxes.get(root);
  if (!box) {
    box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    componentBoxes.set(root, box);
  }
  for (let corner = 0; corner < 3; corner++) {
    const vertex = indices[t * 3 + corner];
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
    if (z < box.minZ) box.minZ = z;
    if (z > box.maxZ) box.maxZ = z;
  }
}

const handComponents = new Set();
for (const [root, box] of componentBoxes) {
  const left = box.minX >= HAND_BOX.minX && box.maxX <= HAND_BOX.maxX;
  const right = box.minX >= -HAND_BOX.maxX && box.maxX <= -HAND_BOX.minX;
  const vertical = box.minY >= HAND_BOX.minY && box.maxY <= HAND_BOX.maxY;
  const depth = box.minZ >= HAND_BOX.minZ && box.maxZ <= HAND_BOX.maxZ;
  if ((left || right) && vertical && depth) handComponents.add(root);
}

const handSkin = new Uint8Array(triangleCount);
let handTriangleCount = 0;
for (let t = 0; t < triangleCount; t++) {
  if (!handComponents.has(findComponent(t))) continue;
  handSkin[t] = 1;
  handTriangleCount++;
}
console.log(`  manos: ${handComponents.size} piezas, ${handTriangleCount} triángulos de piel`);

const baseImage = json.images && json.images[0];
const baseRaw = baseImage && baseImage.bufferView != null ? readImage(json, bin, baseImage) : null;

// Orejas: quedan fuera de la caja de la cara, así que el reparto las metía en
// el pelo y cambiaban de color con él. Son piezas sueltas en los laterales de
// la cabeza; se reconocen por componente completa dentro de la caja de la oreja.
const EAR_BOX = { minX: 0.07, maxX: 0.17, minY: 1.48, maxY: 1.75, minZ: -0.1, maxZ: 0.1 };
const earCandidates = new Set();
for (const [root, box] of componentBoxes) {
  const left = box.minX >= EAR_BOX.minX && box.maxX <= EAR_BOX.maxX;
  const right = box.minX >= -EAR_BOX.maxX && box.maxX <= -EAR_BOX.minX;
  if (!left && !right) continue;
  if (box.minY < EAR_BOX.minY || box.maxY > EAR_BOX.maxY) continue;
  if (box.minZ < EAR_BOX.minZ || box.maxZ > EAR_BOX.maxZ) continue;
  earCandidates.add(root);
}
const earStats = new Map();
for (let t = 0; t < triangleCount; t++) {
  const root = findComponent(t);
  if (!earCandidates.has(root)) continue;
  const stat = earStats.get(root) || { count: 0 };
  stat.count++;
  earStats.set(root, stat);
}
const earComponents = new Set();
for (const [root, stat] of earStats) {
  if (stat.count < 10) continue;
  earComponents.add(root);
}
const earSkin = new Uint8Array(triangleCount);
let earTriangleCount = 0;
for (let t = 0; t < triangleCount; t++) {
  if (!earComponents.has(findComponent(t))) continue;
  earSkin[t] = 1;
  earTriangleCount++;
}
console.log(`  orejas: ${earComponents.size} piezas, ${earTriangleCount} triángulos de piel`);

const triRegion = new Uint8Array(triangleCount);
const regionCounts = [0, 0, 0, 0];
for (let t = 0; t < triangleCount; t++) {
  const ia = indices[t * 3];
  const ib = indices[t * 3 + 1];
  const ic = indices[t * 3 + 2];
  const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
  const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
  const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
  // La cara ocupa la parte delantera de la cabeza; el resto de la cabeza es
  // pelo. Así el flequillo y la barba no se separan en manchas.
  const faceBox = Math.abs(cx) < 0.13 && cz > 0.03 && cy > 1.40 && cy < 1.78;
  // El cuello también es piel: sin esta caja heredaba el color del pelo.
  const neckBox = Math.abs(cx) < 0.17 && cy > 1.32 && cy < 1.55 && Math.abs(cz) < 0.13;

  const bones = [ia, ib, ic].map((index) => boneDefs[dominantBone[index]].name);
  const headish = bones.includes('Head');
  const handish = bones.some(
    (name) => name === 'Hand_L' || name === 'Hand_R' || name === 'Neck'
  );

  // La ropa cubre todo el torso y los brazos, así que la textura solo decide
  // entre cara y pelo dentro de la cabeza: el resto va por posición.
  let region;
  if (handSkin[t] || earSkin[t] || handish) region = REGION.SKIN;
  else if (headish) region = faceBox || neckBox ? REGION.SKIN : REGION.HAIR;
  else if (cy >= 0.8 && cy <= 1.66) region = REGION.ROBE;
  else if (cy > 1.3) region = REGION.HAIR;
  else region = REGION.DETAIL;

  triRegion[t] = region;
  regionCounts[region]++;
}

// Textura neutra del pelo: la original está pintada de castaño oscuro con las
// luces y sombras horneadas, así que teñirla multiplicaba cualquier color
// contra marrón y apenas se notaba. Se conserva el detalle (luminancia) y se
// quita el pigmento; el color elegido en el taller pone el tono.
let neutralHairJpeg = null;
if (baseRaw) {
  const decoded = await sharp(baseRaw).raw().toBuffer({ resolveWithObject: true });
  const pixels = decoded.data;
  const channels = decoded.info.channels;
  for (let i = 0; i < pixels.length; i += channels) {
    const luma = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    const value = Math.round(Math.min(1, 0.28 + 0.72 * Math.sqrt(luma)) * 255);
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }
  neutralHairJpeg = await sharp(pixels, {
    raw: { width: decoded.info.width, height: decoded.info.height, channels },
  })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

// ------------------------------------------------------------------ escribir

const outputViews = [];
const outputAccessors = [];
const binaryParts = [];
let binaryLength = 0;

function appendBytes(bytes) {
  const padding = (4 - (binaryLength % 4)) % 4;
  if (padding) {
    binaryParts.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const offset = binaryLength;
  binaryParts.push(bytes);
  binaryLength += bytes.byteLength;
  return offset;
}

function addView(bytes, target) {
  const byteOffset = appendBytes(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const view = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
  if (target) view.target = target;
  outputViews.push(view);
  return outputViews.length - 1;
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

function addAccessor(array, componentType, type, count, target, withBounds = false) {
  const viewIndex = addView(array, target);
  const accessor = {
    bufferView: viewIndex,
    componentType,
    count,
    type,
  };
  if (withBounds) {
    const items = ITEMS[type];
    let min = new Array(items).fill(Infinity);
    let max = new Array(items).fill(-Infinity);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < items; c++) {
        const value = array[i * items + c];
        if (value < min[c]) min[c] = value;
        if (value > max[c]) max[c] = value;
      }
    }
    accessor.min = min;
    accessor.max = max;
  }
  outputAccessors.push(accessor);
  return outputAccessors.length - 1;
}

// Una primitiva por región, compartiendo texturas y esqueleto.
const baseMaterial = json.materials && json.materials[0]
  ? JSON.parse(JSON.stringify(json.materials[0]))
  : { pbrMetallicRoughness: {} };

const primitives = [];
const materials = [];
const trianglesByRegion = REGION_META.map(() => []);
for (let t = 0; t < triangleCount; t++) trianglesByRegion[triRegion[t]].push(t);

REGION_META.forEach((meta, regionIndex) => {
  const triangles = trianglesByRegion[regionIndex];
  if (!triangles.length) return;

  const remap = new Map();
  const order = [];
  const localIndices = new Uint32Array(triangles.length * 3);
  triangles.forEach((triangle, k) => {
    for (let corner = 0; corner < 3; corner++) {
      const globalIndex = indices[triangle * 3 + corner];
      let local = remap.get(globalIndex);
      if (local === undefined) {
        local = order.length;
        remap.set(globalIndex, local);
        order.push(globalIndex);
      }
      localIndices[k * 3 + corner] = local;
    }
  });

  const count = order.length;
  const regionPositions = new Float32Array(count * 3);
  const regionNormals = new Float32Array(count * 3);
  const regionUvs = new Float32Array(count * 2);
  const regionJoints = new Uint16Array(count * 4);
  const regionWeights = new Float32Array(count * 4);
  order.forEach((globalIndex, local) => {
    for (let c = 0; c < 3; c++) {
      regionPositions[local * 3 + c] = positions[globalIndex * 3 + c];
      regionNormals[local * 3 + c] = normals[globalIndex * 3 + c];
    }
    for (let c = 0; c < 2; c++) regionUvs[local * 2 + c] = uvs[globalIndex * 2 + c];
    for (let c = 0; c < 4; c++) {
      regionJoints[local * 4 + c] = jointData[globalIndex * 4 + c];
      regionWeights[local * 4 + c] = weightData[globalIndex * 4 + c];
    }
  });

  const useShort = count < 65536;
  const indexArray = useShort ? Uint16Array.from(localIndices) : localIndices;
  const indexAccessor = addAccessor(
    indexArray,
    useShort ? 5123 : 5125,
    'SCALAR',
    indexArray.length,
    ELEMENT_ARRAY_BUFFER
  );
  const positionAccessor = addAccessor(regionPositions, 5126, 'VEC3', count, ARRAY_BUFFER, true);
  const normalAccessor = addAccessor(regionNormals, 5126, 'VEC3', count, ARRAY_BUFFER);
  const uvAccessor = addAccessor(regionUvs, 5126, 'VEC2', count, ARRAY_BUFFER);
  const jointsAccessor = addAccessor(regionJoints, 5123, 'VEC4', count, ARRAY_BUFFER);
  const weightsAccessor = addAccessor(regionWeights, 5126, 'VEC4', count, ARRAY_BUFFER);

  const material = JSON.parse(JSON.stringify(baseMaterial));
  material.name = meta.name;
  material.doubleSided = true;
  material.pbrMetallicRoughness = material.pbrMetallicRoughness || {};
  material.pbrMetallicRoughness.metallicFactor = 0.05;
  material.pbrMetallicRoughness.roughnessFactor = 0.95;
  materials.push(material);

  primitives.push({
    attributes: {
      POSITION: positionAccessor,
      NORMAL: normalAccessor,
      TEXCOORD_0: uvAccessor,
      JOINTS_0: jointsAccessor,
      WEIGHTS_0: weightsAccessor,
    },
    indices: indexAccessor,
    material: materials.length - 1,
    mode: 4,
  });

  console.log(`  ${meta.name}: ${triangles.length.toLocaleString('es')} triángulos`);
});

// Matrices inversas de enlace.
const inverseBind = new Float32Array(boneDefs.length * 16);
for (let i = 0; i < boneDefs.length; i++) {
  const p = boneWorld[boneDefs[i].name];
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16);
}
const inverseBindAccessor = addAccessor(inverseBind, 5126, 'MAT4', boneDefs.length, null);

// Texturas: se copian sin recompirmir; el pelo recibe su propia versión
// neutra para que el color del taller no se mezcle con el castaño original.
const images = (json.images || []).map((image) => {
  const bytes = readImage(json, bin, image);
  const viewIndex = addView(bytes, null);
  return { ...image, bufferView: viewIndex, uri: undefined };
});
const textures = (json.textures || []).map((texture) => ({ ...texture }));
if (neutralHairJpeg) {
  const viewIndex = addView(neutralHairJpeg, null);
  images.push({ mimeType: 'image/jpeg', bufferView: viewIndex });
  const textureIndex = textures.length;
  textures.push({ ...(textures[0] || { sampler: 0 }), source: images.length - 1 });
  const hairMaterial = materials.find((material) => material.name === 'Pelo');
  if (hairMaterial) {
    hairMaterial.pbrMetallicRoughness = hairMaterial.pbrMetallicRoughness || {};
    hairMaterial.pbrMetallicRoughness.baseColorTexture = {
      ...(hairMaterial.pbrMetallicRoughness.baseColorTexture || {}),
      index: textureIndex,
    };
  }
}

// Animaciones: cada clip se hornea a 30 fps con curvas suaves.
const animationDefs = [];
for (const clip of clips) {
  const baked = bakeClip(clip);
  const rootOffsets = groundOffsets(baked, clip);
  const samplers = [];
  const channels = [];
  const timeAccessor = addAccessor(baked.times, 5126, 'SCALAR', baked.frameCount, null, true);

  for (const bone of boneDefs) {
    if (bone.name === 'HeadTop_End' || bone.name === 'HandEnd_L' || bone.name === 'HandEnd_R') continue;
    const nodeIndex = 2 + boneDefs.indexOf(bone); // 0 malla, 1 armadura, 2+ huesos
    const quats = baked.rotations.get(bone.name);
    const rotationAccessor = addAccessor(quats, 5126, 'VEC4', baked.frameCount, null);
    samplers.push({ input: timeAccessor, output: rotationAccessor, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path: 'rotation' } });

    if (bone.name === 'Hips') {
      const translationAccessor = addAccessor(
        baked.hipsTranslations,
        5126,
        'VEC3',
        baked.frameCount,
        null
      );
      samplers.push({ input: timeAccessor, output: translationAccessor, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path: 'translation' } });
    }

    if (bone.name === 'Root') {
      const translations = new Float32Array(baked.frameCount * 3);
      for (let frame = 0; frame < baked.frameCount; frame++) {
        translations[frame * 3] = bone.t[0];
        translations[frame * 3 + 1] = bone.t[1] + rootOffsets[frame];
        translations[frame * 3 + 2] = bone.t[2];
      }
      const translationAccessor = addAccessor(translations, 5126, 'VEC3', baked.frameCount, null);
      samplers.push({ input: timeAccessor, output: translationAccessor, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path: 'translation' } });
    }
  }

  animationDefs.push({ name: clip.name, channels, samplers });
}

// Nodos: 0 malla, 1 armadura, 2.. huesos.
const nodes = [
  { name: 'Mago', mesh: 0, skin: 0 },
  { name: 'Armature', children: [0, 2] },
];
boneDefs.forEach((bone, index) => {
  const node = {
    name: bone.name,
    translation: bone.t,
  };
  const children = boneDefs
    .map((child, childIndex) => (child.parent === bone.name ? 2 + childIndex : -1))
    .filter((value) => value >= 0);
  if (children.length) node.children = children;
  nodes.push(node);
});

const gltf = {
  asset: {
    version: '2.0',
    generator: 'Elemental Royale · rig automático',
    extras: { rigged: true, clips: clips.map((clip) => clip.name) },
  },
  scene: 0,
  scenes: [{ name: 'Mago', nodes: [1] }],
  nodes,
  skins: [
    {
      name: 'Esqueleto del mago',
      joints: boneDefs.map((_, index) => 2 + index),
      skeleton: 2,
      inverseBindMatrices: inverseBindAccessor,
    },
  ],
  meshes: [
    {
      name: 'Mago',
      primitives,
    },
  ],
  materials,
  textures,
  samplers: json.samplers || [],
  images,
  animations: animationDefs,
  accessors: outputAccessors,
  bufferViews: outputViews,
  buffers: [{ byteLength: binaryLength }],
};

const binBuffer = Buffer.concat(binaryParts);
const jsonString = JSON.stringify(gltf);
// La especificación exige que el chunk BIN empiece alineado a 4 bytes: se
// rellena con espacios contando BYTES, no caracteres (el generador lleva
// tildes y símbolos que ocupan más de un byte en UTF-8).
const jsonBase = Buffer.from(jsonString, 'utf8');
const jsonPad = (4 - (jsonBase.length % 4)) % 4;
const jsonBuffer = jsonPad
  ? Buffer.concat([jsonBase, Buffer.alloc(jsonPad, 0x20)])
  : jsonBase;
const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
const header = Buffer.alloc(12);
header.write('glTF', 0, 'utf8');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
jsonHeader.write('JSON', 4, 'utf8');
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binBuffer.length, 0);
binHeader.write('BIN\0', 4, 'utf8');

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]));

console.log(`✓ ${target}`);
console.log(`  ${vertexCount.toLocaleString('es')} vértices, ${triangleCount.toLocaleString('es')} triángulos`);
console.log(`  ${boneDefs.length} huesos, ${clips.length} animaciones: ${clips.map((clip) => clip.name).join(', ')}`);
console.log(`  ${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB`);
if (emptyVertices) console.log(`  ⚠ ${emptyVertices} vértices sin influencias`);
console.log(`  influencias mínimas por vértice: ${minInfluences}`);

fs.mkdirSync('tmp-rig', { recursive: true });
fs.writeFileSync(
  'tmp-rig/rig-report.json',
  JSON.stringify(
    {
      source,
      target,
      vertexCount,
      triangles: triangleCount,
      regions: REGION_META.map((meta, index) => ({ name: meta.name, triangles: regionCounts[index] })),
      bones: boneDefs.map((bone) => bone.name),
      animations: clips.map((clip) => ({ name: clip.name, duration: clip.duration })),
      emptyVertices,
    },
    null,
    2
  )
);
