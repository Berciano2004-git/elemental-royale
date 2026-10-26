// Diagnóstico del mago: comprueba el GLB exportado (esqueleto, skinning,
// contacto de pies, continuidad de los ciclos y desplazamiento implícito).
//
// Uso: node tools/audit-wizard.mjs [modelo.glb]

import fs from 'node:fs';
import * as THREE from 'three';

const file = process.argv[2] || 'public/models/mago.glb';
const buffer = fs.readFileSync(file);
if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('No es un GLB');

const jsonLength = buffer.readUInt32LE(12);
const jsonStart = 20;
const json = JSON.parse(buffer.toString('utf8', jsonStart, jsonStart + jsonLength));
const binStart = jsonStart + jsonLength;
const binLength = buffer.readUInt32LE(binStart);
const bin = buffer.subarray(binStart + 8, binStart + 8 + binLength);

const COMPONENTS = {
  5120: { read: (b, o) => b.readInt8(o), size: 1 },
  5121: { read: (b, o) => b.readUInt8(o), size: 1 },
  5122: { read: (b, o) => b.readInt16LE(o), size: 2 },
  5123: { read: (b, o) => b.readUInt16LE(o), size: 2 },
  5125: { read: (b, o) => b.readUInt32LE(o), size: 4 },
  5126: { read: (b, o) => b.readFloatLE(o), size: 4 },
};
const ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const component = COMPONENTS[accessor.componentType];
  const items = ITEMS[accessor.type];
  const bytes = component.size * items;
  const stride = view.byteStride || bytes;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Float32Array(accessor.count * items);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < items; c++) {
      out[i * items + c] = component.read(bin, offset + i * stride + c * component.size);
    }
  }
  return out;
}

const nodes = json.nodes;
const skin = json.skins[0];
const joints = skin.joints;
const boneNames = joints.map((index) => nodes[index].name);
const boneIndexByName = new Map(boneNames.map((name, index) => [name, index]));

const problems = [];
const notes = [];

// ---------------------------------------------------------------- estructura
console.log(`\n=== ${file} ===`);
console.log(`nodos ${nodes.length} · huesos ${joints.length} · clips ${json.animations.length}`);
if (binStart % 4 !== 0) {
  problems.push(
    `El chunk BIN empieza en el byte ${binStart}, que no es múltiplo de 4: el GLB incumple la alineación de la especificación (algunos motores e importadores lo rechazan).`
  );
}

// Matriz inversa de enlace: se comprueba que corresponda a la pose de reposo.
const inverseBind = readAccessor(skin.inverseBindMatrices);
const parentOf = new Map();
for (const [index, node] of nodes.entries()) {
  for (const child of node.children || []) parentOf.set(child, index);
}

const restLocal = new Map();
for (const joint of joints) {
  const t = nodes[joint].translation || [0, 0, 0];
  restLocal.set(joint, new THREE.Matrix4().makeTranslation(t[0], t[1], t[2]));
}
function parentMatrix(nodeIndex) {
  const chain = [];
  let current = parentOf.get(nodeIndex);
  while (current !== undefined) {
    chain.unshift(current);
    current = parentOf.get(current);
  }
  const matrix = new THREE.Matrix4();
  for (const index of chain) matrix.multiply(restLocal.get(index) || new THREE.Matrix4());
  return matrix;
}

const restWorld = new Map();
let ibMismatch = 0;
for (const [boneSlot, joint] of joints.entries()) {
  const world = parentMatrix(joint).multiply(restLocal.get(joint));
  restWorld.set(joint, world);
  const ib = new THREE.Matrix4().fromArray(inverseBind, boneSlot * 16);
  const reconstructed = new THREE.Matrix4().copy(world).invert();
  if (reconstructed.elements.some((value, index) => Math.abs(value - ib.elements[index]) > 1e-4)) {
    ibMismatch++;
  }
}
if (ibMismatch) problems.push(`${ibMismatch} matrices inversas de enlace no coinciden con la pose de reposo.`);

const rootNode = joints[0];
const hipsNode = joints[boneIndexByName.get('Hips')];
const restHips = new THREE.Vector3().setFromMatrixPosition(restWorld.get(hipsNode));
const height = new THREE.Vector3();
for (const name of ['HeadTop_End', 'Toe_L', 'Toe_R']) {
  const nodeIndex = joints[boneIndexByName.get(name)];
  if (nodeIndex !== undefined) height.setFromMatrixPosition(restWorld.get(nodeIndex));
}
let maxRestY = -Infinity;
for (const joint of joints) {
  const p = new THREE.Vector3().setFromMatrixPosition(restWorld.get(joint));
  if (joint !== rootNode) maxRestY = Math.max(maxRestY, p.y);
}
console.log(`altura del esqueleto ${maxRestY.toFixed(2)} unidades · cadera en y=${restHips.y.toFixed(2)}`);
console.log('\nJerarquía (posición de reposo):');
for (const [slot, joint] of joints.entries()) {
  const name = nodes[joint].name;
  const p = new THREE.Vector3().setFromMatrixPosition(restWorld.get(joint));
  const depth = (() => {
    let d = 0;
    let current = parentOf.get(joint);
    while (current !== undefined) {
      d++;
      current = parentOf.get(current);
    }
    return d;
  })();
  console.log(
    `${'  '.repeat(depth)}${name.padEnd(14)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`
  );
}

// Huesos que no deforman nada.
const used = new Set();
const meshPrimitives = json.meshes.flatMap((mesh) => mesh.primitives);
const vertexData = [];
for (const primitive of meshPrimitives) {
  const positions = readAccessor(primitive.attributes.POSITION);
  const jointData = readAccessor(primitive.attributes.JOINTS_0);
  const weightData = readAccessor(primitive.attributes.WEIGHTS_0);
  const count = positions.length / 3;
  vertexData.push({ positions, jointData, weightData, count });
  for (let v = 0; v < count; v++) {
    for (let c = 0; c < 4; c++) {
      if (weightData[v * 4 + c] > 1e-4) used.add(jointData[v * 4 + c]);
    }
  }
}
const unusedBones = boneNames.filter((name, slot) => !used.has(slot));
if (unusedBones.length) notes.push(`Huesos sin pesos: ${unusedBones.join(', ')}`);
else notes.push('Todos los huesos tienen influencia sobre la malla.');

// ---------------------------------------------------------------- skinning
let vertexCount = 0;
let badSum = 0;
let empty = 0;
let lowDominant = 0;
let maxJointDistance = 0;
let maxJointDistanceBone = '';
const perBoneVertices = new Map();
let minInfluences = 4;

for (const data of vertexData) {
  for (let v = 0; v < data.count; v++) {
    vertexCount++;
    let sum = 0;
    let dominant = 0;
    let dominantSlot = -1;
    let influences = 0;
    for (let c = 0; c < 4; c++) {
      const w = data.weightData[v * 4 + c];
      if (w > 1e-4) influences++;
      sum += w;
      if (w > dominant) {
        dominant = w;
        dominantSlot = data.jointData[v * 4 + c];
      }
    }
    if (Math.abs(sum - 1) > 1e-3) badSum++;
    if (sum <= 1e-6) empty++;
    if (dominant < 0.5) lowDominant++;
    minInfluences = Math.min(minInfluences, influences);
    if (dominantSlot >= 0) {
      perBoneVertices.set(dominantSlot, (perBoneVertices.get(dominantSlot) || 0) + 1);
      const name = boneNames[dominantSlot];
      if (name && name.startsWith('Hand')) {
        const boneRest = new THREE.Vector3().setFromMatrixPosition(restWorld.get(joints[dominantSlot]));
        const p = new THREE.Vector3(
          data.positions[v * 3],
          data.positions[v * 3 + 1],
          data.positions[v * 3 + 2]
        );
        const d = p.distanceTo(boneRest);
        if (d > maxJointDistance) {
          maxJointDistance = d;
          maxJointDistanceBone = name;
        }
      }
    }
  }
}
if (badSum) problems.push(`${badSum} vértices con pesos que no suman 1.`);
if (empty) problems.push(`${empty} vértices sin influencia.`);
if (minInfluences < 4) notes.push(`${vertexCount - lowDominant} vértices tienen influencia dominante baja (<0.5), lo que suaviza las articulaciones.`);

console.log(`\nSkinning: ${vertexCount.toLocaleString('es')} vértices, influencias mínimas ${minInfluences}`);
console.log(`  dominante < 0.5: ${((lowDominant / vertexCount) * 100).toFixed(1)} %`);
console.log(
  `  vértices por hueso: ${[...perBoneVertices.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slot, count]) => `${boneNames[slot]}:${count}`)
    .join(' ')}`
);
if (maxJointDistance > 0.22) {
  problems.push(
    `Hay vértices a ${maxJointDistance.toFixed(2)} de ${maxJointDistanceBone} (mano) que se mueven como la mano: puede arrastrar la manga.`
  );
}

// ---------------------------------------------------------------- animaciones
const animatedNames = new Set();
for (const animation of json.animations) {
  for (const channel of animation.channels) animatedNames.add(nodes[channel.target.node].name);
}
const staticBones = boneNames.filter((name) => !animatedNames.has(name));
if (staticBones.length) notes.push(`Huesos sin animación: ${staticBones.join(', ')}`);

const boneSlotOfNode = new Map(joints.map((nodeIndex, slot) => [nodeIndex, slot]));
const ibMatrices = joints.map((_, slot) => new THREE.Matrix4().fromArray(inverseBind, slot * 16));

function buildPose(animation, time) {
  const local = new Map();
  const translations = new Map();
  const rotations = new Map();
  for (const joint of joints) {
    const node = nodes[joint];
    const t = node.translation || [0, 0, 0];
    translations.set(joint, new THREE.Vector3(t[0], t[1], t[2]));
    rotations.set(joint, new THREE.Quaternion());
  }
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    const input = readAccessor(sampler.input);
    const output = readAccessor(sampler.output);
    const path = channel.target.path;
    const nodeIndex = channel.target.node;
    const items = path === 'rotation' ? 4 : path === 'translation' ? 3 : 3;
    let frame = 0;
    while (frame < input.length - 2 && time > input[frame + 1]) frame++;
    const span = input[frame + 1] - input[frame];
    const u = span > 1e-6 ? Math.min(1, Math.max(0, (time - input[frame]) / span)) : 0;
    if (path === 'rotation') {
      const a = new THREE.Quaternion(...output.subarray(frame * 4, frame * 4 + 4));
      const b = new THREE.Quaternion(...output.subarray((frame + 1) * 4, (frame + 1) * 4 + 4));
      rotations.set(nodeIndex, a.clone().slerp(b, u));
    } else if (path === 'translation') {
      const a = output.subarray(frame * 3, frame * 3 + 3);
      const b = output.subarray((frame + 1) * 3, (frame + 1) * 3 + 3);
      const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      // La traslación animada ya viene en el espacio del padre.
      translations.set(nodeIndex, new THREE.Vector3(p[0], p[1], p[2]));
    }
  }
  for (const joint of joints) {
    local.set(
      joint,
      new THREE.Matrix4().compose(
        translations.get(joint),
        rotations.get(joint),
        new THREE.Vector3(1, 1, 1)
      )
    );
  }
  const world = new Map();
  const visit = (nodeIndex, parent) => {
    const matrix = parent.clone().multiply(local.get(nodeIndex));
    world.set(nodeIndex, matrix);
    for (const child of nodes[nodeIndex].children || []) visit(child, matrix);
  };
  visit(joints[0], new THREE.Matrix4());
  return { local, world };
}

function sampleSkin(pose, data) {
  const skinMatrices = joints.map((_, slot) => {
    const joint = joints[slot];
    return pose.world.get(joint).clone().multiply(ibMatrices[slot]);
  });
  const out = new Float32Array(data.count * 3);
  const scratch = new THREE.Vector3();
  for (let v = 0; v < data.count; v++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < 4; c++) {
      const weight = data.weightData[v * 4 + c];
      if (weight <= 1e-5) continue;
      const matrix = skinMatrices[data.jointData[v * 4 + c]];
      scratch.set(data.positions[v * 3], data.positions[v * 3 + 1], data.positions[v * 3 + 2]);
      scratch.applyMatrix4(matrix);
      x += scratch.x * weight;
      y += scratch.y * weight;
      z += scratch.z * weight;
    }
    out[v * 3] = x;
    out[v * 3 + 1] = y;
    out[v * 3 + 2] = z;
  }
  return out;
}

const footVertices = [];
const leftFoot = new Set([boneIndexByName.get('Foot_L'), boneIndexByName.get('Toe_L'), boneIndexByName.get('LowerLeg_L')]);
const rightFoot = new Set([boneIndexByName.get('Foot_R'), boneIndexByName.get('Toe_R'), boneIndexByName.get('LowerLeg_R')]);
// Vértices claramente del pie: dominados por pie o dedos.
for (const data of vertexData) {
  const left = [];
  const right = [];
  for (let v = 0; v < data.count; v++) {
    let best = -1;
    let bestWeight = 0;
    for (let c = 0; c < 4; c++) {
      if (data.weightData[v * 4 + c] > bestWeight) {
        bestWeight = data.weightData[v * 4 + c];
        best = data.jointData[v * 4 + c];
      }
    }
    if (leftFoot.has(best) && boneNames[best] !== 'LowerLeg_L') left.push(v);
    if (rightFoot.has(best) && boneNames[best] !== 'LowerLeg_R') right.push(v);
  }
  footVertices.push({ data, left, right });
}

const clipReports = [];
for (const animation of json.animations) {
  const times = readAccessor(animation.samplers[0].input);
  const duration = times[times.length - 1];
  const fps = (times.length - 1) / duration;
  const frames = [];
  const step = 1 / 60;
  for (let t = 0; t <= duration + 1e-6; t += step) frames.push(Math.min(duration, +t.toFixed(5)));
  if (frames[frames.length - 1] < duration) frames.push(duration);

  let minGlobal = Infinity;
  let hipsMinY = Infinity;
  let hipsMaxY = -Infinity;
  let hipsMin = [Infinity, Infinity];
  let hipsMax = [-Infinity, -Infinity];
  const foot = {
    L: { min: Infinity, contactFrames: 0, travel: 0, maxTravelStep: 0, last: null, stride: 0, lowest: 0 },
    R: { min: Infinity, contactFrames: 0, travel: 0, maxTravelStep: 0, last: null, stride: 0, lowest: 0 },
  };
  let handLHeight = 0;
  let handRHeight = 0;
  let firstPose = null;
  let lastPose = null;
  let slopeSignChanges = 0;

  const hipsWorld = [];
  const handWorld = [];

  for (const [frameIndex, t] of frames.entries()) {
    const pose = buildPose(animation, t);

    const contact = { L: Infinity, R: Infinity };
    const centroid = { L: new THREE.Vector2(), R: new THREE.Vector2() };
    const lowest = { L: null, R: null };
    for (const { data, left, right } of footVertices) {
      if (!left.length && !right.length) continue;
      const skinned = sampleSkin(pose, data);
      for (const [side, list] of [['L', left], ['R', right]]) {
        for (const v of list) {
          const y = skinned[v * 3 + 1];
          if (y < contact[side]) {
            contact[side] = y;
            lowest[side] = { x: skinned[v * 3], z: skinned[v * 3 + 2], y };
          }
        }
      }
    }
    const minY = Math.min(contact.L, contact.R);
    minGlobal = Math.min(minGlobal, minY);
    for (const side of ['L', 'R']) {
      if (lowest[side]) centroid[side].set(lowest[side].x, lowest[side].z);
    }

    const hips = new THREE.Vector3().setFromMatrixPosition(pose.world.get(hipsNode));
    hipsWorld.push(hips);
    hipsMinY = Math.min(hipsMinY, hips.y);
    hipsMaxY = Math.max(hipsMaxY, hips.y);
    hipsMin = [Math.min(hipsMin[0], hips.x), Math.min(hipsMin[1], hips.z)];
    hipsMax = [Math.max(hipsMax[0], hips.x), Math.max(hipsMax[1], hips.z)];

    for (const side of ['L', 'R']) {
      const info = foot[side];
      info.min = Math.min(info.min, contact[side]);
      const planted = contact[side] < 0.035;
      if (planted) {
        info.contactFrames++;
        if (info.last) {
          const d = Math.hypot(centroid[side].x - info.last.x, centroid[side].y - info.last.y);
          info.travel += d;
          info.maxTravelStep = Math.max(info.maxTravelStep, d);
        }
        info.last = { x: centroid[side].x, y: centroid[side].y };
      } else {
        info.last = null;
      }
    }

    const handL = new THREE.Vector3().setFromMatrixPosition(pose.world.get(joints[boneIndexByName.get('Hand_L')]));
    const handR = new THREE.Vector3().setFromMatrixPosition(pose.world.get(joints[boneIndexByName.get('Hand_R')]));
    handWorld.push({ L: handL, R: handR });
    handLHeight += handL.y;
    handRHeight += handR.y;

    const snap = [];
    for (const joint of joints) {
      const m = pose.world.get(joint);
      snap.push(m.elements[12], m.elements[13], m.elements[14]);
    }
    if (frameIndex === 0) firstPose = snap;
    lastPose = snap;

    // Velocidad vertical de la cadera para detectar rebotes bruscos.
    if (hipsWorld.length > 2) {
      const a = hipsWorld[hipsWorld.length - 3].y;
      const b = hipsWorld[hipsWorld.length - 2].y;
      const c = hipsWorld[hipsWorld.length - 1].y;
      if ((b - a) * (c - b) < -1e-7) slopeSignChanges++;
    }
  }

  const loopDelta = (() => {
    if (!firstPose || !lastPose) return 0;
    let max = 0;
    for (let i = 0; i < firstPose.length; i += 3) {
      max = Math.max(
        max,
        Math.hypot(firstPose[i] - lastPose[i], firstPose[i + 1] - lastPose[i + 1], firstPose[i + 2] - lastPose[i + 2])
      );
    }
    return max;
  })();

  const report = {
    name: animation.name,
    duration: +duration.toFixed(3),
    fps: +fps.toFixed(1),
    loopDelta: +loopDelta.toFixed(4),
    ground: +minGlobal.toFixed(4),
    hips: {
      y: [+hipsMinY.toFixed(3), +hipsMaxY.toFixed(3)],
      horizontal: [+(hipsMax[0] - hipsMin[0]).toFixed(3), +(hipsMax[1] - hipsMin[1]).toFixed(3)],
    },
    feet: {
      L: { min: +foot.L.min.toFixed(3), plantedFrames: foot.L.contactFrames, travel: +foot.L.travel.toFixed(3) },
      R: { min: +foot.R.min.toFixed(3), plantedFrames: foot.R.contactFrames, travel: +foot.R.travel.toFixed(3) },
    },
    hands: {
      L: +(handLHeight / frames.length).toFixed(3),
      R: +(handRHeight / frames.length).toFixed(3),
    },
    bounceReversals: slopeSignChanges,
  };
  clipReports.push(report);
}

console.log('\nClips:');
for (const report of clipReports) {
  console.log(
    `${report.name.padEnd(6)} ${report.duration.toFixed(2)}s @${report.fps}fps  suelo:${report.ground.toFixed(3)}  ` +
      `cadera y ${report.hips.y[0].toFixed(2)}..${report.hips.y[1].toFixed(2)}  ` +
      `pieL y:${report.feet.L.min.toFixed(2)} (${report.feet.L.plantedFrames} apoyos, recorre ${report.feet.L.travel.toFixed(2)}u)  ` +
      `pieR y:${report.feet.R.min.toFixed(2)} (${report.feet.R.plantedFrames})  ` +
      `loop:${report.loopDelta.toFixed(3)}`
  );
  if (report.ground < -0.02) {
    problems.push(`${report.name}: la malla penetra ${(-report.ground).toFixed(3)} unidades bajo el suelo.`);
  }
  if (['idle', 'walk', 'run'].includes(report.name) && report.loopDelta > 0.004) {
    problems.push(`${report.name}: el primer y el último frame no coinciden (${report.loopDelta.toFixed(3)}).`);
  }
}

// Muerte: comprobación de todo el cuerpo contra el suelo. El ajuste de los
// pies no sirve tumbado, así que se muestrea la malla entera a 10 fps.
const deathAnimation = json.animations.find((animation) => animation.name === 'death');
if (deathAnimation) {
  const deathTimes = readAccessor(deathAnimation.samplers[0].input);
  const deathDuration = deathTimes[deathTimes.length - 1];
  let lowest = Infinity;
  let lowestAt = 0;
  for (let t = 0; t <= deathDuration + 1e-6; t += 0.1) {
    const pose = buildPose(deathAnimation, Math.min(t, deathDuration));
    const skinMatrices = joints.map((_, slot) => pose.world.get(joints[slot]).clone().multiply(ibMatrices[slot]));
    for (let dataIndex = 0; dataIndex < vertexData.length; dataIndex++) {
      const data = vertexData[dataIndex];
      for (let v = 0; v < data.count; v += 6) {
        let y = 0;
        for (let c = 0; c < 4; c++) {
          const weight = data.weightData[v * 4 + c];
          if (weight <= 1e-4) continue;
          const matrix = skinMatrices[data.jointData[v * 4 + c]];
          const p = new THREE.Vector3(
            data.positions[v * 3],
            data.positions[v * 3 + 1],
            data.positions[v * 3 + 2]
          ).applyMatrix4(matrix);
          y += p.y * weight;
        }
        if (y < lowest) {
          lowest = y;
          lowestAt = t;
        }
      }
    }
  }
  console.log(`\nMuerte · vértice más bajo de todo el cuerpo: ${lowest.toFixed(3)} en t=${lowestAt.toFixed(2)}s`);
  if (lowest < -0.01) {
    problems.push(`death: el cuerpo se hunde ${(-lowest).toFixed(3)} unidades bajo el suelo.`);
  }
}

const walk = clipReports.find((report) => report.name === 'walk');
const run = clipReports.find((report) => report.name === 'run');
if (walk) {
  const speed = walk.feet.L.travel / walk.duration;
  console.log(`\nDesplazamiento implícito del ciclo de walk: ${speed.toFixed(2)} u/s (${walk.feet.L.travel.toFixed(2)} u de recorrido del pie por ciclo).`);
  console.log(`Velocidad de juego: 94 u/s → el clip tendría que reproducirse ×${(94 / speed).toFixed(1)} o el pie arrastra.`);
}
if (run) {
  const speed = run.feet.L.travel / run.duration;
  console.log(`Desplazamiento implícito del ciclo de run: ${speed.toFixed(2)} u/s (×${(94 / speed).toFixed(1)} respecto a la velocidad de juego).`);
}

console.log('\nNotas:');
for (const note of notes) console.log(`  · ${note}`);
console.log('\nProblemas:');
if (!problems.length) console.log('  (ninguno detectado)');
for (const problem of problems) console.log(`  ✗ ${problem}`);

fs.mkdirSync('tmp-rig', { recursive: true });
fs.writeFileSync(
  'tmp-rig/animation-audit.json',
  JSON.stringify({ file, restHeight: maxRestY, clips: clipReports, problems, notes }, null, 2)
);
