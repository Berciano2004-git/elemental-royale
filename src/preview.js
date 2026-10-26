// Vista previa 3D del mago para menús y personalización.

import * as THREE from 'three';
import { createWizard } from './three/wizard.js';

export function createWizardPreview() {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  camera.position.set(0, 2.55, 8.9);
  camera.lookAt(0, 2.0, 0);

  // Luz neutra para el taller: los rellenos cian y violeta teñían la piel de
  // verde y falseaban el color de pelo y de túnica mientras se elegían.
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x3a3448, 1.45));
  const key = new THREE.DirectionalLight(0xfff1cf, 2.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa9c4ff, 1.15);
  rim.position.set(-6, 4, -5);
  scene.add(rim);
  const fill = new THREE.PointLight(0xffe6cf, 10, 20);
  fill.position.set(0, 2.2, 4.5);
  scene.add(fill);

  const platform = new THREE.Group();
  scene.add(platform);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 2.5, 0.4, 36),
    new THREE.MeshStandardMaterial({ color: 0x171c36, roughness: 0.85, metalness: 0.1 })
  );
  base.position.y = -0.2;
  platform.add(base);
  const rimRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.02, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xf3c96b, transparent: true, opacity: 0.85 })
  );
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.02;
  platform.add(rimRing);
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.018, 6, 64),
    new THREE.MeshBasicMaterial({ color: 0x7fa6ff, transparent: true, opacity: 0.5 })
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.01;
  platform.add(innerRing);

  const shards = [];
  for (let i = 0; i < 4; i++) {
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85 })
    );
    shard.userData.angle = (i / 4) * Math.PI * 2;
    shard.userData.radius = 2.15 + (i % 2) * 0.25;
    shard.userData.height = 1.1 + (i % 2) * 0.65;
    platform.add(shard);
    shards.push(shard);
  }

  let wizard = null;
  let look = null;
  let adminValues = null;
  let elementColor = null;
  let mounted = null;
  let observer = null;
  let raf = 0;
  let last = 0;
  let spin = 0;
  let dragged = false;
  let pointerDown = false;
  let lastPointerX = 0;
  let running = true;

  function rebuild() {
    if (wizard) {
      scene.remove(wizard.group);
      wizard.dispose();
    }
    wizard = createWizard(look);
    wizard.group.scale.setScalar(0.95);
    scene.add(wizard.group);
    if (adminValues) wizard.applyAdmin(adminValues);
    if (elementColor) wizard.setElement(elementColor);
  }

  function resize() {
    if (!mounted) return;
    const width = Math.max(1, mounted.clientWidth);
    const height = Math.max(1, mounted.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function mount(element) {
    if (!element || mounted === element) {
      resize();
      return;
    }
    mounted = element;
    element.appendChild(canvas);
    if (observer) observer.disconnect();
    observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    requestAnimationFrame(resize);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!mounted || !mounted.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    void dt;
    if (wizard) {
      const idle = Math.sin(now * 0.00055) * 0.42 + 0.16;
      wizard.group.rotation.y = spin + idle;
      wizard.group.position.y = Math.sin(now * 0.0012) * 0.035;
      wizard.update(dt, now * 0.001, false);
    }
    for (const shard of shards) {
      const a = shard.userData.angle + now * 0.00035;
      shard.position.set(
        Math.cos(a) * shard.userData.radius,
        shard.userData.height + Math.sin(now * 0.001 + a) * 0.16,
        Math.sin(a) * shard.userData.radius
      );
      shard.rotation.x = now * 0.0007;
      shard.rotation.y = now * 0.001;
    }
    renderer.render(scene, camera);
  }

  canvas.addEventListener('pointerdown', (event) => {
    pointerDown = true;
    dragged = false;
    lastPointerX = event.clientX;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointerDown) return;
    const dx = event.clientX - lastPointerX;
    lastPointerX = event.clientX;
    if (Math.abs(dx) > 0.5) dragged = true;
    spin += dx * 0.012;
  });
  window.addEventListener('pointerup', () => {
    pointerDown = false;
    void dragged;
  });

  const api = {
    mount,
    setLook(nextLook) {
      look = { ...nextLook };
      rebuild();
    },
    setElement(cssColor) {
      elementColor = cssColor;
      if (wizard) wizard.setElement(cssColor);
    },
    applyAdmin(values) {
      adminValues = values;
      if (wizard) wizard.applyAdmin(values);
    },
    resize,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
      if (wizard) wizard.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };

  look = {
    robe: '#5b4bd6',
    hat: 'pointy',
    hatColor: '#2b2440',
    staff: 'crystal',
    staffColor: '#8a5a2b',
    magic: '#63e6ff',
    skin: '#f2c7a0',
    hair: '#6b3f28',
  };
  rebuild();
  raf = requestAnimationFrame(frame);
  return api;
}
