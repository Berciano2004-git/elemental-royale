// Materiales, texturas y geometrías procedurales de la magia.
//
// Nada de esto carga ficheros: las texturas se dibujan una vez en canvas y se
// comparten. Los materiales se crean por efecto (se liberan con la zona) pero
// todos usan el mismo entorno PBR, de modo que piedra, hielo, madera y agua
// reciben luz y reflejos coherentes con el escenario.

import * as THREE from 'three';

// ------------------------------------------------------------------ texturas

function canvas2d(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y) * amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function tex(canvas, { srgb = false, repeat = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

let noiseCache = null;
export function noiseTexture() {
  if (noiseCache) return noiseCache;
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2(x * 0.09, y * 0.09, 5);
      const grain = hash2(x, y) * 0.12;
      const value = Math.round((0.58 + n * 0.42 + grain) * 255);
      const i = (y * size + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  noiseCache = tex(canvas, { srgb: true, repeat: 2 });
  return noiseCache;
}

let smokeCache = null;
export function smokeTexture() {
  if (smokeCache) return smokeCache;
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const billow = fbm2(x * 0.055 + 3.1, y * 0.055 - 1.7, 4);
      const radial = Math.max(0, 1 - dist * (0.82 + billow * 0.3));
      const alpha = Math.pow(radial, 1.5) * (0.35 + billow * 0.95);
      const i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.min(255, Math.round(alpha * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
  smokeCache = tex(canvas);
  return smokeCache;
}

let blotchCache = null;
export function blotchTexture() {
  if (blotchCache) return blotchCache;
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const angle = Math.atan2(dy, dx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = 0.82 + Math.sin(angle * 5.0) * 0.08 + Math.sin(angle * 11.0 + 1.7) * 0.05;
      const radial = Math.max(0, 1 - dist / edge);
      const grain = 0.55 + fbm2(x * 0.07, y * 0.07, 4) * 0.7;
      const alpha = Math.pow(radial, 1.4) * grain;
      const i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.min(255, Math.round(alpha * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
  blotchCache = tex(canvas);
  return blotchCache;
}

let crackCache = null;
export function crackTexture() {
  if (crackCache) return crackCache;
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const crack = (x, y, angle, length, width) => {
    if (length < 5 || width < 0.4) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let px = x;
    let py = y;
    let a = angle;
    for (let i = 0; i < 5; i++) {
      a += (rand() - 0.5) * 0.9;
      px += Math.cos(a) * length * 0.22;
      py += Math.sin(a) * length * 0.22;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + rand() * 0.4})`;
    ctx.lineWidth = width;
    ctx.stroke();
    if (rand() < 0.75) crack(px, py, a + (rand() - 0.5) * 1.5, length * 0.65, width * 0.6);
  };
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + rand() * 0.4;
    crack(64, 64, angle, 34 + rand() * 18, 3.2);
  }
  crackCache = tex(canvas);
  return crackCache;
}

let barkCache = null;
export function barkTexture() {
  if (barkCache) return barkCache;
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const streak = fbm2(x * 0.28, y * 0.045, 4);
      const value = Math.round((0.42 + streak * 0.52) * 255);
      const i = (y * size + x) * 4;
      image.data[i] = Math.min(255, value * 1.12);
      image.data[i + 1] = Math.min(255, value * 0.86);
      image.data[i + 2] = Math.min(255, value * 0.64);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  barkCache = tex(canvas, { srgb: true, repeat: 2 });
  return barkCache;
}

let envCache = null;
export function environmentTexture() {
  if (envCache) return envCache;
  const width = 256;
  const height = 128;
  const { canvas, ctx } = canvas2d(width);
  canvas.height = height;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#7fa4d8');
  sky.addColorStop(0.42, '#cfe0ef');
  sky.addColorStop(0.52, '#f3e3c4');
  sky.addColorStop(0.56, '#6f7c52');
  sky.addColorStop(1, '#33372a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const sun = ctx.createRadialGradient(190, 34, 2, 190, 34, 44);
  sun.addColorStop(0, 'rgba(255,246,214,1)');
  sun.addColorStop(0.25, 'rgba(255,226,168,0.55)');
  sun.addColorStop(1, 'rgba(255,210,140,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(140, 0, 110, 90);
  envCache = new THREE.CanvasTexture(canvas);
  envCache.mapping = THREE.EquirectangularReflectionMapping;
  envCache.colorSpace = THREE.SRGBColorSpace;
  return envCache;
}

// ------------------------------------------------------------------ materiales

export function stoneMaterial(color = 0x8a7a62, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: noiseTexture(),
    bumpMap: noiseTexture(),
    bumpScale: 1.4,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: true,
    envMap: environmentTexture(),
    envMapIntensity: 0.55,
    ...options,
  });
}

export function crystalMaterial(color = 0xbfefff, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    flatShading: true,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.22,
    envMap: environmentTexture(),
    envMapIntensity: 1.8,
    ...options,
  });
}

export function barkMaterial(color = 0x6b4a2a) {
  return new THREE.MeshStandardMaterial({
    color,
    map: barkTexture(),
    bumpMap: barkTexture(),
    bumpScale: 2,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    envMap: environmentTexture(),
    envMapIntensity: 0.4,
  });
}

export function leafMaterial(color = 0x4f8f46) {
  return new THREE.MeshStandardMaterial({
    color,
    map: noiseTexture(),
    roughness: 0.86,
    metalness: 0,
    flatShading: true,
    envMap: environmentTexture(),
    envMapIntensity: 0.5,
  });
}

const FIRE_NOISE = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += noise3(p) * amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }
`;

// Fuego volumétrico: una cáscara que se desplaza y se erosiona con ruido 3D.
// No es un sprite: tiene grosor, silueta irregular y borde Fresnel.
export function fireShellMaterial(innerColor = 0xffe3a3, outerColor = 0xff5a12) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uRadius: { value: 2 },
      uInner: { value: new THREE.Color(innerColor) },
      uOuter: { value: new THREE.Color(outerColor) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uRadius;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec3 p = position;
        float flicker = sin(p.x * 2.4 + uTime * 3.1) * sin(p.y * 3.0 - uTime * 2.3) * sin(p.z * 2.6 + uTime * 2.7);
        p += normal * flicker * uRadius * 0.075;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uInner;
      uniform vec3 uOuter;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      ${FIRE_NOISE}
      void main() {
        float n = fbm3(vec3(vUv * 4.5, uTime * 0.85));
        float detail = fbm3(vec3(vUv * 11.0 + 2.0, uTime * 1.6));
        float density = smoothstep(0.2, 0.82, n * 0.75 + detail * 0.35 + (1.0 - vUv.y) * 0.28);
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float low = pow(1.0 - vUv.y, 1.4);
        vec3 color = mix(uOuter, uInner, clamp(low * 0.85 + density * 0.35, 0.0, 1.0));
        color = mix(color, vec3(1.0, 0.97, 0.86), smoothstep(0.7, 1.0, density) * low * 0.8);
        float alpha = density * (0.34 + rim * 0.5) * smoothstep(0.0, 0.16, vUv.y) * uFade;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  material.userData.autoTime = true;
  return material;
}

// Agua con volumen: ondas en el vértice, Fresnel, espuma y brillo especular.
export function waterMaterial(deep = 0x0d4f78, foam = 0x9fe8ff) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uDeep: { value: new THREE.Color(deep) },
      uFoam: { value: new THREE.Color(foam) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec3 p = position;
        float wave = sin(uv.y * 18.0 - uTime * 5.5 + sin(uv.x * 9.0 + uTime * 1.7) * 2.0);
        p += normal * wave * 0.055;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      ${FIRE_NOISE}
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        float ripple = fbm3(vec3(vUv * 6.0, uTime * 0.5));
        float streak = smoothstep(0.58, 0.95, sin(vUv.y * 34.0 - uTime * 7.0 + ripple * 4.0) * 0.5 + 0.5);
        vec3 color = mix(uDeep, uFoam, fres * 0.75 + streak * 0.3 + ripple * 0.12);
        float alpha = (0.48 + fres * 0.4 + streak * 0.15) * uFade;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  material.userData.autoTime = true;
  return material;
}

export function energyMaterial(color = 0xff7bf0, options = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uDensity: { value: options.density ?? 1 },
      uSpeed: { value: options.speed ?? 7 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec3 p = position;
        p += normal * sin(uv.y * 26.0 - uTime * 9.0) * 0.018;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uColor;
      uniform float uDensity;
      uniform float uSpeed;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      ${FIRE_NOISE}
      void main() {
        float n = fbm3(vec3(vUv * 7.0, uTime * uSpeed * 0.16));
        float arc = smoothstep(0.55, 0.92, n);
        float band = pow(sin(vUv.y * 30.0 - uTime * uSpeed + n * 6.0) * 0.5 + 0.5, 7.0);
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        vec3 color = mix(uColor, vec3(1.0), clamp(arc * 0.8 + band * 0.6, 0.0, 1.0));
        float alpha = (0.12 + arc * 0.5 + band * 0.4 + fres * 0.25) * uFade * uDensity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  material.userData.autoTime = true;
  return material;
}

export function darkMaterial(color = 0x2a1140, rim = 0xb06bff) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uRim: { value: new THREE.Color(rim) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec3 p = position;
        p += normal * sin(uv.y * 14.0 + uTime * 1.4) * 0.03;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uColor;
      uniform vec3 uRim;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      ${FIRE_NOISE}
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
        float wisp = fbm3(vec3(vUv * 5.0, uTime * 0.25));
        vec3 color = mix(uColor, uRim, fres * 0.85 + wisp * 0.18);
        float alpha = (0.34 + wisp * 0.25 + fres * 0.3) * uFade;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  material.userData.autoTime = true;
  return material;
}

export function smokeSprite(color = 0x222222, opacity = 0.35, scale = 10) {
  const material = new THREE.SpriteMaterial({
    map: smokeTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

// ------------------------------------------------------------------ geometrías

function hashPoint(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function rockGeometry(radius = 1, detail = 1) {
  const geometry = new THREE.DodecahedronGeometry(radius, detail);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const noise = hashPoint(x, y, z);
    const factor = 0.78 + noise * 0.4;
    position.setXYZ(i, x * factor, y * factor, z * factor);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function stoneBlockGeometry(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const edge = Math.abs(x) > width * 0.45 || Math.abs(y) > height * 0.45 || Math.abs(z) > depth * 0.45;
    if (!edge) continue;
    const n = hashPoint(x, y, z) - 0.5;
    position.setXYZ(i, x + n * width * 0.07, y + n * height * 0.05, z + n * depth * 0.07);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function crystalShard(radius = 4, height = 20) {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(radius, height * 0.5, radius);
  return geometry;
}

export function crystalCluster(radius = 8, count = 5, color = 0xbfefff) {
  const group = new THREE.Group();
  const material = crystalMaterial(color);
  for (let i = 0; i < count; i++) {
    const spread = i === 0 ? 0 : radius * (0.35 + Math.random() * 0.6);
    const angle = Math.random() * Math.PI * 2;
    const height = radius * (0.9 + Math.random() * 1.7);
    const shard = new THREE.Mesh(crystalShard(radius * (0.16 + Math.random() * 0.14), height), material);
    shard.position.set(Math.cos(angle) * spread, height * 0.5 - radius * 0.1, Math.sin(angle) * spread);
    shard.rotation.set((Math.random() - 0.5) * 0.45, Math.random() * Math.PI, (Math.random() - 0.5) * 0.45);
    group.add(shard);
  }
  return group;
}

export function rootGeometry(length = 30, radius = 3) {
  const points = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    points.push(new THREE.Vector3(
      Math.sin(t * 4.2 + length) * radius * 1.6 * t,
      t * length,
      Math.cos(t * 3.1 + length) * radius * 1.2 * t
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 16, radius, 6, false);
}

// ------------------------------------------------------------------ suelo

function planar(radius, material, y = 0.22) {
  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.renderOrder = 1;
  return mesh;
}

// Mancha de terreno: hollín, agua, escarcha, musgo o arena. Sustituye a los
// discos luminosos por una calcomanía con borde irregular y textura.
export function groundDecal(style, radius, options = {}) {
  const styleKey = style || 'earth';
  const palette = {
    fire: [0x2a1510, 0.62], magma: [0x2a1208, 0.7], wildfire: [0x2a1a0e, 0.6],
    water: [0x0a2c42, 0.5], ice: [0xd8f4ff, 0.34], crystal: [0x9fdcff, 0.32],
    earth: [0x3f2f1e, 0.55], sand: [0xb99a68, 0.38], poison: [0x203a1e, 0.5],
    nature: [0x274a28, 0.45], dark: [0x0a0512, 0.68], abyss: [0x0c0620, 0.7],
    cursed: [0x140a1e, 0.62], lightning: [0x1c1630, 0.5], plasma: [0x2a1030, 0.55],
    steam: [0x9fb8c8, 0.2], storm: [0x1f1a33, 0.45], frost: [0xd8eaff, 0.3],
    blizzard: [0xd8ecff, 0.32], polar: [0xbfe6ff, 0.3], glacial: [0xa8d8e8, 0.3],
    thermal: [0x2a1a18, 0.5], magmawater: [0x2a1a14, 0.55], electricwater: [0x102a3a, 0.5],
    vital: [0x1e3a24, 0.45], overgrowth: [0x1e3a1e, 0.5], mud: [0x3a2a18, 0.7],
    hurricane: [0x24203a, 0.42], sandstorm: [0x5a4428, 0.42],
  };
  const [tint, opacity] = palette[styleKey] || [0x2a2a24, 0.42];
  const group = new THREE.Group();
  const base = new THREE.MeshBasicMaterial({
    map: blotchTexture(),
    color: tint,
    transparent: true,
    opacity: (options.opacity ?? 1) * opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    toneMapped: false,
  });
  group.add(planar(radius, base));

  const cracked = ['fire', 'magma', 'wildfire', 'lightning', 'plasma', 'earthquake', 'thermal', 'earth', 'crystal', 'dark', 'abyss'].includes(styleKey);
  if (cracked) {
    const glowColor =
      styleKey === 'ice' || styleKey === 'crystal' ? 0x9fe8ff
        : styleKey === 'dark' || styleKey === 'abyss' ? 0xb06bff
          : styleKey === 'lightning' ? 0xd8d0ff
            : styleKey === 'plasma' ? 0xff7bf0
              : styleKey === 'earth' ? 0x7a5a34 : 0xff7a24;
    const cracks = new THREE.MeshBasicMaterial({
      map: crackTexture(),
      color: glowColor,
      transparent: true,
      opacity: 0.5 * (options.opacity ?? 1),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      toneMapped: false,
    });
    group.add(planar(radius * 0.92, cracks, 0.26));
  }
  return group;
}

export function crackGlow(radius, color = 0xff7a24, opacity = 0.6) {
  const material = new THREE.MeshBasicMaterial({
    map: crackTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  return planar(radius, material, 0.28);
}

export function hazeMaterial(color = 0xbfe6ff, opacity = 0.16) {
  return new THREE.SpriteMaterial({
    map: smokeTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}
