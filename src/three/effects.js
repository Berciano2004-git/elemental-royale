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

function wallMaterial(colorA, colorB) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      void main() {
        float n = sin(vUv.x * 26.0 + uTime * 3.0) * 0.5 + 0.5;
        float n2 = sin(vUv.x * 9.0 - uTime * 1.6 + vUv.y * 4.0) * 0.5 + 0.5;
        float alpha = (0.35 + n * 0.4) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
        vec3 color = mix(uColorA, uColorB, n2);
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
    this.projectileScale = 1;
  }

  ground(x, z) {
    return this.world.heightAt(x, z);
  }

  addRing(x, z, color, maxRadius, life = 0.55, width = 1.0) {
    const material = makeRingMaterial(color, 0.9);
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.position.set(x, this.ground(x, z) + 0.25, z);
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
        case 'cast':
          this.particles.burst(fx.x, y, fx.z, color, 7, { speed: 3.5, up: 2.5, life: 0.5, size: 3.5 });
          break;
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
      material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), material);
      mesh.scale.set(1.2, 0.55, 1.2);
      group.add(mesh);
    } else {
      material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const geometry = p.k === 'jet' ? new THREE.CapsuleGeometry(0.3, 1.7, 4, 8) : new THREE.IcosahedronGeometry(0.55, 1);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.z = Math.PI / 2;
      group.add(mesh);
      const sprite = new THREE.Sprite(glowMaterial(color));
      sprite.scale.setScalar(p.k === 'jet' ? 3.6 : 4.6);
      group.add(sprite);
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
    const holder = { group, zone, color, y, particles: 0, materials: [], meshes: [] };

    const add = (mesh) => {
      group.add(mesh);
      holder.meshes.push(mesh);
      if (mesh.material) holder.materials.push(mesh.material);
      return mesh;
    };

    const flatDisc = (radius, discColor, opacity = 0.5) => {
      const geometry = new THREE.CircleGeometry(1, 40);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        color: discColor,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
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
        const material = wallMaterial(0xff3d12, 0xffc24d);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 7), material);
        mesh.position.y = 3.6;
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(zone.dx, 0, zone.dz));
        add(mesh);
        holder.shader = material;
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
              float band = sin(vUv.y * 18.0 - uTime * 4.0 + sin(vUv.x * 20.0) * 2.0) * 0.5 + 0.5;
              vec3 deep = vec3(0.06, 0.35, 0.55);
              vec3 foam = vec3(0.72, 0.95, 1.0);
              vec3 color = mix(deep, foam, pow(vUv.y, 2.2) * 0.8 + band * 0.18);
              float alpha = 0.62 + band * 0.22;
              gl_FragColor = vec4(color, alpha);
            }
          `,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 9), material);
        mesh.position.y = 4.2;
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(zone.dx, 0, zone.dz));
        add(mesh);
        holder.shader = material;
        flatDisc(width * 0.4, 0x7fe8ff, 0.2);
        break;
      }
      case 'tornado': {
        const styles = zone.s === 'fire' ? [0xff7a2e, 0xffc14d] : [0x9ef0d0, 0x64c9a7];
        for (let i = 0; i < 3; i++) {
          const material = new THREE.MeshBasicMaterial({
            color: styles[i % 2],
            transparent: true,
            opacity: 0.16 + i * 0.05,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          });
          const geometry = new THREE.CylinderGeometry(2.4 + i * 1.2, 8 + i * 2.2, 15 + i * 3, 16, 1, true);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.y = 7.5;
          add(mesh);
        }
        flatDisc(zone.r * 1.5, styles[0], 0.16);
        holder.spin = 0;
        break;
      }
      case 'meteor': {
        const material = new THREE.MeshBasicMaterial({ color: 0xff6a24, toneMapped: false });
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 1), material);
        mesh.position.y = 70;
        group.add(mesh);
        holder.meteor = mesh;
        const glow = new THREE.Sprite(glowMaterial(0xffb05a));
        glow.scale.setScalar(24);
        mesh.add(glow);
        flatDisc(zone.r, 0xff5d22, 0.22);
        break;
      }
      case 'mud': {
        flatDisc(zone.r, 0x6a4a2e, 0.5);
        flatDisc(zone.r * 0.7, 0x8a6742, 0.3);
        break;
      }
      case 'steam': {
        flatDisc(zone.r, 0xcfeaff, 0.12);
        const material = new THREE.MeshBasicMaterial({
          color: 0xe6f7ff,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(zone.r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), material);
        group.add(dome);
        holder.materials.push(material);
        break;
      }
      case 'sandstorm':
      case 'storm': {
        const stormColor = zone.t === 'storm' ? 0x9b7bff : 0xd8b47a;
        flatDisc(zone.r, stormColor, 0.18);
        const material = new THREE.MeshBasicMaterial({
          color: stormColor,
          transparent: true,
          opacity: 0.09,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(zone.r, zone.r, 26, 28, 1, true), material);
        cylinder.position.y = 13;
        add(cylinder);
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
        holder.spin = (holder.spin || 0) + dt * 2.4;
        holder.group.rotation.y = holder.spin;
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
      } else if (zone.t === 'wave') {
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
        if (holder.shader) holder.shader.uniforms.uTime.value += dt;
      } else if (zone.t === 'wall') {
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
        if (holder.shader) holder.shader.uniforms.uTime.value += dt;
      } else if (zone.t === 'meteor') {
        holder.group.position.x = zone.x;
        holder.group.position.z = zone.z;
        holder.group.position.y = this.world.heightAt(zone.x, zone.z);
        if (holder.meteor) {
          const delay = Math.max(0, zone.d || 0);
          holder.meteor.position.y = 8 + delay * 90;
          holder.meteor.rotation.x += dt * 3;
          holder.meteor.rotation.y += dt * 2;
          if (Math.random() < 0.5) {
            this.particles.emit(zone.x, this.ground(zone.x, zone.z) + holder.meteor.position.y, zone.z, 0xffb05a, {
              vx: (Math.random() - 0.5) * 3,
              vy: 2,
              vz: (Math.random() - 0.5) * 3,
              life: 0.5,
              size: 6,
            });
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
      } else if (zone.t === 'storm' || zone.t === 'sandstorm' || zone.t === 'steam') {
        if (Math.random() < dt * 16) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * zone.r;
          const c = zone.t === 'storm' ? 0xc8b0ff : zone.t === 'steam' ? 0xffffff : 0xe8cf9a;
          this.particles.emit(zone.x + Math.cos(angle) * radius, this.ground(zone.x, zone.z) + 1 + Math.random() * 4, zone.z + Math.sin(angle) * radius, c, {
            vx: 2 + Math.random() * 3,
            vy: 1.5,
            vz: (Math.random() - 0.5) * 3,
            life: 0.7,
            size: 4,
          });
        }
      } else if (zone.t === 'mud') {
        if (Math.random() < dt * 4) {
          this.particles.emit(
            zone.x + (Math.random() - 0.5) * zone.r,
            this.ground(zone.x, zone.z) + 0.3,
            zone.z + (Math.random() - 0.5) * zone.r,
            0x8a6742,
            { vx: 0, vy: 1, vz: 0, life: 0.5, size: 3 }
          );
        }
      }
      const lifeRatio = Math.max(0, Math.min(1, zone.life / Math.max(0.1, zone.max || 1)));
      groupOpacity(holder, Math.min(1, 0.35 + lifeRatio));
    }
    for (const [id, holder] of this.zones) {
      if (seen.has(id)) continue;
      this.group.remove(holder.group);
      holder.materials.forEach((m) => m.dispose());
      this.zones.delete(id);
    }
  }

  update(dt, time) {
    this.particles.update(dt);

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
