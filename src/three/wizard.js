// Mago del jugador: modelo con esqueleto y animaciones (public/models/mago.glb)
// más los gorros y bastones procedurales, que se cuelgan de sus huesos.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/mago.glb`;
const MODEL_SCALE = 1.62;
const HAT_SCALE = 0.33;
const STAFF_SCALE = 0.62;
const STAFF_GRIP = 1.32;

const GEO = {
  brim: new THREE.CylinderGeometry(0.8, 0.86, 0.09, 18),
  band: new THREE.TorusGeometry(0.5, 0.055, 6, 20),
  cone: new THREE.ConeGeometry(0.5, 1.2, 12),
  horn: new THREE.ConeGeometry(0.13, 0.7, 6),
  leaf: new THREE.ConeGeometry(0.2, 0.85, 4),
  shaft: new THREE.CylinderGeometry(0.06, 0.075, 2.85, 6),
  smallCyl: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5),
  orb: new THREE.OctahedronGeometry(0.26, 0),
  glow: new THREE.SphereGeometry(0.16, 8, 6),
  shadow: new THREE.CircleGeometry(1.15, 24),
  shard: new THREE.OctahedronGeometry(0.12, 0),
  crownRing: new THREE.TorusGeometry(0.5, 0.045, 6, 22),
  head: new THREE.SphereGeometry(0.5, 14, 10),
  tuft: new THREE.SphereGeometry(0.2, 8, 6),
};

// Materiales por región de la malla que se tiñen con la apariencia elegida.
const TINTS = { Tunica: 'robe', Piel: 'skin', Pelo: 'hair' };

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

  const hatMat = lambert(look.hatColor);
  const staffMat = lambert(look.staffColor);
  const magicMat = lambert(look.magic, { emissive: new THREE.Color(look.magic), emissiveIntensity: 0.4 });
  const darkMat = lambert('#1a1626');
  materials.push(hatMat, staffMat, magicMat, darkMat);

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const shadow = new THREE.Mesh(GEO.shadow, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  group.add(shadow);

  // ------------------------------------------------------------------ gorro
  const hatGroup = new THREE.Group();
  hatGroup.scale.setScalar(HAT_SCALE);
  const hatPivot = new THREE.Group();
  hatPivot.position.y = 0.22;
  hatPivot.add(hatGroup);
  const crownShards = [];
  let hatTopGlow = null;
  let hatGlowMat = null;
  let hoodMat = null;

  switch (look.hat) {
    case 'wide': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.22, 0.08, 20), hatMat);
      hatGroup.add(brim);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.9, 12), hatMat);
      crown.position.y = 0.47;
      hatGroup.add(crown);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 20), magicMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.08;
      hatGroup.add(band);
      break;
    }
    case 'horns': {
      const cap = new THREE.Mesh(GEO.head, hatMat);
      cap.scale.set(1.08, 0.62, 1.08);
      cap.position.y = 0.12;
      hatGroup.add(cap);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(GEO.horn, darkMat);
        horn.position.set(side * 0.38, 0.48, 0);
        horn.rotation.z = side * -0.55;
        hatGroup.add(horn);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 5), magicMat);
        tip.position.set(side * 0.57, 0.79, 0);
        tip.rotation.z = side * -0.55;
        hatGroup.add(tip);
      }
      break;
    }
    case 'leaves': {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.14, 10), hatMat);
      hatGroup.add(cap);
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const leaf = new THREE.Mesh(GEO.leaf, hatMat);
        leaf.position.set(Math.cos(angle) * 0.38, 0.32, Math.sin(angle) * 0.38);
        leaf.rotation.set(Math.cos(angle) * 0.65, angle, Math.sin(angle) * 0.65 + 0.2);
        hatGroup.add(leaf);
      }
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 5), staffMat);
      stem.position.y = 0.42;
      hatGroup.add(stem);
      const berry = new THREE.Mesh(GEO.shard, magicMat);
      berry.position.y = 0.72;
      hatGroup.add(berry);
      break;
    }
    case 'dark': {
      hoodMat = lambert(look.hatColor, { emissive: new THREE.Color('#2a1740'), emissiveIntensity: 0.25 });
      materials.push(hoodMat);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), hoodMat);
      hood.scale.set(1.02, 1.05, 1.02);
      hood.position.y = 0.14;
      hatGroup.add(hood);
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.25, 9), hoodMat);
      point.position.set(-0.15, 0.78, -0.18);
      point.rotation.z = 0.55;
      point.rotation.x = -0.25;
      hatGroup.add(point);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 5, 18), magicMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.1;
      hatGroup.add(band);
      break;
    }
    case 'crystal': {
      const ring = new THREE.Mesh(GEO.crownRing, magicMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.14;
      hatGroup.add(ring);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const shard = new THREE.Mesh(GEO.shard, magicMat);
        shard.position.set(Math.cos(angle) * 0.46, 0.36, Math.sin(angle) * 0.46);
        shard.rotation.y = angle;
        shard.scale.y = 1.7;
        hatGroup.add(shard);
        crownShards.push(shard);
      }
      const orb = new THREE.Mesh(GEO.shard, magicMat);
      orb.position.y = 0.85;
      orb.scale.setScalar(1.5);
      hatGroup.add(orb);
      crownShards.push(orb);
      break;
    }
    case 'pointy':
    default: {
      const brim = new THREE.Mesh(GEO.brim, hatMat);
      hatGroup.add(brim);
      const cone = new THREE.Mesh(GEO.cone, hatMat);
      cone.position.y = 0.64;
      cone.rotation.z = 0.05;
      hatGroup.add(cone);
      const band = new THREE.Mesh(GEO.band, magicMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.14;
      hatGroup.add(band);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), magicMat);
      tip.position.set(0.06, 1.27, 0);
      hatGroup.add(tip);
      hatTopGlow = tip;
      break;
    }
  }

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

  const shaft = new THREE.Mesh(GEO.shaft, staffMat);
  shaft.position.y = 1.44;
  staffArt.add(shaft);

  const orbMat = new THREE.MeshStandardMaterial({
    color: look.magic,
    emissive: new THREE.Color(look.magic),
    emissiveIntensity: 1.8,
    roughness: 0.3,
    metalness: 0.15,
    flatShading: true,
  });
  materials.push(orbMat);

  let orb = null;
  let orbY = 2.94;
  switch (look.staff) {
    case 'wood': {
      orb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), staffMat);
      orb.position.y = orbY;
      staffArt.add(orb);
      for (let i = 0; i < 3; i++) {
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), staffMat);
        knot.position.set((i - 1) * 0.14, orbY + 0.16 + (i % 2) * 0.1, 0);
        staffArt.add(knot);
      }
      break;
    }
    case 'moon': {
      orb = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.075, 6, 18, Math.PI * 1.35), staffMat);
      orb.position.y = orbY;
      orb.rotation.z = Math.PI * 0.35;
      staffArt.add(orb);
      const star = new THREE.Mesh(GEO.shard, orbMat);
      star.position.y = orbY;
      star.scale.setScalar(0.75);
      staffArt.add(star);
      break;
    }
    case 'sun': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = orbY;
      orb.scale.setScalar(0.95);
      staffArt.add(orb);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const ray = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 4), magicMat);
        ray.position.set(Math.cos(angle) * 0.33, orbY + Math.sin(angle) * 0.33, 0);
        ray.rotation.z = angle - Math.PI / 2;
        staffArt.add(ray);
      }
      break;
    }
    case 'skull': {
      orb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), darkMat);
      orb.position.y = orbY;
      orb.scale.set(1, 0.95, 0.9);
      staffArt.add(orb);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.18), darkMat);
      jaw.position.y = orbY - 0.2;
      staffArt.add(jaw);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(GEO.glow, orbMat);
        eye.position.set(side * 0.09, orbY + 0.04, 0.16);
        eye.scale.setScalar(0.55);
        staffArt.add(eye);
      }
      break;
    }
    case 'lotus': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = orbY;
      staffArt.add(orb);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 4), magicMat);
        petal.position.set(Math.cos(angle) * 0.24, orbY - 0.16, Math.sin(angle) * 0.24);
        petal.rotation.set(Math.cos(angle) * 0.75, 0, Math.sin(angle) * 0.75);
        staffArt.add(petal);
      }
      break;
    }
    case 'rune': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = orbY;
      orb.scale.setScalar(0.85);
      staffArt.add(orb);
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34 + i * 0.08, 0.022, 5, 20), magicMat);
        ring.position.y = orbY;
        ring.rotation.set(Math.PI / 2 + i * 0.5, i * 0.7, 0);
        staffArt.add(ring);
      }
      break;
    }
    case 'branch': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = 2.9;
      staffArt.add(orb);
      for (const side of [-1, 1]) {
        const branch = new THREE.Mesh(GEO.smallCyl, staffMat);
        branch.position.set(side * 0.13, 3.02, 0);
        branch.rotation.z = side * 0.55;
        staffArt.add(branch);
      }
      break;
    }
    case 'fire': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = 2.95;
      orb.scale.set(1.2, 1.4, 1.2);
      staffArt.add(orb);
      for (let i = 0; i < 3; i++) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 5), orbMat);
        flame.position.set((i - 1) * 0.1, 3.16 + (i % 2) * 0.08, 0);
        flame.rotation.z = (i - 1) * 0.35;
        staffArt.add(flame);
      }
      break;
    }
    case 'ice': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = 2.98;
      orb.scale.set(1.1, 1.9, 1.1);
      staffArt.add(orb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 5, 16), staffMat);
      ring.position.y = 2.7;
      ring.rotation.x = Math.PI / 2;
      staffArt.add(ring);
      break;
    }
    case 'roots': {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = 2.92;
      orb.scale.setScalar(0.8);
      staffArt.add(orb);
      for (let i = 0; i < 3; i++) {
        const root = new THREE.Mesh(new THREE.TorusGeometry(0.24 + i * 0.04, 0.035, 5, 12, Math.PI * 1.3), staffMat);
        root.position.y = 2.84 + i * 0.05;
        root.rotation.set(Math.PI / 2, i * 0.8, 0.4);
        staffArt.add(root);
      }
      break;
    }
    case 'dark': {
      orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), darkMat);
      orb.position.y = 2.96;
      staffArt.add(orb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 5, 18), orbMat);
      ring.position.y = 2.96;
      ring.rotation.x = Math.PI / 2.4;
      staffArt.add(ring);
      break;
    }
    case 'crystal':
    default: {
      orb = new THREE.Mesh(GEO.orb, orbMat);
      orb.position.y = 2.98;
      orb.scale.setScalar(1.15);
      staffArt.add(orb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 5, 16), magicMat);
      ring.position.y = 2.78;
      ring.rotation.x = Math.PI / 2;
      staffArt.add(ring);
      break;
    }
  }
  if (!orb) {
    orb = new THREE.Mesh(GEO.glow, orbMat);
    orb.position.y = orbY;
    staffArt.add(orb);
  }

  // La decoración de la punta nació para un mago de cabeza grande: se encoge
  // alrededor del remate del mango para que el orbe no tape media cabeza.
  const staffHead = new THREE.Group();
  staffHead.scale.setScalar(0.55);
  staffHead.position.y = 2.85 * (1 - 0.55);
  for (const child of [...staffArt.children]) {
    if (child !== shaft) staffHead.add(child);
  }
  staffArt.add(staffHead);

  const glowMat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: look.magic,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(glowMat);
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(0, orbY + 0.06, 0);
  glow.scale.setScalar(1.15);
  staffHead.add(glow);

  if (hatTopGlow) {
    hatGlowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: look.magic,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.7,
    });
    materials.push(hatGlowMat);
    const hatGlow = new THREE.Sprite(hatGlowMat);
    hatGlow.position.set(0.06, 1.3, 0);
    hatGlow.scale.setScalar(0.7);
    hatGroup.add(hatGlow);
  }

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
  const staffGrip = new THREE.Quaternion();
  const staffGripOffset = new THREE.Vector3(0.055, -0.01, -0.015);
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
        material.emissiveIntensity = emissive;
      }
    }

    const robe = percentToHex(adminCfg['look.robe']);
    const hatColor = percentToHex(adminCfg['look.hatColor']);
    const staffColor = percentToHex(adminCfg['look.staffColor']);
    const magic = percentToHex(adminCfg['look.magic']);
    const orbColor = currentElement || magic;
    hatMat.color.set(hatColor);
    if (hoodMat) hoodMat.color.set(hatColor);
    staffMat.color.set(staffColor);
    magicMat.color.set(magic);
    magicMat.emissive.set(magic);
    magicMat.emissiveIntensity = 0.4 + emissive;
    darkMat.color.set(robe).multiplyScalar(0.35);
    orbMat.color.set(orbColor);
    orbMat.emissive.set(orbColor);
    glowMat.color.set(orbColor);
    if (hatGlowMat) hatGlowMat.color.set(magic);

    hatPivot.visible = adminFlag('look.hatVisible', true);
    staffGroup.visible = adminFlag('look.staffVisible', true);
    shadow.visible = adminFlag('look.shadow', true) && !dead;
    hatGroup.scale.setScalar(HAT_SCALE * adminValue('size.hat', 1));
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
        staffGrip.copy(handRelative.invert().multiply(restTilt));
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
      orbMat.color.set(cssColor);
      orbMat.emissive.set(cssColor);
      glowMat.color.set(cssColor);
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
        glow.scale.setScalar((1.1 + Math.sin(time * 3) * 0.08) * magicGlow);
        glow.material.opacity = Math.min(1, 0.85 * magicGlow);
        orbMat.emissiveIntensity = 1.8 * magicGlow;
        orb.rotation.y = time * 0.9;
        orb.rotation.x = Math.sin(time * 0.7) * 0.15;
        for (let i = 0; i < crownShards.length; i++) {
          crownShards[i].rotation.y = time * (0.6 + i * 0.1) * (1 + access * 0.5) + i;
        }
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
