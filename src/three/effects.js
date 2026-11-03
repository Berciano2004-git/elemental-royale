// Efectos visuales de hechizos: partículas, proyectiles, zonas y explosiones.

import * as THREE from 'three';
import { makeGlowTexture } from './world.js';

const COLORS = {
  fire: 0xff7a33,
  water: 0x53c9ff,
  wind: 0xa8ffe0,
  earth: 0xd2a05f,
  storm: 0xb48cff,
  sand: 0xe8c98a,
  steam: 0xd8f2ff,
  mud: 0x7a5a3a,
  heal: 0x7bffcf,
  hit: 0xff6b7d,
};

function elementColor(key, fallback = 0xffffff) {
  return COLORS[key] || fallback;
}

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
          const gravity = fx.el === 'fire' ? -3 : fx.el === 'water' ? 11 : fx.el === 'wind' ? -1 : 9;
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
        case 'boom':
          this.addRing(fx.x, fx.z, color, fx.r || 60, 0.5);
          this.addFlash(fx.x, fx.z, color, fx.r || 60, 0.3);
          this.particles.burst(fx.x, y, fx.z, color, 22, { speed: 12, up: 8, life: 0.9, size: 6 });
          this.particles.burst(fx.x, y, fx.z, 0x2b2118, 8, { speed: 5, up: 2, life: 1.2, size: 8, gravity: 4 });
          break;
        case 'hit':
          this.particles.burst(fx.x, y, fx.z, COLORS.hit, 6, { speed: 4, up: 3, life: 0.42, size: 3.6 });
          break;
        case 'death':
          this.addRing(fx.x, fx.z, 0xff5d72, 70, 0.8);
          this.addFlash(fx.x, fx.z, 0xff5d72, 60, 0.5);
          this.particles.burst(fx.x, y, fx.z, 0xff6b7d, 26, { speed: 9, up: 7, life: 1.2, size: 6 });
          this.particles.burst(fx.x, y, fx.z, 0xffffff, 10, { speed: 4, up: 9, life: 1.5, size: 3 });
          break;
        case 'quake':
          this.addRing(fx.x, fx.z, 0xc08a4a, fx.r || 170, 0.85);
          this.addRing(fx.x, fx.z, 0xf3d08a, (fx.r || 170) * 0.7, 0.6);
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
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------- proyectiles

  createProjectile(p) {
    const color = p.k === 'lavabolt' ? COLORS.fire : p.k === 'jet' ? COLORS.water : p.k === 'gust' ? COLORS.wind : COLORS.earth;
    const group = new THREE.Group();
    let material;
    if (p.k === 'rock') {
      material = new THREE.MeshLambertMaterial({ color: 0x9a8567, flatShading: true });
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 0), material);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(mesh);
      const dust = new THREE.Sprite(glowMaterial(0x8d7a5d));
      dust.scale.setScalar(4);
      group.add(dust);
    } else if (p.k === 'gust') {
      // Media luna de aire: un anillo abierto y plano que gira al volar.
      material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const blade = new THREE.Mesh(new THREE.RingGeometry(1.7, 3.0, 30, 1, 0.25, Math.PI * 1.1), material);
      blade.rotation.x = -Math.PI / 2;
      group.add(blade);
      const halo = new THREE.Sprite(glowMaterial(0xccfff0));
      halo.scale.setScalar(6);
      group.add(halo);
    } else {
      material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      // El chorro es un cono que apunta hacia donde vuela (el grupo se orienta
      // con lookAt); el orbe de lava es una piedra fundida con brasas.
      const geometry =
        p.k === 'jet' ? new THREE.ConeGeometry(0.85, 6.5, 12, 1, true) : new THREE.IcosahedronGeometry(0.6, 1);
      const mesh = new THREE.Mesh(geometry, material);
      if (p.k === 'jet') {
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = 0.6;
      } else {
        mesh.rotation.z = Math.PI / 2;
      }
      group.add(mesh);
      const sprite = new THREE.Sprite(glowMaterial(color));
      sprite.scale.setScalar(p.k === 'jet' ? 4.2 : 4.6);
      group.add(sprite);
      if (p.k === 'lavabolt') {
        for (let i = 0; i < 2; i++) {
          const ember = new THREE.Sprite(glowMaterial(0xffc46b));
          ember.scale.setScalar(1.7);
          ember.position.set(Math.cos(i * Math.PI) * 1.3, Math.sin(i * Math.PI) * 0.7, 0);
          group.add(ember);
        }
      }
    }
    group.scale.setScalar(this.projectileScale);
    const holder = { group, material, kind: p.k, x: p.x, z: p.z, dx: p.dx, dz: p.dz, trail: 0 };
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
      const lerp = Math.min(1, dt * 28);
      holder.x += (p.x - holder.x) * lerp;
      holder.z += (p.z - holder.z) * lerp;
      holder.dx = p.dx;
      holder.dz = p.dz;
      const y = this.ground(holder.x, holder.z) + 2.3;
      holder.group.position.set(holder.x, y, holder.z);
      if (holder.kind === 'jet') {
        holder.group.lookAt(holder.x + p.dx, y, holder.z + p.dz);
      } else if (holder.kind === 'gust') {
        holder.group.rotation.y += dt * 14;
      } else if (holder.kind === 'rock') {
        holder.group.rotation.x += dt * 6;
        holder.group.rotation.y += dt * 5;
      }
      holder.trail -= dt;
      if (holder.trail <= 0) {
        holder.trail = 0.035;
        const color = holder.kind === 'lavabolt' ? 0xffc46b : holder.kind === 'jet' ? 0x9ae8ff : holder.kind === 'gust' ? 0xccfff0 : 0xb59c7d;
        this.particles.emit(holder.x, y, holder.z, color, {
          vx: (Math.random() - 0.5) * 2,
          vy: 1 + Math.random() * 2,
          vz: (Math.random() - 0.5) * 2,
          life: 0.45,
          size: 3.5 * this.projectileScale,
        });
      }
    }
    for (const [id, holder] of this.projectiles) {
      if (seen.has(id)) continue;
      this.group.remove(holder.group);
      holder.group.traverse((object) => {
        if (object.geometry && !object.isSprite) object.geometry.dispose();
      });
      if (holder.material) holder.material.dispose();
      this.projectiles.delete(id);
    }
  }

  // -------------------------------------------------------------- zonas

  createZone(zone) {
    const group = new THREE.Group();
    const color = elementColor(zone.s, 0xffffff);
    const y = this.ground(zone.x, zone.z);
    const holder = { group, zone, color, y, particles: 0, materials: [], geometries: [], meshes: [] };

    const add = (mesh) => {
      group.add(mesh);
      holder.meshes.push(mesh);
      if (mesh.material) holder.materials.push(mesh.material);
      if (mesh.geometry) holder.geometries.push(mesh.geometry);
      return mesh;
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
        holder.disc = flatDisc(zone.r, 0xff5a1f, 0.55);
        flatDisc(zone.r * 0.7, 0xffc14d, 0.5);
        const glow = new THREE.Sprite(glowMaterial(0xff8a3c));
        glow.scale.setScalar(zone.r * 3.2);
        glow.position.y = 1.4;
        group.add(glow);
        break;
      }
      case 'wall': {
        const width = zone.w || 155;
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
          uniforms: { uTime: { value: 0 } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            varying vec2 vUv;
            void main() {
              float x = vUv.x;
              float h = vUv.y;
              // Perfil irregular de la cresta y espuma justo debajo de ella.
              float crest = 0.8 + sin(x * 11.0 + uTime * 1.1) * 0.1 + sin(x * 31.0 - uTime * 2.2) * 0.05;
              float band = sin(x * 16.0 + h * 7.0 - uTime * 4.0) * 0.5 + 0.5;
              float foam = smoothstep(crest - 0.22, crest, h);
              vec3 deep = vec3(0.04, 0.26, 0.46);
              vec3 shallow = vec3(0.32, 0.78, 0.98);
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
        const fire = zone.s === 'fire';
        const inner = fire ? 0xff9142 : 0xd6fff2;
        const outer = fire ? 0xff4d16 : 0x5fd7b6;
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
        const material = new THREE.MeshBasicMaterial({ color: 0xff6a24, toneMapped: false });
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 1), material);
        mesh.position.y = 70;
        group.add(mesh);
        holder.meteor = mesh;
        // Núcleo brillante más un halo amplio que tiñe el cielo.
        const glow = new THREE.Sprite(glowMaterial(0xffd08a));
        glow.scale.setScalar(52);
        mesh.add(glow);
        const halo = new THREE.Sprite(glowMaterial(0xff5a1a));
        halo.scale.setScalar(96);
        mesh.add(halo);
        flatDisc(zone.r, 0xff5d22, 0.22);
        break;
      }
      case 'mud': {
        // Barro opaco: mezcla normal para que se vea húmedo y no como un brillo.
        flatDisc(zone.r, 0x4a3320, 0.92, false);
        flatDisc(zone.r * 0.74, 0x6d4f2f, 0.85, false);
        flatDisc(zone.r * 0.42, 0x8a6a41, 0.7, false);
        holder.bubbles = 0;
        break;
      }
      case 'steam': {
        flatDisc(zone.r, 0xcfeaff, 0.1);
        // El vapor son jirones sueltos, no una cúpula de cristal: sprites
        // grandes y suaves repartidos por la zona.
        holder.mists = [];
        holder.mistT = 0;
        for (let i = 0; i < 8; i++) {
          const material = new THREE.SpriteMaterial({
            map: makeGlowTexture(),
            color: 0xe6f7ff,
            transparent: true,
            opacity: 0.18,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          });
          const sprite = new THREE.Sprite(material);
          const angle = (i / 8) * Math.PI * 2;
          const radius = zone.r * (0.25 + (i % 3) * 0.24);
          sprite.position.set(Math.cos(angle) * radius, 6 + (i % 4) * 3.5, Math.sin(angle) * radius);
          sprite.scale.setScalar(zone.r * (0.85 + (i % 2) * 0.3));
          add(sprite);
          holder.mists.push({ sprite, y: sprite.position.y, phase: i * 0.8 });
        }
        break;
      }
      case 'sandstorm': {
        flatDisc(zone.r, 0xd8b47a, 0.14);
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
        flatDisc(zone.r, 0x9b7bff, 0.12);
        // Techo de nube: dos cúpulas achatadas superpuestas. La lluvia son
        // partículas, no una pared de geometría.
        holder.clouds = [];
        const cloudLayers = [
          { r: zone.r * 1.25, y: 175, squash: 0.34, color: 0x241d44, opacity: 0.5 },
          { r: zone.r * 0.85, y: 150, squash: 0.4, color: 0x332a5c, opacity: 0.45 },
        ];
        for (const layer of cloudLayers) {
          const material = new THREE.MeshBasicMaterial({
            color: layer.color,
            transparent: true,
            opacity: layer.opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
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
      default: {
        flatDisc(zone.r, color, 0.25);
        break;
      }
    }

    group.position.set(zone.x, y, zone.z);
    this.group.add(group);
    this.zones.set(zone.id, holder);
    return holder;
  }

  syncZones(list, dt) {
    const seen = new Set();
    for (const zone of list) {
      seen.add(zone.id);
      let holder = this.zones.get(zone.id);
      if (!holder) holder = this.createZone(zone);
      holder.zone = zone;
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
          holder.meteor.position.y = 8 + delay * 90;
          holder.meteor.rotation.x += dt * 3;
          holder.meteor.rotation.y += dt * 2;
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
            this.particles.emit(x, this.ground(x, z) + 130 + Math.random() * 45, z, 0xbfb4ff, {
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
  }

  clear() {
    for (const [, holder] of this.projectiles) {
      this.group.remove(holder.group);
      holder.group.traverse((o) => {
        if (o.geometry && !o.isSprite) o.geometry.dispose();
      });
      if (holder.material) holder.material.dispose();
    }
    this.projectiles.clear();
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
    this.scene.remove(this.group);
  }
}

function groupOpacity(holder, value) {
  for (const material of holder.materials) {
    if (material.userData.baseOpacity === undefined) material.userData.baseOpacity = material.opacity ?? 1;
    material.opacity = material.userData.baseOpacity * value;
  }
}
