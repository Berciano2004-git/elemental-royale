// Efectos visuales de hechizos: partículas, proyectiles, zonas y explosiones.

import * as THREE from 'three';
import { makeGlowTexture } from './world.js';
import { STYLE_COLORS } from '../../shared/palette.js';
import {
  barkMaterial,
  crackGlow,
  crystalCluster,
  crystalMaterial,
  crystalShard,
  darkMaterial,
  energyMaterial,
  fireShellMaterial,
  groundDecal,
  leafMaterial,
  noiseTexture,
  rockGeometry,
  rootGeometry,
  smokeSprite,
  stoneBlockGeometry,
  stoneMaterial,
  waterMaterial,
} from './magic.js';

const COLORS = {
  fire: 0xff7a33,
  water: 0x53c9ff,
  wind: 0xa8ffe0,
  earth: 0xd2a05f,
  lightning: 0x9d8bff,
  ice: 0x7fe6ff,
  nature: 0x62d97a,
  dark: 0xb06bff,
  storm: 0xb48cff,
  sand: 0xe8c98a,
  steam: 0xd8f2ff,
  mud: 0x7a5a3a,
  plasma: 0xff7bf0,
  magma: 0xff4d16,
  heal: 0x7bffcf,
  hit: 0xff6b7d,
};

function elementColor(key, fallback = 0xffffff) {
  return COLORS[key] || STYLE_COLORS[key] || fallback;
}

function styleColor(key, fallback = 0xffffff) {
  return COLORS[key] || STYLE_COLORS[key] || fallback;
}

// Segundo tono de cada estilo: da volumen a los materiales sin multiplicar
// mallas. Las fusiones se distinguen por su pareja de colores.
const ACCENTS = {
  fire: 0xffd08a, water: 0xbdf0ff, wind: 0xffffff, earth: 0xf0d6a8,
  lightning: 0xe6e0ff, ice: 0xffffff, nature: 0xc8ff9a, dark: 0x5a1a9a,
  steam: 0xffffff, magma: 0xffc14d, plasma: 0xffffff, thermal: 0xffffff,
  wildfire: 0xffd27a, abyssflame: 0xff8a3c, icestorm: 0xe8ffff, mud: 0xa8875a,
  overload: 0xd8f4ff, glacierwave: 0xffffff, growth: 0xb8ff8a, abyss: 0x8a5cff,
  sandstorm: 0xfff0c8, hurricane: 0xe0f8ff, blizzard: 0xffffff, pollen: 0xf0ff9a,
  spectral: 0xffffff, earthquake: 0xf3d08a, crystal: 0xffffff, guardian: 0xd8ff8a,
  abyssalprison: 0xb06bff, polar: 0xffffff, vital: 0xd8ffb8, shadowbolt: 0x6a2bd6,
  glacial: 0xffffff, frostmist: 0xe0d8ff, cursed: 0xb06bff, poison: 0xd8ff9a,
};

function accentColor(key, fallback = 0xffffff) {
  return ACCENTS[key] || fallback;
}

const PROJECTILE_COLORS = {
  fireball: 0xff7b34,
  abyssflame: 0x9a3bff,
  jet: 0x53c9ff,
  gust: 0xa8ffe0,
  windblade: 0xd6fff2,
  rock: 0xc08a4a,
  icelance: 0xbfefff,
  shadowbolt: 0x9a6bff,
  waterprison: 0x63d9ff,
};

// ------------------------------------------------------------------ partículas

class ParticlePool {
  constructor(scene, max = 700) {
    this.max = max;
    // Multiplicador de densidad de partículas (panel de administrador).
    this.intensity = 1;
    this.particles = [];
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (330.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float falloff = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, vAlpha * falloff);
        }
      `,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.geometry = geometry;
    scene.add(this.points);
  }

  emit(x, y, z, color, options = {}) {
    if (this.intensity <= 0.01) return;
    if (this.particles.length >= this.max) this.particles.shift();
    const life = options.life ?? 0.7;
    this.particles.push({
      x, y, z,
      vx: options.vx ?? (Math.random() - 0.5) * 4,
      vy: options.vy ?? Math.random() * 4 + 1,
      vz: options.vz ?? (Math.random() - 0.5) * 4,
      gravity: options.gravity ?? 9,
      drag: options.drag ?? 1.4,
      life,
      maxLife: life,
      size: options.size ?? 5,
      color: new THREE.Color(color),
    });
  }

  burst(x, groundY, z, color, count = 12, options = {}) {
    const total = Math.max(0, Math.round(count * this.intensity));
    for (let i = 0; i < total; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (options.speed ?? 7) * (0.35 + Math.random());
      this.emit(x, groundY + (options.height ?? 1.6), z, color, {
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: (options.up ?? 4) * (0.3 + Math.random()),
        life: (options.life ?? 0.75) * (0.6 + Math.random() * 0.7),
        size: (options.size ?? 5) * (0.7 + Math.random() * 0.8),
        gravity: options.gravity ?? 8,
      });
    }
  }

  update(dt) {
    const particles = this.particles;
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= p.gravity * dt;
      p.vx *= Math.max(0, 1 - p.drag * dt);
      p.vz *= Math.max(0, 1 - p.drag * dt);
      const t = Math.max(0, Math.min(1, p.life / p.maxLife));
      this.positions[write * 3] = p.x;
      this.positions[write * 3 + 1] = p.y;
      this.positions[write * 3 + 2] = p.z;
      this.colors[write * 3] = p.color.r;
      this.colors[write * 3 + 1] = p.color.g;
      this.colors[write * 3 + 2] = p.color.b;
      this.sizes[write] = p.size * (0.55 + t * 0.75);
      this.alphas[write] = t * 0.95;
      particles[write] = p;
      write++;
    }
    particles.length = write;
    this.geometry.setDrawRange(0, write);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------ utilidades

const ringGeometry = new THREE.RingGeometry(0.9, 1.0, 56);
ringGeometry.rotateX(-Math.PI / 2);

function makeRingMaterial(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

const glowMaterialCache = new Map();
function glowMaterial(color) {
  if (glowMaterialCache.has(color)) return glowMaterialCache.get(color);
  const material = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.9,
  });
  glowMaterialCache.set(color, material);
  return material;
}

// Cortina de fuego: lenguas que suben y se mecen, con el núcleo blanco abajo
// y la punta roja arriba.
function flameMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float x = vUv.x;
        float h = vUv.y;
        // Cada lengua se mece a su ritmo y sube por separado.
        float sway = sin(x * 34.0 + sin(uTime * 1.3 + x * 12.0) * 2.4 + uTime * 1.1) * 0.5 + 0.5;
        float rise = sin(h * 9.0 - uTime * 3.6 + sway * 3.2) * 0.5 + 0.5;
        float tongue = pow(sway * 0.55 + rise * 0.45, 1.7);
        float heat = (1.0 - h) * 1.15 + tongue * 0.45 - 0.28;
        // Altura irregular: cada columna de fuego acaba a distinta altura y los
        // extremos del muro se desvanecen en vez de cortarse en seco.
        float edge = 0.78 + sin(x * 21.0 + uTime * 1.7) * 0.14 + sin(x * 47.0 - uTime * 2.3) * 0.07;
        float side = smoothstep(0.0, 0.07, x) * smoothstep(1.0, 0.93, x);
        float alpha = smoothstep(0.12, 0.62, heat) * smoothstep(edge, edge - 0.3, h) * side;
        vec3 tip = vec3(0.72, 0.12, 0.03);
        vec3 mid = vec3(1.0, 0.5, 0.12);
        vec3 core = vec3(1.0, 0.95, 0.72);
        vec3 color = mix(tip, mid, smoothstep(0.12, 0.6, heat));
        color = mix(color, core, smoothstep(0.62, 0.95, heat));
        gl_FragColor = vec4(color, alpha * 0.9);
      }
    `,
  });
}

// Textura de remolino: brazos espirales que, tintados y girando, hacen de
// polvo levantado en la base del tornado.
let swirlTextureCache = null;
function swirlTexture() {
  if (swirlTextureCache) return swirlTextureCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 6; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const angle = (arm / 6) * Math.PI * 2 + t * 3.6;
      const radius = 6 + t * 116;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  swirlTextureCache = new THREE.CanvasTexture(canvas);
  return swirlTextureCache;
}

// Degradado radial para los discos de suelo: se apagan hacia el borde en vez
// de dejar un contorno duro de «plato».
let softDiscCache = null;
function softDiscTexture() {
  if (softDiscCache) return softDiscCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  softDiscCache = new THREE.CanvasTexture(canvas);
  return softDiscCache;
}

// Embudo: cilindro cónico que se retuerce desde la base y sube en vetas. Cada
// capa gira a su propia velocidad para que el remolino no parezca un tubo.
function funnelMaterial(color, opacity, speed) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uSpeed: { value: speed },
      uRadius: { value: 40 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uRadius;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vUv = uv;
        vec3 p = position;
        float h = uv.y;
        // La parte alta se mece como una serpentina; la base queda clavada.
        float wobble = sin(uTime * 1.15 + h * 3.4) * 0.5 + sin(uTime * 0.63 + h * 1.9) * 0.5;
        p.x += wobble * uRadius * 0.11 * pow(h, 1.5);
        p.z += cos(uTime * 0.92 + h * 2.7) * uRadius * 0.09 * pow(h, 1.5);
        // Anillos de aire que suben por la pared del embudo.
        float angle = atan(p.z, p.x);
        float ripple = sin(angle * 5.0 + uTime * uSpeed * 1.6 + h * 14.0);
        float swell = 1.0 + ripple * 0.04 * (1.0 - h * 0.35);
        p.xz = p.xz * swell;
        p.y += sin(angle * 3.0 + uTime * 5.0) * 1.6 * (1.0 - h);
        vShade = ripple;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uFade;
      uniform float uSpeed;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        float h = vUv.y;
        // Vetas alargadas que trepan girando: polvo y agua en suspensión.
        // Frecuencias múltiplo de 2π para que la costura de la costura del
        // cilindro no se vea.
        float swirl = vUv.x * 94.2478 + uTime * uSpeed * 2.4 + h * 9.0;
        float streak = pow(sin(swirl) * 0.5 + 0.5, 2.4);
        float fine = sin(vUv.x * 188.4956 - uTime * uSpeed * 5.5 + h * 46.0) * 0.5 + 0.5;
        float density = streak * (0.5 + fine * 0.5) + vShade * 0.04;
        float fade = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.42, h);
        float alpha = uOpacity * uFade * fade * (0.18 + density * 0.82);
        vec3 color = mix(uColor, vec3(1.0), density * 0.4);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

// ------------------------------------------------------------------ efectos

export class EffectsView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.particles = new ParticlePool(scene, 760);
    this.rings = [];
    this.flashes = [];
    this.projectiles = new Map();
    this.zones = new Map();
    this.castGlows = [];
    this.bolts = [];
    this.projectileScale = 1;
    this.puffs = [];
    this.decals = [];
    this.lights = [];
    this.lightCursor = 0;
    // Presupuesto fijo: tres luces se reutilizan entre todos los hechizos.
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 300, 2);
      light.visible = false;
      this.group.add(light);
      this.lights.push({ light, life: 0, max: 1, power: 0 });
    }
  }

  flashLight(x, y, z, color, power = 70, life = 0.28) {
    let slot = this.lights[0];
    for (const candidate of this.lights) {
      if (candidate.life < slot.life) slot = candidate;
    }
    slot.light.position.set(x, y, z);
    slot.light.color.set(color);
    slot.light.distance = 260;
    slot.power = power;
    slot.max = life;
    slot.life = life;
    slot.light.intensity = power;
    slot.light.visible = true;
  }

  addPuff(x, y, z, color, size = 8, life = 1.2, options = {}) {
    if (this.puffs.length >= 70) {
      const old = this.puffs.shift();
      this.group.remove(old.sprite);
      old.sprite.material.dispose();
    }
    const sprite = smokeSprite(color, options.opacity ?? 0.3, size);
    sprite.position.set(x, y, z);
    this.group.add(sprite);
    this.puffs.push({
      sprite,
      life,
      maxLife: life,
      size,
      grow: options.grow ?? 1.4,
      opacity: options.opacity ?? 0.3,
      drag: options.drag ?? 0.7,
      vel: new THREE.Vector3(options.vx ?? 0, options.vy ?? 2, options.vz ?? 0),
    });
  }

  addScorch(x, z, radius, style = 'fire') {
    const decal = groundDecal(style, radius, { opacity: 0.9 });
    const floor = this.ground(x, z) + 0.08;
    decal.position.set(x, floor, z);
    decal.traverse((node) => {
      if (node.material) node.material.userData.baseOpacity = node.material.opacity;
    });
    this.group.add(decal);
    this.decals.push({ group: decal, life: 9, maxLife: 9 });
    if (this.decals.length > 18) {
      const old = this.decals.shift();
      this.group.remove(old.group);
      old.group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    }
  }

  ground(x, z) {
    return this.world.heightAt(x, z);
  }

  addRing(x, z, color, maxRadius, life = 0.55, width = 1.0, y = null) {
    const material = makeRingMaterial(color, 0.9);
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.position.set(x, y == null ? this.ground(x, z) + 0.25 : y, z);
    mesh.scale.setScalar(2);
    this.group.add(mesh);
    this.rings.push({ mesh, material, life, maxLife: life, maxRadius, width });
  }

  // Línea aditiva para rayos, cadenas y estelas instantáneas.
  addLine(points, color, life = 0.22) {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, this.ground(p.x, p.z) + 2.4, p.z))
    );
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.Line(geometry, material);
    this.group.add(line);
    this.bolts.push({ line, material, life, maxLife: life });
  }

  addFlash(x, z, color, radius, life = 0.35) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
    mesh.position.set(x, this.ground(x, z) + radius * 0.5, z);
    mesh.scale.setScalar(radius * 0.35);
    this.group.add(mesh);
    this.flashLight(x, this.ground(x, z) + radius * 0.45, z, color, Math.min(140, radius * 2), life * 1.6);
    this.flashes.push({ mesh, material, life, maxLife: life, radius });
  }

  processFx(fxList) {
    for (const fx of fxList) {
      const color = fx.c ? fx.c : elementColor(fx.el, 0xffffff);
      const y = fx.x !== undefined ? this.ground(fx.x, fx.z) : 0;
      switch (fx.k) {
        case 'cast': {
          // Destello de lanzamiento con el carácter de cada elemento: el fuego
          // sube, el agua salpica, el viento gira y la tierra se abre.
          this.particles.burst(fx.x, y, fx.z, color, 7, { speed: 3.5, up: 2.5, life: 0.5, size: 3.5 });
          this.addRing(fx.x, fx.z, color, fx.el === 'earth' ? 46 : 34, 0.3);
          const gravity =
            fx.el === 'fire' ? -3
              : fx.el === 'water' ? 11
                : fx.el === 'wind' ? -1
                  : fx.el === 'lightning' ? -4
                    : fx.el === 'ice' ? 7
                      : fx.el === 'nature' ? 2
                        : fx.el === 'dark' ? -2 : 9;
          const spread = fx.el === 'wind' ? 9 : 4.5;
          for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            this.particles.emit(fx.x, y + 1.6, fx.z, color, {
              vx: Math.cos(angle) * spread,
              vz: Math.sin(angle) * spread,
              vy: 2 + Math.random() * 3,
              gravity,
              drag: 0.9,
              life: 0.55,
              size: 3,
            });
          }
          break;
        }
        case 'boom': {
          const radius = fx.r || 60;
          this.addRing(fx.x, fx.z, color, radius, 0.5);
          this.addFlash(fx.x, fx.z, color, radius, 0.3);
          this.addScorch(fx.x, fx.z, radius * 0.8, fx.el || 'fire');
          const smokeTint = fx.el === 'water' || fx.el === 'ice' ? 0x9fb4c0
            : fx.el === 'earth' ? 0x4a3a28
              : fx.el === 'dark' ? 0x241436 : 0x2a2018;
          for (let i = 0; i < 4; i++) {
            this.addPuff(
              fx.x + (Math.random() - 0.5) * radius * 0.7,
              y + 2 + Math.random() * 4,
              fx.z + (Math.random() - 0.5) * radius * 0.7,
              smokeTint,
              radius * (0.22 + Math.random() * 0.16),
              1.1 + Math.random() * 0.7,
              { vy: 3 + Math.random() * 3, opacity: 0.36, grow: 1.9 }
            );
          }
          this.particles.burst(fx.x, y, fx.z, color, 22, { speed: 12, up: 8, life: 0.9, size: 6 });
          this.particles.burst(fx.x, y, fx.z, 0x2b2118, 8, { speed: 5, up: 2, life: 1.2, size: 8, gravity: 4 });
          // Esquirlas con peso: caen, rebotan y se quedan en el suelo.
          this.particles.burst(fx.x, y, fx.z, 0x3a2a1c, 10, { speed: 17, up: 15, life: 1.2, size: 3.2, gravity: 30 });
          break;
        }
        case 'hit':
          this.particles.burst(fx.x, y, fx.z, COLORS.hit, 6, { speed: 4, up: 3, life: 0.42, size: 3.6 });
          break;
        case 'death':
          this.addRing(fx.x, fx.z, 0xff5d72, 70, 0.8);
          this.addFlash(fx.x, fx.z, 0xff5d72, 60, 0.5);
          this.particles.burst(fx.x, y, fx.z, 0xff6b7d, 26, { speed: 9, up: 7, life: 1.2, size: 6 });
          this.particles.burst(fx.x, y, fx.z, 0xffffff, 10, { speed: 4, up: 9, life: 1.5, size: 3 });
          for (let i = 0; i < 3; i++) {
            this.addPuff(fx.x + (Math.random() - 0.5) * 10, y + 3, fx.z + (Math.random() - 0.5) * 10, 0x3a2030, 16, 1.4, { vy: 4, opacity: 0.32 });
          }
          break;
        case 'quake':
          this.addRing(fx.x, fx.z, 0xc08a4a, fx.r || 170, 0.85);
          this.addRing(fx.x, fx.z, 0xf3d08a, (fx.r || 170) * 0.7, 0.6);
          this.addScorch(fx.x, fx.z, (fx.r || 170) * 0.85, 'earth');
          this.addPuff(fx.x, y + 2, fx.z, 0x6a5638, (fx.r || 170) * 0.4, 1.6, { vy: 2.4, opacity: 0.4, grow: 2.2 });
          this.particles.burst(fx.x, y, fx.z, 0x8a6a44, 24, { speed: 14, up: 4, life: 1.0, size: 5, gravity: 14 });
          // Lascas de piedra que saltan del suelo.
          this.particles.burst(fx.x, y, fx.z, 0xd2a05f, 14, { speed: 20, up: 13, life: 0.9, size: 4, gravity: 24 });
          break;
        case 'splash':
          this.particles.burst(fx.x, y, fx.z, COLORS.water, 12, { speed: 7, up: 6, life: 0.7, size: 4.5 });
          this.addRing(fx.x, fx.z, 0x63d9ff, 34, 0.4);
          break;
        case 'dust':
          this.particles.burst(fx.x, y, fx.z, COLORS.earth, 10, { speed: 5, up: 3, life: 0.8, size: 5, gravity: 6 });
          break;
        case 'gust':
          this.particles.burst(fx.x, y, fx.z, COLORS.wind, 12, { speed: 8, up: 2, life: 0.5, size: 4 });
          break;
        case 'heal':
          this.particles.burst(fx.x, y, fx.z, COLORS.heal, 16, { speed: 3, up: 9, life: 1.1, size: 4, gravity: -2 });
          this.addRing(fx.x, fx.z, 0x7bffcf, 34, 0.6);
          break;
        case 'pickup':
          this.particles.burst(fx.x, y, fx.z, elementColor(fx.el, 0xffffff), 14, { speed: 4, up: 7, life: 0.9, size: 4.5 });
          this.addRing(fx.x, fx.z, elementColor(fx.el, 0xffffff), 30, 0.55);
          break;
        case 'combo':
          this.addRing(fx.x, fx.z, 0xf3c96b, 120, 1.1);
          this.addFlash(fx.x, fx.z, 0xf3c96b, 60, 0.4);
          this.addScorch(fx.x, fx.z, 74, 'plasma');
          for (let i = 0; i < 4; i++) {
            this.addPuff(fx.x + (Math.random() - 0.5) * 30, y + 3 + Math.random() * 8, fx.z + (Math.random() - 0.5) * 30, 0x3a2a4a, 18, 1.6, { vy: 4, opacity: 0.3, grow: 2 });
          }
          this.particles.burst(fx.x, y, fx.z, 0xf3c96b, 20, { speed: 9, up: 8, life: 1.1, size: 5 });
          break;
        case 'swirl':
          this.particles.emit(
            fx.x + (Math.random() - 0.5) * 20,
            this.ground(fx.x, fx.z) + Math.random() * 5,
            fx.z + (Math.random() - 0.5) * 20,
            elementColor(fx.style, 0xcbb4ff),
            { vx: (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.6, size: 4 }
          );
          break;
        case 'beam':
          this.addLine([{ x: fx.x, z: fx.z }, { x: fx.x2, z: fx.z2 }], color, 0.28);
          this.addFlash(fx.x2, fx.z2, color, 28, 0.22);
          this.particles.burst(fx.x2, this.ground(fx.x2, fx.z2), fx.z2, color, 10, { speed: 10, up: 6, life: 0.5, size: 3.6 });
          break;
        case 'chain': {
          const points = fx.pts || [];
          for (let i = 1; i < points.length; i++) this.addLine([points[i - 1], points[i]], 0xe6e0ff, 0.26);
          const last = points[points.length - 1];
          if (last) this.addFlash(last.x, last.z, 0xc8bcff, 32, 0.2);
          break;
        }
        case 'dash':
          this.addRing(fx.x, fx.z, color, 40, 0.4);
          this.addRing(fx.x2, fx.z2, color, 55, 0.5);
          this.particles.burst(fx.x2, this.ground(fx.x2, fx.z2), fx.z2, color, 14, { speed: 8, up: 6, life: 0.6, size: 4 });
          break;
        case 'spikes':
          this.addRing(fx.x, fx.z, color, fx.r || 150, 0.55);
          this.particles.burst(fx.x, this.ground(fx.x, fx.z), fx.z, color, 18, { speed: 12, up: 8, life: 0.8, size: 5 });
          break;
        case 'geyser':
          this.addRing(fx.x, fx.z, 0x9fe8ff, fx.r || 90, 0.5);
          this.particles.burst(fx.x, this.ground(fx.x, fx.z), fx.z, 0xbdf0ff, 20, { speed: 5, up: 16, life: 1.0, size: 5, gravity: 18 });
          break;
        case 'summonHit':
          this.particles.burst(fx.x, this.ground(fx.x, fx.z), fx.z, color, 10, { speed: 6, up: 5, life: 0.5, size: 4 });
          break;
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------- proyectiles

  createProjectile(p) {
    const color = PROJECTILE_COLORS[p.k] || COLORS.fire;
    const group = new THREE.Group();
    let material;
    const ownedMaterials = [];
    const ownedShaders = [];
    const own = (mat) => {
      ownedMaterials.push(mat);
      return mat;
    };
    if (p.k === 'rock') {
      // Peñasco PBR con vetas, esquirlas y polvo real en la estela.
      material = own(stoneMaterial(0x8a7356));
      const mesh = new THREE.Mesh(rockGeometry(1.25, 1), material);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(mesh);
      const chip = new THREE.Mesh(rockGeometry(0.5, 0), material);
      chip.position.set(0.75, 0.45, -0.55);
      chip.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(chip);
      const haze = smokeSprite(0x8d7a5d, 0.26, 5.5);
      own(haze.material);
      group.add(haze);
    } else if (p.k === 'gust' || p.k === 'windblade') {
      // Dos cuchillas de aire comprimido con vetas en movimiento.
      material = own(energyMaterial(0xccfff0, { density: 0.85, speed: 14 }));
      const blade = new THREE.Mesh(new THREE.RingGeometry(1.7, 3.0, 30, 1, 0.25, Math.PI * 1.1), material);
      blade.rotation.x = -Math.PI / 2;
      group.add(blade);
      const blade2 = new THREE.Mesh(new THREE.RingGeometry(1.2, 2.1, 22, 1, 0.5, Math.PI * 0.8), material);
      blade2.rotation.x = -Math.PI / 2;
      blade2.position.y = 0.5;
      group.add(blade2);
      ownedShaders.push(material);
      const haze = smokeSprite(0xd8fff2, 0.18, 6);
      own(haze.material);
      group.add(haze);
    } else if (p.k === 'icelance') {
      // Racimo de cristales con caras físicas y bruma helada.
      material = own(crystalMaterial(0xc8f4ff));
      const shards = [
        { r: 0.65, h: 6.4, z: 0.2 },
        { r: 0.42, h: 4.6, z: -1.0 },
        { r: 0.34, h: 3.6, z: 1.0 },
      ];
      for (const shard of shards) {
        const mesh = new THREE.Mesh(crystalShard(shard.r, shard.h), material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, shard.z);
        group.add(mesh);
      }
      const haze = smokeSprite(0xbfefff, 0.22, 5);
      own(haze.material);
      group.add(haze);
    } else if (p.k === 'shadowbolt') {
      material = own(new THREE.MeshStandardMaterial({
        color: 0x0a0512,
        roughness: 0.6,
        metalness: 0.15,
        emissive: 0x2a0a4a,
        emissiveIntensity: 1.2,
      }));
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), material));
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 2), own(darkMaterial(0x0a0512, 0xa45cff)));
      group.add(shell);
      ownedShaders.push(shell.material);
      const wisp = smokeSprite(0x3a1054, 0.3, 8);
      wisp.position.y = -0.5;
      own(wisp.material);
      group.add(wisp);
    } else if (p.k === 'waterprison') {
      material = own(waterMaterial(0x0d4f78, 0xbfefff));
      group.add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), material));
      ownedShaders.push(material);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.12, 16, 12), own(waterMaterial(0x062a44, 0x9fe8ff)));
      group.add(core);
      ownedShaders.push(core.material);
      const ringMaterial = own(energyMaterial(0xbdf0ff, { density: 0.45, speed: 5 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 8, 32), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      ownedShaders.push(ringMaterial);
      const dropMaterial = own(new THREE.MeshStandardMaterial({
        color: 0xd8f8ff,
        emissive: 0x3a9ac0,
        emissiveIntensity: 0.6,
        roughness: 0.08,
        metalness: 0,
      }));
      for (let i = 0; i < 6; i++) {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), dropMaterial);
        const angle = (i / 6) * Math.PI * 2;
        drop.position.set(Math.cos(angle) * 2.15, Math.sin(angle * 2) * 0.7, Math.sin(angle) * 2.15);
        group.add(drop);
      }
    } else if (p.k === 'jet') {
      material = own(waterMaterial(0x0b4a70, 0xbfefff));
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 1.05, 7, 14, 10, true), material);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = 0.8;
      group.add(mesh);
      ownedShaders.push(material);
      const haze = smokeSprite(0xbfefff, 0.2, 4.8);
      own(haze.material);
      group.add(haze);
    } else if (p.k === 'fireball' || p.k === 'lavabolt' || p.k === 'abyssflame') {
      // Núcleo incandescente + dos cáscaras de fuego volumétrico + lenguas.
      const dark = p.k === 'abyssflame';
      const inner = dark ? 0xd0a8ff : p.k === 'lavabolt' ? 0xffb15a : 0xffe6b0;
      const outer = dark ? 0x5a1690 : p.k === 'lavabolt' ? 0xff5a12 : 0xff4a0c;
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(p.k === 'lavabolt' ? 0.95 : 0.8, 2),
        own(new THREE.MeshStandardMaterial({
          color: dark ? 0x180628 : 0x3a1206,
          emissive: inner,
          emissiveIntensity: 2.8,
          roughness: 0.4,
          metalness: 0.05,
          flatShading: true,
        }))
      );
      group.add(core);
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 2), own(fireShellMaterial(inner, outer)));
      shell.material.uniforms.uRadius.value = 1.55;
      group.add(shell);
      ownedShaders.push(shell.material);
      const innerShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 1), own(fireShellMaterial(0xffffff, inner)));
      innerShell.material.uniforms.uRadius.value = 1.02;
      group.add(innerShell);
      ownedShaders.push(innerShell.material);
      const tongues = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const tongue = new THREE.Mesh(
          new THREE.ConeGeometry(0.34, 1.9, 5, 1, true),
          own(fireShellMaterial(inner, outer))
        );
        tongue.material.uniforms.uRadius.value = 0.8;
        tongue.position.set(Math.cos(angle) * 1.2, Math.sin(angle) * 0.35, Math.sin(angle) * 1.2);
        tongue.lookAt(Math.cos(angle) * 3.4, Math.sin(angle) * 1.2, Math.sin(angle) * 3.4);
        tongue.rotateX(Math.PI / 2);
        group.add(tongue);
        ownedShaders.push(tongue.material);
        tongues.push({ mesh: tongue, phase: i * 1.1 });
      }
      material = shell.material;
      const smoke = smokeSprite(dark ? 0x2a1044 : 0x241610, 0.3, 5.5);
      smoke.position.y = -1.3;
      own(smoke.material);
      group.add(smoke);
      group.userData.tongues = tongues;
    } else {
      material = own(new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.1,
      }));
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 2), material));
      const sprite = new THREE.Sprite(glowMaterial(color));
      sprite.scale.setScalar(4.6);
      group.add(sprite);
    }
    group.scale.setScalar(this.projectileScale);
    const holder = {
      group,
      material,
      materials: ownedMaterials,
      shaders: ownedShaders,
      kind: p.k,
      x: p.x,
      z: p.z,
      dx: p.dx,
      dz: p.dz,
      trail: 0,
      age: 0,
      smoke: 0,
    };
    group.position.set(p.x, this.ground(p.x, p.z) + 2.3, p.z);
    this.group.add(group);
    this.projectiles.set(p.id, holder);
    return holder;
  }

  syncProjectiles(list, dt) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let holder = this.projectiles.get(p.id);
      if (!holder) holder = this.createProjectile(p);
      holder.age = (holder.age || 0) + dt;
      if (holder.shaders) {
        for (const shader of holder.shaders) {
          if (shader.uniforms && shader.uniforms.uTime) shader.uniforms.uTime.value += dt;
        }
      }
      if (holder.group.userData.tongues) {
        for (const tongue of holder.group.userData.tongues) {
          tongue.mesh.scale.set(1, 0.8 + Math.sin(holder.age * 12 + tongue.phase) * 0.35, 1);
        }
      }
      const lerp = Math.min(1, dt * 28);
      holder.x += (p.x - holder.x) * lerp;
      holder.z += (p.z - holder.z) * lerp;
      holder.dx = p.dx;
      holder.dz = p.dz;
      const y = this.ground(holder.x, holder.z) + 2.3;
      holder.group.position.set(holder.x, y, holder.z);
      if (holder.kind === 'jet' || holder.kind === 'icelance') {
        holder.group.lookAt(holder.x + p.dx, y, holder.z + p.dz);
      } else if (holder.kind === 'gust' || holder.kind === 'windblade') {
        holder.group.rotation.y += dt * 14;
      } else if (holder.kind === 'waterprison') {
        holder.group.rotation.y += dt * 4;
      } else if (holder.kind === 'rock') {
        holder.group.rotation.x += dt * 6;
        holder.group.rotation.y += dt * 5;
      }
      holder.trail -= dt;
      if (holder.trail <= 0) {
        holder.trail = 0.035;
        const color =
          holder.kind === 'lavabolt' || holder.kind === 'fireball'
            ? 0xffc46b
            : holder.kind === 'abyssflame'
              ? 0xb06bff
              : holder.kind === 'icelance'
                ? 0xd8f8ff
                : holder.kind === 'shadowbolt'
                  ? 0x9a5cff
                  : holder.kind === 'jet' || holder.kind === 'waterprison'
                    ? 0x9ae8ff
                    : holder.kind === 'gust' || holder.kind === 'windblade'
                      ? 0xccfff0
                      : 0xb59c7d;
        this.particles.emit(holder.x, y, holder.z, color, {
          vx: (Math.random() - 0.5) * 2,
          vy: 1 + Math.random() * 2,
          vz: (Math.random() - 0.5) * 2,
          life: 0.45,
          size: 3.5 * this.projectileScale,
        });
      }
      // Humo y polvo volumétricos, más espaciados que las chispas.
      holder.smoke -= dt;
      if (holder.smoke <= 0) {
        holder.smoke = holder.kind === 'rock' ? 0.1 : holder.kind === 'jet' || holder.kind === 'waterprison' ? 0.12 : 0.16;
        if (holder.kind === 'fireball' || holder.kind === 'lavabolt' || holder.kind === 'abyssflame') {
          this.addPuff(holder.x, y + 0.6, holder.z, 0x2a1a14, 3.8, 0.55, { vy: 1.2, opacity: 0.2, grow: 2.4 });
        } else if (holder.kind === 'rock') {
          this.addPuff(holder.x, y - 0.4, holder.z, 0x7a6448, 3.6, 0.7, { vy: 0.5, opacity: 0.22, grow: 2 });
        } else if (holder.kind === 'icelance') {
          this.addPuff(holder.x, y, holder.z, 0xbfefff, 3.2, 0.6, { vy: 0.8, opacity: 0.16, grow: 1.8 });
        } else if (holder.kind === 'jet' || holder.kind === 'waterprison') {
          this.addPuff(holder.x, y + 0.4, holder.z, 0x9fdcff, 3.8, 0.55, { vy: 1, opacity: 0.16, grow: 1.8 });
        } else if (holder.kind === 'shadowbolt' || holder.kind === 'abyssflame') {
          this.addPuff(holder.x, y, holder.z, 0x3a1054, 4.2, 0.6, { vy: 0.8, opacity: 0.2, grow: 2 });
        }
      }
    }
    for (const [id, holder] of this.projectiles) {
      if (seen.has(id)) continue;
      this.group.remove(holder.group);
      holder.group.traverse((object) => {
        if (object.geometry && !object.isSprite) object.geometry.dispose();
      });
      if (holder.materials) holder.materials.forEach((mat) => mat.dispose());
      else if (holder.material) holder.material.dispose();
      this.projectiles.delete(id);
    }
  }

  // -------------------------------------------------------------- zonas

  createZone(zone) {
    const group = new THREE.Group();
    const color = elementColor(zone.s, 0xffffff);
    const y = this.ground(zone.x, zone.z);
    const holder = { group, zone, color, y, particles: 0, materials: [], geometries: [], meshes: [] };

    const add = (object) => {
      group.add(object);
      object.traverse((node) => {
        if (!node.isMesh && !node.isSprite && !node.isLine) return;
        holder.meshes.push(node);
        if (node.material) holder.materials.push(node.material);
        // La geometría de los sprites es compartida por Three: no se libera.
        if (node.geometry && !node.isSprite) holder.geometries.push(node.geometry);
      });
      return object;
    };

    const flatDisc = (radius, discColor, opacity = 0.5, additive = true) => {
      const geometry = new THREE.CircleGeometry(1, 40);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        map: softDiscTexture(),
        color: discColor,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = 0.18;
      mesh.scale.setScalar(radius);
      return add(mesh);
    };

    switch (zone.t) {
      case 'lava': {
        const dark = zone.s === 'dark';
        // Corteza negra agrietada con vetas incandescentes, no dos discos.
        add(groundDecal(dark ? 'dark' : 'magma', zone.r));
        add(crackGlow(zone.r * 0.88, dark ? 0xb06bff : 0xff7a24, 0.55));
        holder.disc = flatDisc(zone.r, dark ? 0x6a1a9a : 0xff4a12, 0.16, false);
        holder.bubbles = 0;
        break;
      }
      case 'wall': {
        const width = zone.w || 155;
        const style = zone.s || 'fire';
        // Muros no ígneos: bloques de piedra, agujas de hielo o una maraña de
        // raíces. Comparten forma de fila para que se lean como barrera.
        if (style !== 'fire') {
          const icy = style === 'ice';
          const stone = style === 'stone';
          const blockColor = stone ? 0x8a7a62 : icy ? 0xbfefff : 0x4f8f46;
          const count = 8;
          const step = width / count;
          for (let i = 0; i < count; i++) {
            const offset = -width / 2 + step * (i + 0.5);
            const height = 22 + (i % 3) * 8 + Math.random() * 5;
            const geometry = icy
              ? crystalShard(step * 0.34, height)
              : stone
                ? stoneBlockGeometry(step * 0.94, height, 14)
                : rootGeometry(height, step * 0.14);
            const material = icy
              ? crystalMaterial(blockColor)
              : stone
                ? stoneMaterial(blockColor)
                : barkMaterial(0x4f3a22);
            const block = new THREE.Mesh(geometry, material);
            block.position.set(-zone.dz * offset, icy || stone ? height * 0.5 : 0, zone.dx * offset);
            block.rotation.y = Math.atan2(zone.dx, zone.dz);
            if (!icy && !stone) block.rotation.z = (Math.random() - 0.5) * 0.25;
            add(block);
          }
          // Escombros y nieve al pie del muro: le dan asiento en el terreno.
          if (stone) {
            for (let i = 0; i < 7; i++) {
              const rubble = new THREE.Mesh(rockGeometry(3 + Math.random() * 3, 0), stoneMaterial(0x6a5a46));
              rubble.position.set((Math.random() - 0.5) * width, 1.5, (Math.random() - 0.5) * 18);
              add(rubble);
            }
          }
          break;
        }
        // Dos cortinas superpuestas: la de delante más alta y una detrás más
        // baja y desplazada, para que el muro tenga fondo.
        holder.shaders = [];
        holder.embers = 0;
        const front = flameMaterial();
        const frontMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 11), front);
        frontMesh.position.y = 5.4;
        frontMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(zone.dx, 0, zone.dz));
        add(frontMesh);
        holder.shaders.push(front);

        const back = flameMaterial();
        const backMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 8), back);
        backMesh.position.set(-zone.dx * 3.5, 3.8, -zone.dz * 3.5);
        backMesh.quaternion.copy(frontMesh.quaternion);
        add(backMesh);
        holder.shaders.push(back);
        break;
      }
      case 'wave': {
        const width = zone.w || 200;
        const material = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: { uTime: { value: 0 }, uIce: { value: zone.s === 'ice' ? 1 : 0 } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uIce;
            varying vec2 vUv;
            void main() {
              float x = vUv.x;
              float h = vUv.y;
              // Perfil irregular de la cresta y espuma justo debajo de ella.
              float crest = 0.8 + sin(x * 11.0 + uTime * 1.1) * 0.1 + sin(x * 31.0 - uTime * 2.2) * 0.05;
              float band = sin(x * 16.0 + h * 7.0 - uTime * 4.0) * 0.5 + 0.5;
              float foam = smoothstep(crest - 0.22, crest, h);
              vec3 deep = mix(vec3(0.04, 0.26, 0.46), vec3(0.08, 0.34, 0.44), uIce);
              vec3 shallow = mix(vec3(0.32, 0.78, 0.98), vec3(0.78, 0.96, 1.0), uIce);
              vec3 color = mix(deep, shallow, h * 0.9 + band * 0.15);
              color = mix(color, vec3(1.0), foam * 0.8 + band * 0.08);
              float side = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.92, x);
              float alpha = (0.6 + band * 0.2) * smoothstep(crest, crest - 0.3, h) * side;
              gl_FragColor = vec4(color, alpha);
            }
          `,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 12), material);
        mesh.position.y = 5.6;
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(zone.dx, 0, zone.dz));
        add(mesh);
        holder.shader = material;
        holder.spray = 0;
        flatDisc(width * 0.4, 0x7fe8ff, 0.2);
        break;
      }
      case 'tornado': {
        const style = zone.s || 'wind';
        const fire = style === 'fire';
        const storm = style === 'storm';
        const abyss = style === 'abyss';
        const inner = fire ? 0xff9142 : storm ? 0xe0d4ff : abyss ? 0x9a6bff : 0xd6fff2;
        const outer = fire ? 0xff4d16 : storm ? 0x8a6cff : abyss ? 0x3a1260 : 0x5fd7b6;
        const pull = zone.r || 95;
        const base = Math.max(7, pull * 0.24);
        const top = Math.max(18, pull * 0.66);
        const height = Math.max(64, pull * 1.4);

        holder.shaders = [];
        holder.base = base;
        holder.fire = fire;
        holder.debris = 0;
        holder.spin = 0;

        // Núcleo denso y estrecho, más una pared exterior ancha y difusa que
        // gira en sentido contrario.
        const layers = [
          {
            color: inner,
            opacity: 0.62,
            speed: 3.4,
            geometry: new THREE.CylinderGeometry(top * 0.45, base * 0.62, height * 0.96, 48, 22, true),
            y: (height * 0.96) / 2,
          },
          {
            color: outer,
            opacity: 0.22,
            speed: -1.9,
            geometry: new THREE.CylinderGeometry(top, base, height, 60, 26, true),
            y: height / 2,
          },
        ];
        for (const layer of layers) {
          const material = funnelMaterial(layer.color, layer.opacity, layer.speed);
          material.uniforms.uRadius.value = pull;
          const mesh = new THREE.Mesh(layer.geometry, material);
          mesh.position.y = layer.y;
          add(mesh);
          holder.shaders.push(material);
        }

        // Polvo levantado en la base, girando con el embudo.
        const dust = new THREE.Mesh(
          new THREE.CircleGeometry(base * 2.6, 32),
          new THREE.MeshBasicMaterial({
            map: swirlTexture(),
            color: outer,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          })
        );
        dust.rotation.x = -Math.PI / 2;
        dust.position.y = 0.35;
        add(dust);
        holder.disc = dust;
        break;
      }
      case 'meteor': {
        const material = stoneMaterial(0x3a281e, { emissive: 0x2a0a00, emissiveIntensity: 0.5 });
        const mesh = new THREE.Mesh(rockGeometry(5.4, 1), material);
        mesh.position.y = 70;
        group.add(mesh);
        holder.meteor = mesh;
        const meteorShell = new THREE.Mesh(
          new THREE.IcosahedronGeometry(6.6, 2),
          fireShellMaterial(0xffe0a0, 0xff4a0c)
        );
        meteorShell.material.uniforms.uRadius.value = 6.6;
        mesh.add(meteorShell);
        holder.meteorShaders = [meteorShell.material];
        holder.startD = Math.max(0.001, zone.d || 1);
        // Núcleo brillante más un halo amplio que tiñe el cielo.
        const glow = new THREE.Sprite(glowMaterial(0xffd08a));
        glow.scale.setScalar(52);
        mesh.add(glow);
        const halo = new THREE.Sprite(glowMaterial(0xff5a1a));
        halo.scale.setScalar(96);
        mesh.add(halo);

        // Aviso de impacto: el disco solo era una mancha tenue y no se veía
        // contra el suelo. El anillo doble y la columna de luz marcan el
        // círculo exacto que va a golpear.
        flatDisc(zone.r, 0xff5d22, 0.28);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: 0xffb24a,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(zone.r, 2.8, 8, 64), ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.9;
        add(ring);
        holder.warnRing = ring;
        holder.warnMat = ringMaterial;

        const innerMaterial = ringMaterial.clone();
        const inner = new THREE.Mesh(new THREE.TorusGeometry(zone.r * 0.55, 1.6, 6, 48), innerMaterial);
        inner.rotation.x = -Math.PI / 2;
        inner.position.y = 0.9;
        add(inner);
        holder.warnInner = inner;
        holder.warnInnerMat = innerMaterial;

        const beamMaterial = new THREE.MeshBasicMaterial({
          color: 0xff7a2a,
          transparent: true,
          opacity: 0.08,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(zone.r * 0.9, zone.r, 90, 24, 1, true),
          beamMaterial
        );
        beam.position.y = 45;
        add(beam);
        holder.warnBeam = beam;
        holder.warnBeamMat = beamMaterial;
        break;
      }
      case 'mud': {
        // Barro opaco y húmedo: calcomanía de terreno y un velo de agua.
        add(groundDecal('mud', zone.r, { opacity: 1.2 }));
        holder.disc = flatDisc(zone.r * 0.8, 0x6d4f2f, 0.2, false);
        holder.bubbles = 0;
        break;
      }
      case 'steam': {
        add(groundDecal('steam', zone.r));
        // El vapor son jirones sueltos, no una cúpula de cristal: sprites
        // grandes y suaves repartidos por la zona.
        holder.mists = [];
        holder.mistT = 0;
        for (let i = 0; i < 8; i++) {
          const sprite = smokeSprite(0xe6f7ff, 0.18, zone.r * (0.85 + (i % 2) * 0.3));
          const angle = (i / 8) * Math.PI * 2;
          const radius = zone.r * (0.25 + (i % 3) * 0.24);
          sprite.position.set(Math.cos(angle) * radius, 6 + (i % 4) * 3.5, Math.sin(angle) * radius);
          add(sprite);
          holder.mists.push({ sprite, y: sprite.position.y, phase: i * 0.8 });
        }
        break;
      }
      case 'sandstorm': {
        add(groundDecal('sand', zone.r));
        // Pared baja de polvo en giro, más ancha abajo que arriba.
        const material = funnelMaterial(0xe8c98a, 0.26, 1.5);
        material.uniforms.uRadius.value = zone.r;
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(zone.r * 0.98, zone.r * 0.66, 42, 40, 6, true),
          material
        );
        wall.position.y = 21;
        add(wall);
        holder.shaders = [material];
        holder.dirt = 0;
        break;
      }
      case 'storm': {
        const icy = zone.s === 'ice';
        flatDisc(zone.r, icy ? 0x7fe6ff : 0x9b7bff, 0.12);
        // Techo de nube: dos cúpulas achatadas superpuestas. La lluvia son
        // partículas, no una pared de geometría.
        holder.clouds = [];
        const cloudLayers = icy
          ? [
              { r: zone.r * 1.25, y: 175, squash: 0.34, color: 0x2a4a6a, opacity: 0.5 },
              { r: zone.r * 0.85, y: 150, squash: 0.4, color: 0x3a6a8a, opacity: 0.45 },
            ]
          : [
              { r: zone.r * 1.25, y: 175, squash: 0.34, color: 0x241d44, opacity: 0.5 },
              { r: zone.r * 0.85, y: 150, squash: 0.4, color: 0x332a5c, opacity: 0.45 },
            ];
        holder.icy = icy;
        for (const layer of cloudLayers) {
          const material = new THREE.MeshStandardMaterial({
            color: layer.color,
            map: noiseTexture(),
            roughness: 1,
            metalness: 0,
            transparent: true,
            opacity: layer.opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
            envMapIntensity: 0.2,
          });
          const cloud = new THREE.Mesh(
            new THREE.SphereGeometry(layer.r, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.6),
            material
          );
          cloud.scale.set(1, layer.squash, 1);
          cloud.position.y = layer.y;
          add(cloud);
          holder.clouds.push({ material, base: layer.opacity });
        }
        holder.strike = 0.35 + Math.random() * 0.9;
        break;
      }
      case 'field': {
        const style = zone.s || 'earth';
        const main = styleColor(style);
        const accent = accentColor(style);
        holder.style = style;
        add(groundDecal(style, zone.r));
        holder.disc = flatDisc(zone.r, main, 0.1);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(zone.r * 0.72, 2.6, 8, 64),
          new THREE.MeshBasicMaterial({
            color: main,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 1.6;
        add(ring);
        holder.ring = ring;
        const domeStyles = ['dark', 'frost', 'blizzard', 'polar', 'glacial', 'crystal', 'cursed', 'abyss'];
        if (domeStyles.includes(style)) {
          const domeMaterial =
            style === 'dark' || style === 'cursed'
              ? darkMaterial(0x0a0512, 0xb06bff)
              : ['ice', 'crystal', 'frost', 'blizzard', 'polar', 'glacial', 'slippery'].includes(style)
                ? crystalMaterial(main, { opacity: 0.2 })
                : energyMaterial(main, { density: 0.35, speed: 3 });
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(zone.r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
            domeMaterial
          );
          dome.position.y = 0.4;
          add(dome);
          holder.dome = dome;
        }
        holder.mists = [];
        for (let i = 0; i < 6; i++) {
          const sprite = smokeSprite(main, 0.16, zone.r * (0.65 + (i % 2) * 0.2));
          const angle = (i / 6) * Math.PI * 2;
          sprite.position.set(Math.cos(angle) * zone.r * 0.55, 3 + (i % 3) * 2.4, Math.sin(angle) * zone.r * 0.55);
          add(sprite);
          holder.mists.push({ sprite, baseY: sprite.position.y, phase: i * 0.9 });
        }
        holder.embers = 0;
        break;
      }
      case 'prison': {
        const style = zone.s || 'ice';
        const main = styleColor(style);
        add(groundDecal(style, zone.r));
        const icy = ['ice', 'glacial', 'crystal'].includes(style);
        const green = ['nature', 'overgrowth'].includes(style);
        const bars = 9;
        for (let i = 0; i < bars; i++) {
          const angle = (i / bars) * Math.PI * 2;
          const radius = zone.r * 0.8;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          if (icy) {
            const cluster = crystalCluster(zone.r * 0.2, 3, i % 2 ? 0xbfefff : 0xd8f8ff);
            cluster.position.set(x, 0, z);
            add(cluster);
          } else if (green) {
            const root = new THREE.Mesh(rootGeometry(26 + Math.random() * 16, 2.6), barkMaterial(0x4a3524));
            root.position.set(x, 0, z);
            root.rotation.z = (Math.random() - 0.5) * 0.25;
            add(root);
          } else {
            const bar = new THREE.Mesh(stoneBlockGeometry(5.5, 26 + Math.random() * 10, 5.5), stoneMaterial(0x6a5a46));
            bar.position.set(x, 14, z);
            bar.rotation.y = angle;
            add(bar);
          }
        }
        const domeMaterial = style === 'abyss' || style === 'dark'
          ? darkMaterial(0x0a0512, 0xb06bff)
          : icy
            ? crystalMaterial(0xbfefff, { opacity: 0.16 })
            : energyMaterial(main, { density: 0.4, speed: 3 });
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(zone.r * 0.85, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
          domeMaterial
        );
        dome.position.y = 0.3;
        add(dome);
        holder.dome = dome;
        break;
      }
      case 'spikes': {
        holder.spikes = [];
        const count = 10;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
          const radius = i === 0 ? 0 : zone.r * (0.3 + Math.random() * 0.6);
          const height = 18 + Math.random() * 26;
          const spikeColor = zone.s === 'crystal' ? 0xbfefff : zone.s === 'earth' ? 0x9a8567 : styleColor(zone.s, 0x9a8567);
          const crystal = zone.s === 'crystal';
          const spike = new THREE.Mesh(
            crystal
              ? crystalShard(3.8 + Math.random() * 2.4, height)
              : new THREE.ConeGeometry(3.4 + Math.random() * 2.6, height, 6),
            crystal ? crystalMaterial(0xbfefff) : stoneMaterial(spikeColor)
          );
          spike.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
          spike.rotation.z = (Math.random() - 0.5) * 0.3;
          spike.rotation.x = (Math.random() - 0.5) * 0.3;
          spike.scale.y = 0.001;
          add(spike);
          holder.spikes.push({ mesh: spike, height });
        }
        add(groundDecal(zone.s || 'earth', zone.r));
        break;
      }
      case 'geyser': {
        add(groundDecal('water', zone.r));
        const columnMaterial = waterMaterial(0x0d4f78, 0xd8f8ff);
        const column = new THREE.Mesh(
          new THREE.CylinderGeometry(zone.r * 0.18, zone.r * 0.5, 46, 24, 12, true),
          columnMaterial
        );
        column.position.y = 23;
        add(column);
        holder.column = column;
        const foam = smokeSprite(0xd8f8ff, 0.22, zone.r * 0.75);
        foam.position.y = 45;
        add(foam);
        holder.foam = foam;
        const splash = new THREE.Mesh(
          new THREE.RingGeometry(zone.r * 0.4, zone.r * 0.55, 28),
          energyMaterial(0x9fe8ff, { density: 0.4, speed: 4 })
        );
        splash.rotation.x = -Math.PI / 2;
        splash.position.y = 0.5;
        add(splash);
        holder.splash = splash;
        break;
      }
      case 'tree': {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(5, 8, 42, 9, 4, false),
          barkMaterial(0x6b4a2a)
        );
        trunk.position.y = 21;
        add(trunk);
        for (let i = 0; i < 4; i++) {
          const root = new THREE.Mesh(rootGeometry(20 + Math.random() * 12, 3), barkMaterial(0x5a3f24));
          root.position.y = 1;
          root.rotation.z = (i / 4) * Math.PI * 2;
          add(root);
        }
        holder.leaves = [];
        for (let i = 0; i < 4; i++) {
          const canopy = new THREE.Mesh(
            rockGeometry(22 - i * 3, 1),
            leafMaterial(i % 2 ? 0x3f8f46 : 0x4faa55)
          );
          canopy.position.y = 42 + i * 9;
          canopy.scale.set(1, 0.78, 1);
          add(canopy);
          holder.leaves.push(canopy);
        }
        add(groundDecal('nature', zone.r));
        break;
      }
      case 'summon': {
        const mob = zone.mob || 'golem';
        const body = new THREE.Group();
        if (mob === 'clone') {
          const material = darkMaterial(0x1a0a2a, 0x9a5cff);
          const torso = new THREE.Mesh(new THREE.ConeGeometry(6, 20, 7), material);
          torso.position.y = 10;
          const head = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), material);
          head.position.y = 23;
          const glow = new THREE.Sprite(glowMaterial(0xb06bff));
          glow.scale.setScalar(22);
          glow.position.y = 12;
          body.add(torso, head, glow);
        } else {
          const scale = mob === 'guardian' ? 1.5 : 1;
          const material = stoneMaterial(mob === 'guardian' ? 0x6f7a52 : 0x8a7a62, {
            emissive: mob === 'guardian' ? 0x0a2008 : 0x1a0e04,
            emissiveIntensity: 0.35,
          });
          const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(9 * scale, 0), material);
          torso.position.y = 12 * scale;
          const head = new THREE.Mesh(new THREE.BoxGeometry(7 * scale, 7 * scale, 7 * scale), material);
          head.position.y = 24 * scale;
          const armL = new THREE.Mesh(new THREE.BoxGeometry(4 * scale, 16 * scale, 4 * scale), material);
          armL.position.set(-11 * scale, 12 * scale, 0);
          armL.rotation.z = 0.3;
          const armR = armL.clone();
          armR.position.x = 11 * scale;
          armR.rotation.z = -0.3;
          body.add(torso, head, armL, armR);
          const eyeMaterial = new THREE.MeshStandardMaterial({
            color: 0x0a1208,
            emissive: mob === 'guardian' ? 0x9aff6a : 0xffa23a,
            emissiveIntensity: 2.6,
            roughness: 0.3,
          });
          for (const side of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9 * scale, 6, 5), eyeMaterial);
            eye.position.set(side * 2 * scale, 24.5 * scale, 3.7 * scale);
            body.add(eye);
          }
          if (mob === 'guardian') {
            const crown = new THREE.Mesh(
              new THREE.IcosahedronGeometry(12, 0),
              leafMaterial(0x4f8f46)
            );
            crown.position.y = 32;
            body.add(crown);
          }
        }
        add(body);
        holder.mob = mob;
        holder.body = body;
        flatDisc(zone.r * 0.5, styleColor(zone.s), 0.22);
        break;
      }
      case 'plasma': {
        add(groundDecal('plasma', zone.r));
        add(crackGlow(zone.r * 0.8, 0xff7bf0, 0.45));
        const orb = new THREE.Mesh(
          new THREE.IcosahedronGeometry(9, 2),
          energyMaterial(0xff7bf0, { density: 1.2, speed: 9 })
        );
        orb.position.y = 14;
        add(orb);
        holder.orb = orb;
        const core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(5.2, 2),
          new THREE.MeshStandardMaterial({
            color: 0xffd8ff,
            emissive: 0xff7bf0,
            emissiveIntensity: 3.2,
            roughness: 0.25,
            metalness: 0.1,
          })
        );
        core.position.y = 14;
        add(core);
        holder.core = core;
        holder.rings = [];
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(13 + i * 4, 0.5, 6, 40),
            energyMaterial(0xffb8ff, { density: 0.8, speed: 6 })
          );
          ring.position.y = 14;
          ring.rotation.x = Math.PI / 2 + (i ? 0.5 : 0);
          add(ring);
          holder.rings.push(ring);
        }
        break;
      }
      default: {
        flatDisc(zone.r, color, 0.25);
        break;
      }
    }

    this.decorateZone(zone, holder, add);
    group.position.set(zone.x, y, zone.z);
    this.group.add(group);
    this.zones.set(zone.id, holder);
    return holder;
  }

  // Capa común a todas las zonas: terreno irregular, humo que sube y brasas,
  // esporas o escarcha según el elemento. Evita que dos hechizos del mismo
  // estilo se lean como el mismo disco de color.
  decorateZone(zone, holder, add) {
    const style = zone.s || zone.t;
    const radius = zone.r || (zone.w ? zone.w * 0.5 : 60);
    if (!['wave', 'meteor', 'tornado'].includes(zone.t) && radius > 24) {
      add(groundDecal(style, radius * 0.95, { opacity: 0.9 }));
    }

    holder.smokes = [];
    const addSmoke = (color, count, size, opacity, spread, height, rise) => {
      for (let i = 0; i < count; i++) {
        const sprite = smokeSprite(color, opacity, size * (0.75 + Math.random() * 0.5));
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * spread;
        sprite.position.set(Math.cos(angle) * dist, height + Math.random() * 4, Math.sin(angle) * dist);
        add(sprite);
        holder.smokes.push({
          sprite,
          baseX: sprite.position.x,
          baseY: sprite.position.y,
          phase: Math.random() * 12,
          rise: rise * (0.6 + Math.random() * 0.8),
          opacity,
        });
      }
    };

    const fire = ['fire', 'magma', 'wildfire', 'thermal', 'plasma', 'abyssflame'];
    const icy = ['ice', 'crystal', 'frost', 'blizzard', 'polar', 'glacial', 'icestorm', 'steam'];
    const green = ['nature', 'poison', 'pollen', 'growth', 'overgrowth', 'vital', 'cursed', 'wildfire'];
    const dark = ['dark', 'abyss', 'cursed', 'frost', 'shadowbolt'];
    const dusty = ['earth', 'sand', 'sandstorm', 'magma', 'crystal', 'guardian', 'mud'];
    if (fire.includes(style)) addSmoke(0x2a1a12, zone.t === 'meteor' ? 2 : 3, radius * 0.42, 0.2, radius * 0.7, 4, 1.7);
    if (icy.includes(style)) addSmoke(0xbfe6ff, 3, radius * 0.44, 0.12, radius * 0.8, 3, 0.9);
    if (green.includes(style)) addSmoke(0x2a4a2a, 2, radius * 0.4, 0.16, radius * 0.8, 3, 0.8);
    if (dark.includes(style)) addSmoke(0x180a28, 3, radius * 0.45, 0.22, radius * 0.8, 3, 1.1);
    if (dusty.includes(style)) addSmoke(0x7a6448, 2, radius * 0.44, 0.16, radius * 0.8, 2, 0.7);
    if (zone.t === 'tornado') addSmoke(0x8a7a62, 3, radius * 0.5, 0.18, radius * 0.6, 1, 1.2);

    holder.ambient = 0.12;
  }

  syncZones(list, dt) {
    const seen = new Set();
    for (const zone of list) {
      seen.add(zone.id);
      let holder = this.zones.get(zone.id);
      if (!holder) holder = this.createZone(zone);
      holder.zone = zone;
      holder.age = (holder.age || 0) + dt;
      for (const material of holder.materials) {
        if (material.userData && material.userData.autoTime && material.uniforms && material.uniforms.uTime) {
          material.uniforms.uTime.value += dt;
        }
      }
      if (holder.smokes) {
        for (const smoke of holder.smokes) {
          const t = (holder.age * smoke.rise + smoke.phase) % 12;
          smoke.sprite.position.y = smoke.baseY + t;
          smoke.sprite.position.x = smoke.baseX + Math.sin(holder.age * 0.5 + smoke.phase) * 1.6;
          smoke.sprite.material.opacity = smoke.opacity * Math.sin((Math.PI * t) / 12) * 0.9;
        }
      }
      const style = zone.s || zone.t;
      holder.ambient = (holder.ambient || 0) - dt;
      if (holder.ambient <= 0 && !['wave', 'meteor'].includes(zone.t)) {
        holder.ambient = 0.11;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * (zone.r || 70) * 0.85;
        const x = zone.x + Math.cos(angle) * radius;
        const z = zone.z + Math.sin(angle) * radius;
        let color = 0;
        let vy = 2;
        let gravity = 2;
        let life = 0.9;
        let size = 3;
        if (['fire', 'magma', 'wildfire', 'plasma', 'thermal'].includes(style)) {
          color = Math.random() < 0.5 ? 0xffb44a : 0xff6a24;
          vy = 7; gravity = -1.5; life = 1.2; size = 2.8;
        } else if (['ice', 'crystal', 'frost', 'blizzard', 'polar', 'glacial', 'icestorm'].includes(style)) {
          color = 0xd8f8ff; vy = 2.4; gravity = -0.6; size = 2.6;
        } else if (['nature', 'poison', 'pollen', 'growth', 'overgrowth', 'vital', 'cursed'].includes(style)) {
          color = 0xa8ff8a; vy = 1.6; gravity = -1.2; size = 2.4;
        } else if (['dark', 'abyss', 'shadowbolt'].includes(style)) {
          color = 0x9a5cff; vy = 1.8; gravity = -1; size = 3;
        } else if (['earth', 'sand', 'sandstorm', 'guardian', 'mud'].includes(style)) {
          color = 0xb99a68; vy = 1.2; gravity = 3; size = 3.6;
        }
        if (color) {
          this.particles.emit(x, this.ground(x, z) + 0.5, z, color, {
            vx: (Math.random() - 0.5) * 2,
            vy,
            vz: (Math.random() - 0.5) * 2,
            gravity,
            drag: 0.8,
            life,
            size,
          });
        }
      }
      if (zone.t === 'tornado') {
        holder.spin = (holder.spin || 0) + dt;
        holder.group.position.set(zone.x, this.world.heightAt(zone.x, zone.z), zone.z);
        if (holder.shaders) {
          for (const shader of holder.shaders) shader.uniforms.uTime.value += dt;
        }
        if (holder.disc) holder.disc.rotation.z -= dt * 2.8;
        // Escombros que orbitan la base y suben por el embudo.
        holder.debris = (holder.debris || 0) - dt;
        if (holder.debris <= 0) {
          holder.debris = 0.03;
          const angle = Math.random() * Math.PI * 2;
          const radius = (holder.base || 12) * (0.5 + Math.random() * 0.8);
          const x = zone.x + Math.cos(angle) * radius;
          const z = zone.z + Math.sin(angle) * radius;
          const y = this.ground(x, z) + Math.random() * 30;
          const orbital = 34 + Math.random() * 22;
          this.particles.emit(x, y, z, holder.fire ? (Math.random() < 0.6 ? 0xffb44a : 0xff5a1e) : 0xd8fff2, {
            vx: -Math.sin(angle) * orbital,
            vz: Math.cos(angle) * orbital,
            vy: 14 + Math.random() * 22,
            gravity: -2,
            drag: 0.18,
            life: 1.1,
            size: holder.fire ? 5 : 3.6,
          });
        }
      } else if (zone.t === 'wave') {
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
        if (holder.shader) holder.shader.uniforms.uTime.value += dt;
        // Rociones en la cresta de la ola.
        holder.spray = (holder.spray || 0) - dt;
        if (holder.spray <= 0) {
          holder.spray = 0.02;
          const spread = (zone.w || 200) / 2;
          const t = (Math.random() * 2 - 1) * spread;
          const x = zone.x - zone.dz * t + zone.dx * 4;
          const z = zone.z + zone.dx * t + zone.dz * 4;
          this.particles.emit(x, this.ground(x, z) + 7 + Math.random() * 4, z, 0xbdf0ff, {
            vx: zone.dx * (6 + Math.random() * 10),
            vz: zone.dz * (6 + Math.random() * 10),
            vy: 6 + Math.random() * 8,
            gravity: 12,
            drag: 0.2,
            life: 0.8,
            size: 3.2,
          });
        }
      } else if (zone.t === 'wall') {
        holder.group.position.set(zone.x, this.world.heightAt(zone.x, zone.z), zone.z);
        if (holder.shaders) {
          for (const shader of holder.shaders) shader.uniforms.uTime.value += dt;
        }
        // Brasas que suben desde la base del muro.
        holder.embers = (holder.embers || 0) - dt;
        if (holder.embers <= 0) {
          holder.embers = 0.02;
          const spread = (zone.w || 155) / 2;
          const t = (Math.random() * 2 - 1) * spread;
          const x = zone.x - zone.dz * t;
          const z = zone.z + zone.dx * t;
          this.particles.emit(x, this.ground(x, z) + 0.4, z, Math.random() < 0.5 ? 0xffb44a : 0xff6a24, {
            vx: (Math.random() - 0.5) * 4,
            vy: 10 + Math.random() * 14,
            vz: (Math.random() - 0.5) * 4,
            gravity: -1.5,
            drag: 0.4,
            life: 1.1,
            size: 3.4,
          });
        }
      } else if (zone.t === 'meteor') {
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
        if (holder.meteor) {
          const delay = Math.max(0, zone.d || 0);
          const total = holder.startD || Math.max(0.001, delay);
          const progress = Math.min(1, Math.max(0, 1 - delay / total));
          holder.meteor.position.y = 8 + delay * 110;
          holder.meteor.rotation.x += dt * 3;
          holder.meteor.rotation.y += dt * 2;
          if (holder.meteorShaders) {
            for (const shader of holder.meteorShaders) shader.uniforms.uTime.value += dt;
          }
          // El aviso late y se cierra sobre el punto de impacto: cuanto menos
          // queda, más intenso y rápido es el parpadeo.
          if (holder.warnRing) {
            holder.warnRing.scale.setScalar(1 + Math.sin(holder.age * 9) * 0.025);
            holder.warnMat.opacity = 0.4 + progress * 0.5;
          }
          if (holder.warnInner) {
            holder.warnInner.scale.setScalar(1 + progress * 0.3);
            holder.warnInnerMat.opacity = 0.2 + progress * 0.55;
          }
          if (holder.warnBeamMat) holder.warnBeamMat.opacity = 0.05 + progress * 0.15;
          // Rastro de fuego y humo del meteorito.
          for (let i = 0; i < 3; i++) {
            const fire = Math.random() < 0.65;
            this.particles.emit(
              zone.x + (Math.random() - 0.5) * 8,
              this.ground(zone.x, zone.z) + holder.meteor.position.y + (Math.random() - 0.5) * 6,
              zone.z + (Math.random() - 0.5) * 8,
              fire ? (Math.random() < 0.5 ? 0xff6a24 : 0xffc46b) : 0x2b2118,
              {
                vx: (Math.random() - 0.5) * 5,
                vy: 4 + Math.random() * 5,
                vz: (Math.random() - 0.5) * 5,
                life: fire ? 0.6 : 1.2,
                size: fire ? 9 : 15,
                gravity: fire ? -2 : -1,
                drag: 1.2,
              }
            );
          }
        }
      } else if (zone.t === 'lava') {
        if (Math.random() < dt * 12) {
          this.particles.emit(
            zone.x + (Math.random() - 0.5) * zone.r * 1.4,
            this.ground(zone.x, zone.z) + 0.4,
            zone.z + (Math.random() - 0.5) * zone.r * 1.4,
            0xffa04a,
            { vx: 0, vy: 2 + Math.random() * 2, vz: 0, life: 0.6, size: 4 }
          );
        }
      } else if (zone.t === 'storm') {
        // Rayos: cada descarga ilumina la nube y deja un destello en el suelo.
        holder.strike = (holder.strike || 0.6) - dt;
        if (holder.strike <= 0) {
          holder.strike = 0.35 + Math.random() * 0.9;
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * zone.r * 0.85;
          this.spawnBolt(zone.x + Math.cos(angle) * radius, zone.z + Math.sin(angle) * radius);
          if (holder.clouds) {
            for (const cloud of holder.clouds) cloud.material.opacity = Math.min(0.9, cloud.base + 0.35);
          }
        }
        if (holder.clouds) {
          const settle = Math.min(1, dt * 5);
          for (const cloud of holder.clouds) {
            cloud.material.opacity += (cloud.base - cloud.material.opacity) * settle;
          }
        }
        // Cortina de agua: gotas largas cayendo en diagonal.
        if (Math.random() < dt * 150) {
          for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random()) * zone.r;
            const x = zone.x + Math.cos(angle) * radius;
            const z = zone.z + Math.sin(angle) * radius;
            this.particles.emit(x, this.ground(x, z) + 130 + Math.random() * 45, z, holder.icy ? 0xbfefff : 0xbfb4ff, {
              vx: 7,
              vy: -165,
              vz: 4,
              gravity: 0,
              drag: 0,
              life: 1.0,
              size: 2.2,
            });
          }
        }
      } else if (zone.t === 'sandstorm') {
        if (holder.shaders) {
          for (const shader of holder.shaders) shader.uniforms.uTime.value += dt;
        }
        holder.dirt = (holder.dirt || 0) - dt;
        if (holder.dirt <= 0) {
          holder.dirt = 0.025;
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * zone.r;
          const x = zone.x + Math.cos(angle) * radius;
          const z = zone.z + Math.sin(angle) * radius;
          this.particles.emit(x, this.ground(x, z) + 1 + Math.random() * 26, z, 0xe8cf9a, {
            vx: -Math.sin(angle) * 30,
            vz: Math.cos(angle) * 30,
            vy: 6 + Math.random() * 8,
            gravity: 1,
            drag: 0.3,
            life: 1.0,
            size: 4.5,
          });
        }
      } else if (zone.t === 'steam') {
        // Los jirones suben y bajan muy despacio.
        if (holder.mists) {
          holder.mistT = (holder.mistT || 0) + dt;
          for (const mist of holder.mists) {
            mist.sprite.position.y = mist.y + Math.sin(holder.mistT * 0.7 + mist.phase) * 2.5;
          }
        }
        if (Math.random() < dt * 22) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * zone.r;
          const x = zone.x + Math.cos(angle) * radius;
          const z = zone.z + Math.sin(angle) * radius;
          this.particles.emit(x, this.ground(x, z) + 1 + Math.random() * 4, z, 0xffffff, {
            vx: 3 + Math.random() * 4,
            vy: 3 + Math.random() * 4,
            vz: (Math.random() - 0.5) * 4,
            gravity: -3,
            drag: 0.6,
            life: 1.4,
            size: 6,
          });
        }
      } else if (zone.t === 'mud') {
        // Burbujas que se hinchan y estallan despacio.
        holder.bubbles = (holder.bubbles || 0) - dt;
        if (holder.bubbles <= 0) {
          holder.bubbles = 0.08;
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * zone.r * 0.92;
          const x = zone.x + Math.cos(angle) * radius;
          const z = zone.z + Math.sin(angle) * radius;
          this.particles.emit(x, this.ground(x, z) + 0.4, z, Math.random() < 0.4 ? 0xa8875a : 0x6f5231, {
            vx: (Math.random() - 0.5) * 2,
            vy: 2.6 + Math.random() * 2,
            vz: (Math.random() - 0.5) * 2,
            gravity: 5,
            drag: 0.8,
            life: 0.9,
            size: 6.5,
          });
        }
      }
      if (zone.t === 'summon') {
        holder.group.position.set(zone.x, this.world.heightAt(zone.x, zone.z), zone.z);
        if (holder.body) {
          holder.body.position.y = Math.sin((holder.age || 0) * 5 + zone.id) * 0.9;
          holder.body.rotation.y += dt * (holder.mob === 'clone' ? 1.2 : 0.4);
        }
      } else if (zone.t === 'field') {
        if (holder.ring) holder.ring.rotation.z += dt * 0.7;
        if (holder.dome) holder.dome.material.opacity = 0.16 + Math.sin((holder.age || 0) * 2.2) * 0.04;
        if (holder.mists) {
          for (const mist of holder.mists) {
            mist.sprite.position.y = mist.baseY + Math.sin((holder.age || 0) * 0.8 + mist.phase) * 1.6;
          }
        }
        holder.embers = (holder.embers || 0) - dt;
        if (holder.embers <= 0) {
          holder.embers = 0.05;
          const style = zone.s || 'earth';
          const count = style === 'dark' || style === 'poison' || style === 'cursed' ? 2 : 1;
          for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random()) * zone.r;
            const x = zone.x + Math.cos(angle) * radius;
            const z = zone.z + Math.sin(angle) * radius;
            const up = style === 'magma' || style === 'wildfire' ? 8 : style === 'ice' || style === 'blizzard' ? 3 : 5;
            this.particles.emit(x, this.ground(x, z) + 0.6, z, styleColor(style), {
              vx: (Math.random() - 0.5) * 3,
              vy: up + Math.random() * 4,
              vz: (Math.random() - 0.5) * 3,
              gravity: style === 'magma' || style === 'wildfire' ? -3 : 2,
              life: 0.9 + Math.random() * 0.6,
              size: 4.5,
            });
          }
        }
      } else if (zone.t === 'spikes') {
        if (holder.spikes) {
          const emerge = Math.max(0, Math.min(1, ((holder.age || 0) - (zone.d || 0)) * 2.6));
          for (const spike of holder.spikes) {
            spike.mesh.scale.y = Math.max(0.001, emerge);
            spike.mesh.position.y = spike.height * 0.5 * emerge;
          }
        }
      } else if (zone.t === 'geyser') {
        if (holder.column) {
          const h = 0.85 + Math.sin((holder.age || 0) * 6) * 0.15;
          holder.column.scale.y = h;
          holder.column.position.y = 23 * h;
        }
        if (Math.random() < dt * 60) {
          this.particles.emit(
            zone.x + (Math.random() - 0.5) * zone.r,
            this.ground(zone.x, zone.z) + 1,
            zone.z + (Math.random() - 0.5) * zone.r,
            0x9fe8ff,
            { vx: 0, vy: 40 + Math.random() * 20, vz: 0, gravity: 18, life: 1.1, size: 4 }
          );
        }
      } else if (zone.t === 'tree') {
        if (holder.leaves) {
          for (let i = 0; i < holder.leaves.length; i++) {
            holder.leaves[i].rotation.z = Math.sin((holder.age || 0) * 1.4 + i) * 0.04;
          }
        }
      } else if (zone.t === 'plasma') {
        if (holder.orb) {
          holder.orb.scale.setScalar(0.8 + Math.sin((holder.age || 0) * 9) * 0.12);
          holder.orb.rotation.y += dt * 3;
        }
        if (holder.core) {
          holder.core.scale.setScalar(0.9 + Math.sin((holder.age || 0) * 13) * 0.08);
          holder.core.rotation.x += dt * 1.6;
        }
        if (holder.rings) {
          holder.rings[0].rotation.z += dt * 1.8;
          if (holder.rings[1]) holder.rings[1].rotation.y += dt * 2.4;
        }
      } else if (zone.t === 'prison') {
        if (holder.dome) holder.dome.rotation.y += dt * 0.5;
      }
      const lifeRatio = Math.max(0, Math.min(1, zone.life / Math.max(0.1, zone.max || 1)));
      const fade = Math.min(1, 0.35 + lifeRatio);
      groupOpacity(holder, fade);
      if (holder.shaders) {
        for (const shader of holder.shaders) {
          if (shader.uniforms.uFade) shader.uniforms.uFade.value = fade;
        }
      }
    }
    for (const [id, holder] of this.zones) {
      if (seen.has(id)) continue;
      this.group.remove(holder.group);
      holder.materials.forEach((m) => m.dispose());
      if (holder.geometries) holder.geometries.forEach((g) => g.dispose());
      this.zones.delete(id);
    }
  }

  // Rayo: línea quebrada desde la nube hasta el suelo, con destello y chispas.
  spawnBolt(x, z) {
    const groundY = this.ground(x, z);
    const height = 120;
    const points = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter = (1 - t * 0.6) * 16;
      const sx = x + Math.sin(t * 9 + x) * jitter * 0.6 + (Math.random() - 0.5) * jitter;
      const sz = z + Math.cos(t * 7 + z) * jitter * 0.6 + (Math.random() - 0.5) * jitter;
      points.push(new THREE.Vector3(sx, groundY + 1 + height * (1 - t), sz));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xe6e0ff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.Line(geometry, material);
    this.group.add(line);
    this.bolts.push({ line, material, life: 0.18, maxLife: 0.18 });
    this.addFlash(x, z, 0xc8bcff, 40, 0.2);
    this.particles.burst(x, groundY, z, 0xd8d0ff, 7, { speed: 8, up: 5, life: 0.35, size: 3.5 });
  }

  update(dt, time) {
    this.particles.update(dt);

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.life -= dt;
      const t = Math.max(0, bolt.life / bolt.maxLife);
      // Parpadeo de descarga: no se apaga de forma lineal.
      bolt.material.opacity = t * (Math.random() < 0.35 ? 0.25 : 1);
      if (bolt.life <= 0) {
        this.group.remove(bolt.line);
        bolt.line.geometry.dispose();
        bolt.material.dispose();
        this.bolts.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= dt;
      const t = 1 - Math.max(0, ring.life) / ring.maxLife;
      const scale = 2 + (ring.maxRadius - 2) * (1 - Math.pow(1 - t, 2));
      ring.mesh.scale.set(scale, 1, scale);
      ring.material.opacity = (1 - t) * 0.8;
      if (ring.life <= 0) {
        this.group.remove(ring.mesh);
        ring.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      const t = 1 - Math.max(0, flash.life) / flash.maxLife;
      flash.mesh.scale.setScalar(flash.radius * (0.3 + t * 1.1));
      flash.material.opacity = (1 - t) * 0.5;
      flash.mesh.rotation.y += dt * 2;
      if (flash.life <= 0) {
        this.group.remove(flash.mesh);
        flash.mesh.geometry.dispose();
        flash.material.dispose();
        this.flashes.splice(i, 1);
      }
    }

    // Humo volumétrico: crece, se frena y se disipa sin cortes.
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.life -= dt;
      if (puff.life <= 0) {
        this.group.remove(puff.sprite);
        puff.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const t = 1 - puff.life / puff.maxLife;
      puff.sprite.position.addScaledVector(puff.vel, dt);
      puff.vel.multiplyScalar(Math.max(0, 1 - puff.drag * dt));
      puff.vel.y += dt * 0.6;
      puff.sprite.scale.setScalar(puff.size * (1 + t * puff.grow));
      puff.sprite.material.opacity = puff.opacity * Math.min(1, puff.life / (puff.maxLife * 0.5)) * (0.7 + Math.sin(t * 9 + puff.size) * 0.1);
    }

    // Calcomanías del suelo: se apagan al final de su vida útil.
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const decal = this.decals[i];
      decal.life -= dt;
      if (decal.life <= 0) {
        this.group.remove(decal.group);
        decal.group.traverse((node) => {
          if (node.geometry) node.geometry.dispose();
          if (node.material) node.material.dispose();
        });
        this.decals.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, decal.life / 2.2);
      decal.group.traverse((node) => {
        if (node.material && node.material.userData.baseOpacity !== undefined) {
          node.material.opacity = node.material.userData.baseOpacity * fade;
        }
      });
    }

    for (const slot of this.lights) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.light.visible = false;
        slot.light.intensity = 0;
      } else {
        slot.light.intensity = slot.power * Math.pow(slot.life / slot.max, 2);
      }
    }
  }

  clear() {
    for (const [, holder] of this.projectiles) {
      this.group.remove(holder.group);
      holder.group.traverse((o) => {
        if (o.geometry && !o.isSprite) o.geometry.dispose();
      });
      if (holder.materials) holder.materials.forEach((mat) => mat.dispose());
      else if (holder.material) holder.material.dispose();
    }
    this.projectiles.clear();
    for (const puff of this.puffs) {
      this.group.remove(puff.sprite);
      puff.sprite.material.dispose();
    }
    this.puffs.length = 0;
    for (const decal of this.decals) {
      this.group.remove(decal.group);
      decal.group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    }
    this.decals.length = 0;
    for (const slot of this.lights) {
      slot.life = 0;
      slot.light.intensity = 0;
      slot.light.visible = false;
    }
    for (const [, holder] of this.zones) {
      this.group.remove(holder.group);
      holder.materials.forEach((m) => m.dispose());
    }
    this.zones.clear();
    for (const ring of this.rings) {
      this.group.remove(ring.mesh);
      ring.material.dispose();
    }
    this.rings.length = 0;
    for (const flash of this.flashes) {
      this.group.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      flash.material.dispose();
    }
    this.flashes.length = 0;
    for (const bolt of this.bolts) {
      this.group.remove(bolt.line);
      bolt.line.geometry.dispose();
      bolt.material.dispose();
    }
    this.bolts.length = 0;
    this.particles.particles.length = 0;
  }

  dispose() {
    this.clear();
    this.particles.dispose();
    for (const slot of this.lights) this.group.remove(slot.light);
    this.scene.remove(this.group);
  }
}

function groupOpacity(holder, value) {
  for (const material of holder.materials) {
    if (material.userData.baseOpacity === undefined) material.userData.baseOpacity = material.opacity ?? 1;
    material.opacity = material.userData.baseOpacity * value;
  }
}
