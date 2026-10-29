// Mundo 3D procedural: isla con bosques, playas, montañas, desierto y lugares especiales.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEMENTS, RARITIES, WORLD_SIZE } from '../../shared/constants.js';
import { WATER_SURFACE, terrainSample } from '../../shared/worldgen.js';

const BIOME_COLORS = {
  water: [0x2b6270, 0x1d4b5c],
  beach: [0xe8d6a0, 0xcfba7f],
  desert: [0xdfb872, 0xcaa25c],
  grass: [0x6cb84a, 0x58a03b],
  forest: [0x3f8a35, 0x2f702b],
  highland: [0x8d8a63, 0x73714f],
  mountain: [0x8f8678, 0x777061],
  snow: [0xedf3f6, 0xd9e5e8],
};

const MINIMAP_COLORS = {
  water: [26, 66, 92],
  beach: [220, 203, 148],
  desert: [216, 176, 110],
  grass: [103, 159, 73],
  forest: [61, 122, 56],
  highland: [139, 135, 104],
  mountain: [122, 117, 107],
  snow: [232, 238, 240],
};

const propGeometryCache = new Map();
const propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function transform(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
}

function colorized(geometry, color, matrix) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (geo !== geometry) geometry.dispose();
  geo.applyMatrix4(matrix);
  const count = geo.attributes.position.count;
  const c = new THREE.Color(color);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  return geo;
}

function propGeometry(type) {
  if (propGeometryCache.has(type)) return propGeometryCache.get(type);
  let parts = [];
  switch (type) {
    case 'tree':
      parts = [
        colorized(new THREE.CylinderGeometry(0.36, 0.55, 3.4, 6), 0x6f4c2e, transform(0, 1.7, 0)),
        colorized(new THREE.IcosahedronGeometry(2.15, 0), 0x4a8a3e, transform(0, 4.9, 0)),
        colorized(new THREE.IcosahedronGeometry(1.55, 0), 0x5ea946, transform(1.2, 4.25, 0.5)),
        colorized(new THREE.IcosahedronGeometry(1.4, 0), 0x3f7a37, transform(-1.15, 5.5, -0.35)),
      ];
      break;
    case 'pine': {
      parts = [
        colorized(new THREE.CylinderGeometry(0.3, 0.44, 2.4, 6), 0x5c4128, transform(0, 1.2, 0)),
        colorized(new THREE.ConeGeometry(2.1, 3.4, 7), 0x2f6b3d, transform(0, 3.8, 0)),
        colorized(new THREE.ConeGeometry(1.55, 2.8, 7), 0x357846, transform(0, 5.5, 0)),
        colorized(new THREE.ConeGeometry(1.0, 2.2, 7), 0x3d8a50, transform(0, 7.1, 0)),
      ];
      break;
    }
    case 'palm': {
      parts = [
        colorized(new THREE.CylinderGeometry(0.28, 0.42, 4.4, 6), 0x8a6335, transform(0.15, 2.2, 0, 0, 0, -0.12)),
      ];
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        parts.push(
          colorized(
            new THREE.ConeGeometry(0.55, 3.4, 4),
            0x52974a,
            transform(Math.cos(angle) * 1.15, 4.3, Math.sin(angle) * 1.15, 1.22, -angle, 0)
          )
        );
      }
      parts.push(colorized(new THREE.SphereGeometry(0.34, 7, 5), 0x6b4a2c, transform(0, 4.35, 0)));
      break;
    }
    case 'bush':
      parts = [
        colorized(new THREE.IcosahedronGeometry(0.95, 0), 0x548f3f, transform(0, 0.8, 0)),
        colorized(new THREE.IcosahedronGeometry(0.68, 0), 0x67a44a, transform(0.65, 0.6, 0.25)),
        colorized(new THREE.IcosahedronGeometry(0.58, 0), 0x487f38, transform(-0.5, 0.55, -0.35)),
      ];
      break;
    case 'cactus':
      parts = [
        colorized(new THREE.CylinderGeometry(0.42, 0.5, 2.7, 7), 0x4d8b4a, transform(0, 1.35, 0)),
        colorized(new THREE.CylinderGeometry(0.24, 0.24, 1.1, 6), 0x4d8b4a, transform(0.6, 1.9, 0, 0, 0, -1.1)),
        colorized(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 6), 0x4d8b4a, transform(-0.52, 1.55, 0, 0, 0, 1.15)),
        colorized(new THREE.SphereGeometry(0.14, 6, 5), 0xffd36b, transform(0, 2.8, 0)),
      ];
      break;
    case 'rock':
      parts = [
        colorized(new THREE.DodecahedronGeometry(1.55, 0), 0x8a8478, transform(0, 1.0, 0, 0.2, 0.4, 0.1)),
        colorized(new THREE.DodecahedronGeometry(0.9, 0), 0x726c62, transform(1.1, 0.5, 0.5, 0.4, 1, 0.2)),
      ];
      break;
    case 'stone':
      parts = [
        colorized(new THREE.IcosahedronGeometry(1.3, 0), 0x8e897d, transform(0, 0.7, 0, 0.4, 0.8, 0.1)),
      ];
      break;
    case 'pillar':
      parts = [
        colorized(new THREE.CylinderGeometry(0.8, 1.05, 5.0, 8), 0xb7ad94, transform(0, 2.5, 0)),
        colorized(new THREE.BoxGeometry(2.0, 0.4, 2.0), 0xc7bca1, transform(0, 0.2, 0)),
        colorized(new THREE.BoxGeometry(1.9, 0.38, 1.9), 0xa79d86, transform(0, 4.9, 0, 0, 0.2, 0.03)),
      ];
      break;
    case 'hut':
      parts = [
        colorized(new THREE.BoxGeometry(6, 3.4, 5), 0x9b7b52, transform(0, 1.7, 0)),
        colorized(new THREE.ConeGeometry(5.2, 2.9, 4), 0x6b4b2c, transform(0, 4.85, 0, 0, Math.PI / 4, 0)),
        colorized(new THREE.BoxGeometry(1.5, 2.1, 0.2), 0x3a2b1c, transform(0, 1.1, 2.56)),
        colorized(new THREE.BoxGeometry(0.9, 0.8, 0.15), 0xffd27a, transform(2.0, 1.9, 2.53)),
      ];
      break;
    case 'tower': {
      parts = [
        colorized(new THREE.CylinderGeometry(3.4, 4.2, 14, 10), 0xb3a791, transform(0, 7, 0)),
        colorized(new THREE.CylinderGeometry(4.4, 4.4, 0.9, 10), 0x928774, transform(0, 14.3, 0)),
        colorized(new THREE.CylinderGeometry(3.8, 4.0, 3, 10), 0xa29883, transform(0, 16.2, 0)),
        colorized(new THREE.ConeGeometry(4.9, 7, 8), 0x5b4a8f, transform(0, 21.7, 0)),
        colorized(new THREE.BoxGeometry(1.4, 2.4, 0.3), 0xffd77e, transform(0, 11.5, 3.9)),
        colorized(new THREE.BoxGeometry(1.4, 2.4, 0.3), 0xffd77e, transform(2.6, 9.2, 2.9, 0, 0.75, 0)),
      ];
      break;
    }
    case 'brazier':
      parts = [
        colorized(new THREE.CylinderGeometry(1.0, 1.35, 1.0, 8), 0x958b78, transform(0, 0.5, 0)),
        colorized(new THREE.CylinderGeometry(0.75, 0.6, 0.3, 8), 0x7c7362, transform(0, 1.05, 0)),
        colorized(new THREE.SphereGeometry(0.62, 8, 6), 0xffb43c, transform(0, 1.25, 0)),
      ];
      break;
    case 'volcano':
      parts = [
        colorized(new THREE.ConeGeometry(17, 22, 11), 0x54463c, transform(0, 11, 0)),
        colorized(new THREE.CylinderGeometry(4.6, 5.2, 1.2, 9), 0x3a2c26, transform(0, 21.4, 0)),
        colorized(new THREE.CircleGeometry(3.4, 16), 0xff5a1f, transform(0, 21.95, 0, -Math.PI / 2)),
      ];
      break;
    default:
      parts = [colorized(new THREE.IcosahedronGeometry(1.2, 0), 0x8a8478, transform(0, 0.7, 0))];
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  propGeometryCache.set(type, merged);
  return merged;
}

// --------------------------------------------------------------------- mundo

export class WorldView {
  constructor(seed, quality = 'medium') {
    this.seed = seed;
    this.quality = quality;
    this.group = new THREE.Group();
    this.heightAt = (x, z) => terrainSample(x, z, seed).height;
    this.landmarks = [];
    this.storm = { cx: 0, cz: 0, r: 1750, next: null };
    this.stormTarget = { cx: 0, cz: 0, r: 1750, next: null };
    this.buildTerrain();
    this.buildWater();
    this.buildSky();
    this.buildProps();
    this.buildPickups();
    this.buildStorm();
    this.minimap = this.buildMinimap();
  }

  attach(scene) {
    scene.add(this.group);
  }

  detach(scene) {
    scene.remove(this.group);
  }

  buildTerrain() {
    const segments = this.quality === 'low' ? 96 : this.quality === 'high' ? 190 : 140;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const position = geo.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    const rockColor = new THREE.Color(0x8b8275);
    const temp = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const sample = terrainSample(x, z, this.seed);
      position.setY(i, sample.height);
      const palette = BIOME_COLORS[sample.biome] || BIOME_COLORS.grass;
      const noise = Math.sin(x * 0.13 + z * 0.31) * 0.5 + Math.sin(x * 0.041 - z * 0.083) * 0.5;
      const t = Math.min(1, Math.max(0, 0.5 + noise * 0.35 + (sample.moisture - 0.5) * 0.35));
      color.setHex(palette[0]).lerp(temp.setHex(palette[1]), t);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Las pendientes fuertes se ven como roca desnuda.
    const normals = geo.attributes.normal;
    for (let i = 0; i < position.count; i++) {
      const slope = 1 - normals.getY(i);
      if (slope > 0.16) {
        const k = Math.min(0.85, (slope - 0.16) * 2.4);
        color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]).lerp(rockColor, k);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
    }
    geo.attributes.color.needsUpdate = true;

    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geo, material);
    this.terrain.receiveShadow = false;
    this.group.add(this.terrain);
  }

  buildWater() {
    const geometry = new THREE.PlaneGeometry(3600, 3600, 70, 70);
    geometry.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x1b4f66) },
        uShallow: { value: new THREE.Color(0x53c7d6) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.055 + uTime * 1.1) * 0.24 + sin(p.z * 0.043 - uTime * 0.8) * 0.19;
          p.y += w;
          vWave = w;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          float t = smoothstep(-0.3, 0.32, vWave);
          vec3 color = mix(uDeep, uShallow, t);
          float sparkle = smoothstep(0.22, 0.38, vWave) * 0.35;
          color += sparkle;
          gl_FragColor = vec4(color, 0.84);
        }
      `,
    });
    this.water = new THREE.Mesh(geometry, this.waterMaterial);
    this.water.position.y = WATER_SURFACE;
    this.group.add(this.water);
  }

  buildSky() {
    const geometry = new THREE.SphereGeometry(3200, 32, 20);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x5c9fdd) },
        uBottom: { value: new THREE.Color(0xd8ecf4) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          vec3 color = mix(uBottom, uTop, smoothstep(-0.02, 0.65, h));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geometry, material);
    this.group.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x51603c, 1.25);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d2, 1.9);
    this.sun.position.set(520, 760, 340);
    this.group.add(this.sun);
    this.sun.target.position.set(0, 0, 0);
    this.group.add(this.sun.target);
  }

  buildProps() {
    if (!this.props || this.propMeshes) return;
    const groups = new Map();
    for (const prop of this.props) {
      if (!groups.has(prop.type)) groups.set(prop.type, []);
      groups.get(prop.type).push(prop);
    }
    this.propMeshes = [];
    for (const [type, list] of groups) {
      const geometry = propGeometry(type);
      const mesh = new THREE.InstancedMesh(geometry, propMaterial, list.length);
      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const euler = new THREE.Euler();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        euler.set(0, p.rot, 0);
        quat.setFromEuler(euler);
        matrix.compose(new THREE.Vector3(p.x, p.y, p.z), quat, new THREE.Vector3(p.s, p.s, p.s));
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.userData.shared = true;
      this.group.add(mesh);
      this.propMeshes.push(mesh);
    }

    // Brasas de los braseros y del volcán.
    const glowMat = new THREE.SpriteMaterial({
      color: 0xffb04a,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMaterial = glowMat;
    const glowTexture = makeGlowTexture();
    glowMat.map = glowTexture;
    for (const p of this.props || []) {
      if (p.type === 'brazier') {
        const sprite = new THREE.Sprite(glowMat);
        sprite.position.set(p.x, p.y + p.s * 1.5, p.z);
        sprite.scale.setScalar(p.s * 3.2);
        this.group.add(sprite);
      }
    }
  }

  // Se llama cuando llega la lista real de props del servidor/mundo compartido.
  setProps(props, landmarks) {
    this.props = props;
    this.landmarks = landmarks || [];
    this.buildProps();
  }

  buildPickups() {
    this.pickups = new PickupView(this);
    this.group.add(this.pickups.group);
  }

  buildStorm() {
    const wallGeometry = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
    this.stormMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
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
          float band = sin(vUv.y * 46.0 + uTime * 1.6 + sin(vUv.x * 40.0) * 2.0) * 0.5 + 0.5;
          float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
          vec3 color = mix(vec3(0.33, 0.14, 0.62), vec3(0.72, 0.52, 1.0), band);
          gl_FragColor = vec4(color, (0.12 + band * 0.2) * edge);
        }
      `,
    });
    this.stormWall = new THREE.Mesh(wallGeometry, this.stormMaterial);
    this.stormWall.position.y = 70;
    this.stormWall.scale.set(1750, 160, 1750);
    this.stormWall.renderOrder = 2;
    this.group.add(this.stormWall);

    const ringGeo = new THREE.RingGeometry(0.994, 1.0, 160);
    ringGeo.rotateX(-Math.PI / 2);
    this.stormRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xb47bff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.stormRing.position.y = 2.5;
    this.group.add(this.stormRing);

    const nextGeo = new THREE.RingGeometry(0.995, 1.0, 160);
    nextGeo.rotateX(-Math.PI / 2);
    this.nextRing = new THREE.Mesh(
      nextGeo,
      new THREE.MeshBasicMaterial({
        color: 0x8fe8ff,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.nextRing.position.y = 3;
    this.group.add(this.nextRing);
  }

  setStorm(storm) {
    if (!storm) return;
    this.stormTarget.cx = storm.cx;
    this.stormTarget.cz = storm.cz;
    this.stormTarget.r = storm.r;
    this.stormTarget.next = storm.next;
  }

  buildMinimap() {
    const size = 150;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const step = WORLD_SIZE / size;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = -WORLD_SIZE / 2 + (px + 0.5) * step;
        const z = -WORLD_SIZE / 2 + (py + 0.5) * step;
        const sample = terrainSample(x, z, this.seed);
        const base = MINIMAP_COLORS[sample.biome] || MINIMAP_COLORS.grass;
        const shade = 1 - Math.min(0.32, Math.max(0, sample.height) / 120);
        const noise = (Math.sin(x * 0.31 + z * 0.17) + Math.sin(x * 0.07 - z * 0.09)) * 3;
        const idx = (py * size + px) * 4;
        image.data[idx] = Math.max(0, Math.min(255, base[0] * shade + noise));
        image.data[idx + 1] = Math.max(0, Math.min(255, base[1] * shade + noise));
        image.data[idx + 2] = Math.max(0, Math.min(255, base[2] * shade + noise));
        image.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  update(dt, time) {
    if (this.waterMaterial) this.waterMaterial.uniforms.uTime.value = time;
    if (this.stormMaterial) this.stormMaterial.uniforms.uTime.value = time;
    if (this.pickups) this.pickups.update(time);
    const t = Math.min(1, dt * 3.2);
    this.storm.cx += (this.stormTarget.cx - this.storm.cx) * t;
    this.storm.cz += (this.stormTarget.cz - this.storm.cz) * t;
    this.storm.r += (this.stormTarget.r - this.storm.r) * t;
    this.stormWall.position.x = this.storm.cx;
    this.stormWall.position.z = this.storm.cz;
    this.stormWall.scale.x = this.storm.r;
    this.stormWall.scale.z = this.storm.r;
    this.stormRing.position.x = this.storm.cx;
    this.stormRing.position.z = this.storm.cz;
    this.stormRing.scale.set(this.storm.r, 1, this.storm.r);
    if (this.stormTarget.next) {
      this.nextRing.visible = true;
      this.nextRing.position.x = this.stormTarget.next.x;
      this.nextRing.position.z = this.stormTarget.next.z;
      this.nextRing.scale.set(this.stormTarget.next.r, 1, this.stormTarget.next.r);
    } else {
      this.nextRing.visible = false;
    }
    if (this.pickups) {
      this.pickups.group.visible = true;
    }
  }

  dispose() {
    if (this.pickups) this.pickups.dispose();
    this.group.traverse((object) => {
      if (object.userData.shared) return;
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const m of mats) {
          if (m === propMaterial) continue;
          m.dispose();
        }
      }
    });
    if (this.glowMaterial && this.glowMaterial !== propMaterial) this.glowMaterial.dispose();
  }
}

// -------------------------------------------------------------------- botín

const PICKUP_MAX = 220;
const RARITY_SCALE = { common: 0.82, uncommon: 0.9, rare: 1.0, epic: 1.08, legendary: 1.2 };

export class PickupView {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.items = new Map();
    this.dummy = new THREE.Object3D();
    const geometry = new THREE.OctahedronGeometry(0.8, 0);

    this.core = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      PICKUP_MAX
    );
    this.core.count = 0;
    this.core.frustumCulled = false;
    this.group.add(this.core);

    this.halo = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      PICKUP_MAX
    );
    this.halo.count = 0;
    this.halo.frustumCulled = false;
    this.group.add(this.halo);
    this.order = [];
  }

  setAll(list) {
    this.items.clear();
    for (const p of list) this.items.set(p.id, { ...p });
    this.rebuild();
  }

  add(p) {
    if (this.items.size >= PICKUP_MAX) return;
    this.items.set(p.id, { ...p });
    this.rebuild();
  }

  remove(id) {
    if (this.items.delete(id)) this.rebuild();
  }

  rebuild() {
    this.order = [...this.items.values()];
    const count = Math.min(this.order.length, PICKUP_MAX);
    this.core.count = count;
    this.halo.count = count;
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const p = this.order[i];
      if (p.kind === 'heal') color.setHex(0x7bffcf);
      else color.setHex((ELEMENTS[p.element] || ELEMENTS.fire).color);
      this.core.setColorAt(i, color);
      if (p.kind === 'heal') color.setHex(0x9dffe4);
      else color.setHex((RARITIES[p.rarity] || RARITIES.common).color);
      this.halo.setColorAt(i, color);
    }
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    for (const p of this.order) {
      if (p.y == null) p.y = this.world.heightAt(p.x, p.z);
    }
    this.update(0);
  }

  update(time) {
    if (!this.order) return;
    const count = this.core.count;
    for (let i = 0; i < count; i++) {
      const p = this.order[i];
      const scale = p.kind === 'heal' ? 0.8 : RARITY_SCALE[p.rarity] || 0.9;
      const y = (p.y || 0) + 1.55 + Math.sin(time * 2 + i * 1.7) * 0.16;
      this.dummy.position.set(p.x, y, p.z);
      this.dummy.rotation.set(0.2, time * 1.1 + i * 0.8, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.core.setMatrixAt(i, this.dummy.matrix);
      this.dummy.scale.setScalar(scale * (1.75 + Math.sin(time * 3 + i) * 0.12));
      this.dummy.rotation.y = -time * 0.6 + i;
      this.dummy.updateMatrix();
      this.halo.setMatrixAt(i, this.dummy.matrix);
    }
    this.core.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.core.geometry.dispose();
    this.core.material.dispose();
    this.halo.material.dispose();
  }
}

let glowTextureCache = null;
export function makeGlowTexture() {
  if (glowTextureCache) return glowTextureCache;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glowTextureCache = new THREE.CanvasTexture(canvas);
  return glowTextureCache;
}
