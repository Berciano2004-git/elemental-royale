// Escena de partida: cámara en tercera persona, mundo, magos, hechizos y predicción local.

import * as THREE from 'three';
import { ELEMENTS, HALF_WORLD, PLAYER_RADIUS, PLAYER_SPEED } from '../../shared/constants.js';
import { moveWithCollision, normalizeInput } from '../../shared/movement.js';
import { createWorld } from '../../shared/worldgen.js';
import { WorldView } from './world.js';
import { EffectsView } from './effects.js';
import { createWizard } from './wizard.js';

const UP = new THREE.Vector3(0, 1, 0);

export class GameView {
  constructor(canvas, quality = 'medium') {
    this.canvas = canvas;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe7f2, 650, 1850);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 4200);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.setQuality(quality);
    this.clock = new THREE.Clock();
    this.zoom = 30;
    this.admin = null;
    this.onAdminValueChange = null;
    this.jumpY = 0;
    this.jumpV = 0;
    this.mvX = 0;
    this.mvZ = 0;
    this.frozen = false;
    this.debugGroup = null;
    this.debugAxes = null;
    this.debugCapsule = null;
    this.debugPropTimer = 0;
    this.debugProps = [];
    this.debugSignature = null;
    this.fps = 60;
    this.aim = new THREE.Vector3(0, 0, 10);
    this.aimMarker = null;
    this.world = null;
    this.worldData = null;
    this.effects = null;
    this.states = new Map();
    this.selfId = 0;
    this.selfPred = { x: 0, z: 0 };
    this.selfMoving = false;
    this.jumpTimer = 0;
    this.lastSnapshot = null;
    this.input = { up: false, down: false, left: false, right: false, sprint: false };
    this.spectateId = 0;
    this.matchActive = false;
    this.time = 0;
    this.stormCollisionMemo = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(quality) {
    this.quality = quality;
    const ratio = quality === 'high' ? 2 : quality === 'low' ? 1 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.resize();
  }

  adminValue(key, fallback) {
    const value = this.admin ? this.admin[key] : undefined;
    return Number.isFinite(value) ? value : fallback;
  }

  adminFlag(key, fallback) {
    const value = this.admin ? this.admin[key] : undefined;
    return typeof value === 'boolean' ? value : fallback;
  }

  sizeXZ() {
    return this.adminValue('size.scale', 1) * Math.max(this.adminValue('size.x', 1), this.adminValue('size.z', 1));
  }

  collisionRadius() {
    return this.adminValue('physics.capsuleRadius', PLAYER_RADIUS) * this.sizeXZ();
  }

  characterScaleY() {
    return this.adminValue('size.scale', 1) * this.adminValue('size.y', 1);
  }

  setAdmin(values) {
    this.admin = values || null;
    const fov = this.adminValue('camera.fov', 52);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const min = this.adminValue('camera.minDistance', 18);
    const max = Math.max(min + 1, this.adminValue('camera.maxDistance', 60));
    this.zoom = Math.max(min, Math.min(max, this.adminValue('camera.distance', this.zoom)));
    this.setFrozen(this.adminFlag('debug.freeze', false));
    if (this.effects) {
      this.effects.particles.intensity = this.adminValue('magic.vfx', 1);
      this.effects.projectileScale = this.adminValue('magic.projectileSize', 1);
    }
    const signature = [
      this.adminFlag('debug.skeleton', false),
      this.adminFlag('debug.axes', false),
      this.adminFlag('debug.colliders', false),
      this.collisionRadius().toFixed(2),
      this.adminValue('physics.capsuleHeight', 3.2).toFixed(2),
    ].join('|');
    if (signature !== this.debugSignature) {
      this.debugSignature = signature;
      this.applyDebugVisuals();
    }
  }

  setFrozen(frozen) {
    this.frozen = !!frozen;
    if (this.frozen) {
      this.mvX = 0;
      this.mvZ = 0;
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  async startMatch(data) {
    this.clearMatch();
    this.seed = data.seed;
    this.selfId = data.you;
    this.time = 0;
    this.matchActive = true;
    this.worldData = createWorld(data.seed);

    // La construcción es síncrona para que la partida no se quede colgada
    // si la pestaña está en segundo plano (los temporizadores se pausan).
    this.world = new WorldView(data.seed, this.quality);
    this.world.setProps(this.worldData.props, this.worldData.landmarks);
    this.world.setStorm(data.storm);
    this.world.attach(this.scene);
    this.world.pickups.setAll(data.pickups || []);

    this.effects = new EffectsView(this.scene, this.world);
    this.effects.particles.intensity = this.adminValue('magic.vfx', 1);
    this.effects.projectileScale = this.adminValue('magic.projectileSize', 1);

    const selfInfo = (data.players || []).find((p) => p.id === this.selfId);
    if (selfInfo) {
      this.selfPred.x = selfInfo.x;
      this.selfPred.z = selfInfo.z;
      this.aim.set(selfInfo.x, 0, selfInfo.z + 12);
    }
    this.jumpY = 0;
    this.jumpV = 0;
    this.mvX = 0;
    this.mvZ = 0;
    this.debugProps = [];

    for (const info of data.players || []) {
      const isSelf = info.id === this.selfId;
      const model = createWizard(info.look);
      const height = this.worldData.heightAt(info.x, info.z);
      model.group.position.set(info.x, height, info.z);
      this.scene.add(model.group);
      this.states.set(info.id, {
        id: info.id,
        name: info.name,
        bot: info.bot,
        look: info.look,
        model,
        x: info.x,
        z: info.z,
        targetX: info.x,
        targetZ: info.z,
        yaw: 0,
        targetYaw: 0,
        jumpY: 0,
        targetJumpY: 0,
        hp: 100,
        shield: 0,
        alive: true,
        kills: 0,
        element: null,
        isSelf,
        deadAt: -1,
        slots: [null, null],
        active: 0,
      });
    }

    this.buildAimMarker();
    this.buildSelfMarker();
    this.camera.position.set(this.selfPred.x, 70, this.selfPred.z + 40);
    this.lastSnapshot = null;
    this.spectateId = this.selfId;
    this.updateCamera(1, true);
    this.debugSignature = null;
    this.applyDebugVisuals();
    this.render();
  }

  buildSelfMarker() {
    if (this.selfMarker) {
      this.scene.remove(this.selfMarker);
      this.selfMarker.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const geometry = new THREE.RingGeometry(1.25, 1.55, 36);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xf3c96b,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.selfMarkerMaterial = material;
    this.selfMarker = new THREE.Mesh(geometry, material);
    this.scene.add(this.selfMarker);
  }

  buildAimMarker() {
    if (this.aimMarker) {
      this.scene.remove(this.aimMarker);
      this.aimMarker.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.8, 1.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);
    const dotGeo = new THREE.CircleGeometry(0.22, 16);
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.y = 0.02;
    group.add(dot);
    this.aimMarker = group;
    this.aimRing = ringMat;
    this.aimDot = dotMat;
    this.scene.add(group);
  }

  setAimColor(color) {
    if (!this.aimMarker) return;
    this.aimRing.color.set(color);
    this.aimDot.color.set(color);
  }

  applySnapshot(snap) {
    this.lastSnapshot = snap;
    if (!this.world) return;
    this.world.setStorm(snap.storm);
    for (const p of snap.players) {
      const state = this.states.get(p.i);
      if (!state) continue;
      state.targetX = p.x;
      state.targetZ = p.z;
      state.targetYaw = p.yaw;
      state.targetJumpY = Number.isFinite(p.j) ? p.j : 0;
      state.hp = p.hp;
      state.shield = p.sh;
      state.kills = p.k;
      state.slots = p.sl;
      state.active = p.act;
      const slot = p.sl[p.act];
      const element = slot ? slot.e : null;
      if (element !== state.element) {
        state.element = element;
        state.model.setElement(element ? ELEMENTS[element].color : state.look.magic);
      }
      if (state.alive && !p.al) {
        state.alive = false;
        state.deadAt = this.time;
        state.model.setDead();
      } else if (!state.alive && p.al) {
        state.alive = true;
        state.deadAt = -1;
      }
      if (p.i === this.selfId) {
        this.selfSnapshot = p;
        const dist = Math.hypot(p.x - this.selfPred.x, p.z - this.selfPred.z);
        if (dist > 45) {
          this.selfPred.x = p.x;
          this.selfPred.z = p.z;
        } else if (dist > 5) {
          this.selfPred.x += (p.x - this.selfPred.x) * 0.22;
          this.selfPred.z += (p.z - this.selfPred.z) * 0.22;
        }
      }
    }

    for (const fx of snap.fx || []) {
      if (fx.k === 'take') {
        this.world.pickups.remove(fx.id);
      } else if (fx.k === 'spawnPickup') {
        this.world.pickups.add(fx.p);
      } else if (fx.k === 'cast') {
        const state = this.states.get(fx.i);
        if (state) state.model.flashCast();
      }
    }
    this.effects.processFx(snap.fx || []);
    this.effects.syncProjectiles(snap.projs || [], 0.016);
    this.effects.syncZones(snap.zones || [], 0.016);
  }

  computeAim(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane();
    const point = new THREE.Vector3();
    let guess = this.worldData ? this.worldData.heightAt(this.selfPred.x, this.selfPred.z) : 0;
    for (let i = 0; i < 4; i++) {
      plane.setFromNormalAndCoplanarPoint(UP, new THREE.Vector3(0, guess, 0));
      if (!raycaster.ray.intersectPlane(plane, point)) break;
      if (this.worldData) guess = this.worldData.heightAt(point.x, point.z);
    }
    if (Number.isFinite(point.x) && Number.isFinite(point.z)) {
      this.aim.set(
        Math.max(-HALF_WORLD + 20, Math.min(HALF_WORLD - 20, point.x)),
        0,
        Math.max(-HALF_WORLD + 20, Math.min(HALF_WORLD - 20, point.z))
      );
    }
    return this.aim;
  }

  update(dt, mouse) {
    this.time += dt;
    if (!this.matchActive || !this.world) {
      this.render();
      return;
    }
    const time = this.time;
    if (mouse && this.worldData) this.computeAim(mouse.x, mouse.y);

    const selfState = this.states.get(this.selfId);
    const snap = this.lastSnapshot;
    const selfSnap = this.selfSnapshot;

    // Predicción local del movimiento. Usa exactamente el mismo modelo de
    // aceleración que el servidor para que las instantáneas no tire del mago.
    if (selfState && selfState.alive && selfSnap) {
      const input = normalizeInput(
        (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0),
        (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0)
      );
      const aimYaw = Math.atan2(this.aim.x - this.selfPred.x, this.aim.z - this.selfPred.z);
      let mx = input.mx;
      let mz = input.mz;
      const strafe = this.adminValue('move.strafe', 1);
      const back = this.adminValue('move.back', 1);
      if (strafe !== 1 || back !== 1) {
        const fx = Math.sin(aimYaw);
        const fz = Math.cos(aimYaw);
        const rx = Math.cos(aimYaw);
        const rz = -Math.sin(aimYaw);
        const forward = mx * fx + mz * fz;
        const right = mx * rx + mz * rz;
        mx = fx * (forward < 0 ? forward * back : forward) + rx * right * strafe;
        mz = fz * (forward < 0 ? forward * back : forward) + rz * right * strafe;
      }

      let speed = this.adminValue('move.walkSpeed', PLAYER_SPEED);
      if (Array.isArray(selfSnap.sl) && selfSnap.sl.some((s) => s && s.e === 'wind')) speed *= 1.1;
      if (this.input.sprint && selfSnap.st > 2) speed *= this.adminValue('move.runMultiplier', 1.32);
      if (selfSnap.sf) speed *= 0.62;
      if (this.frozen) {
        mx = 0;
        mz = 0;
      }

      const airborne = this.jumpY > 0.01;
      const airFactor = airborne ? 0.15 + this.adminValue('move.airControl', 0.35) * 0.85 : 1;
      const rate = (mx || mz ? this.adminValue('move.accel', 30) : this.adminValue('move.decel', 30)) * airFactor;
      const k = 1 - Math.exp(-rate * dt);
      this.mvX += (mx * speed - this.mvX) * k;
      this.mvZ += (mz * speed - this.mvZ) * k;
      if (!mx && !mz && Math.hypot(this.mvX, this.mvZ) < 0.5) {
        this.mvX = 0;
        this.mvZ = 0;
      }

      const beforeX = this.selfPred.x;
      const beforeZ = this.selfPred.z;
      if (this.mvX || this.mvZ) {
        const result = moveWithCollision(
          this.worldData,
          this.selfPred.x,
          this.selfPred.z,
          this.mvX * dt,
          this.mvZ * dt,
          this.collisionRadius()
        );
        this.selfPred.x = result.x;
        this.selfPred.z = result.z;
      }
      this.selfMoving = Math.hypot(this.selfPred.x - beforeX, this.selfPred.z - beforeZ) > 0.05;
      if (this.selfMoving === false && (this.mvX || this.mvZ)) {
        this.mvX *= 0.2;
        this.mvZ *= 0.2;
      }
      selfState.targetYaw = aimYaw;
      selfState.x = this.selfPred.x;
      selfState.z = this.selfPred.z;
      let yawDiff = selfState.targetYaw - selfState.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      selfState.yaw += yawDiff * Math.min(1, dt * this.adminValue('move.turnSpeed', 14));

      // Salto balístico compartido con el servidor: altura y duración definen
      // la gravedad, y la caída puede ser más contundente que la subida.
      if (this.jumpY > 0 || this.jumpV !== 0) {
        if (this.adminFlag('physics.enabled', true)) {
          const h = this.adminValue('jump.height', 3.4);
          const t = Math.max(0.1, this.adminValue('jump.duration', 0.55));
          const g = (8 * h) / (t * t);
          const fall = this.jumpV < 0 ? this.adminValue('jump.fallForce', 1.25) : 1;
          this.jumpV -= g * fall * dt;
          this.jumpY += this.jumpV * dt;
          const maxH = this.adminValue('jump.maxHeight', 8);
          if (this.jumpY > maxH) {
            this.jumpY = maxH;
            this.jumpV = Math.min(0, this.jumpV);
          }
          if (this.jumpY <= 0) {
            this.jumpY = 0;
            this.jumpV = 0;
          }
        } else {
          this.jumpV = 0;
          this.jumpY = 0;
        }
      }
    } else {
      this.selfMoving = false;
      this.mvX = 0;
      this.mvZ = 0;
    }

    // Interpolación de los demás magos.
    for (const state of this.states.values()) {
      let moving = false;
      if (!state.isSelf) {
        const k = Math.min(1, dt * 12);
        const dx = state.targetX - state.x;
        const dz = state.targetZ - state.z;
        moving = Math.hypot(dx, dz) > 0.4;
        state.x += dx * k;
        state.z += dz * k;
        let diff = state.targetYaw - state.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        state.yaw += diff * Math.min(1, dt * 10);
      }
      if (!state.alive && state.deadAt >= 0 && time - state.deadAt > 2.4) {
        state.model.group.visible = false;
      }
      const groundY = this.worldData.heightAt(state.x, state.z);
      if (this.adminFlag('physics.groundSnap', true) || state.lastGroundY === undefined) {
        state.lastGroundY = groundY;
      }
      if (state.isSelf) state.jumpY = this.jumpY;
      else state.jumpY += ((state.targetJumpY || 0) - state.jumpY) * Math.min(1, dt * 18);
      const y = state.lastGroundY + state.jumpY;
      state.model.group.position.set(state.x, y, state.z);
      state.model.group.rotation.y = state.yaw;
      const sprinting = state.isSelf && this.selfMoving && !!this.input.sprint;
      state.model.update(dt, time + state.id * 0.7, state.isSelf ? this.selfMoving : moving, sprinting);
    }

    // Cámara.
    this.updateCamera(dt);

    // Anillo bajo el propio mago.
    if (this.selfMarker && selfState) {
      this.selfMarker.position.set(
        selfState.x,
        this.worldData.heightAt(selfState.x, selfState.z) + 0.16,
        selfState.z
      );
      this.selfMarker.visible = selfState.alive;
      this.selfMarkerMaterial.opacity = 0.38 + Math.sin(time * 3) * 0.1;
    }

    // Marcador de apuntado.
    if (this.aimMarker) {
      const activeSlot = selfSnap && Array.isArray(selfSnap.sl) ? selfSnap.sl[selfSnap.act] : null;
      const color = activeSlot ? ELEMENTS[activeSlot.e].color : 0xf3c96b;
      this.setAimColor(color);
      this.aimMarker.position.set(this.aim.x, this.worldData.heightAt(this.aim.x, this.aim.z) + 0.35, this.aim.z);
      this.aimMarker.visible = !!(selfState && selfState.alive);
      const pulse = 1 + Math.sin(time * 4) * 0.08;
      this.aimMarker.scale.setScalar(pulse);
    }

    this.world.update(dt, time);
    if (this.effects && snap) {
      this.effects.syncProjectiles(snap.projs || [], dt);
      this.effects.syncZones(snap.zones || [], dt);
      this.effects.update(dt, time);
    }
    if (this.selfSnapshot) {
      this.stormCollisionMemo = Math.hypot(this.selfPred.x - snap.storm.cx, this.selfPred.z - snap.storm.cz);
    }
    this.updateDebug(dt);
    this.render();
  }

  updateCamera(dt, immediate = false) {
    if (!this.worldData) return;
    let targetX = this.selfPred.x;
    let targetZ = this.selfPred.z;
    const selfState = this.states.get(this.selfId);
    if (selfState && !selfState.alive) {
      const alive = [...this.states.values()].filter((s) => s.alive);
      alive.sort((a, b) => b.kills - a.kills);
      if (alive.length) this.spectateId = alive[0].id;
      const spectated = this.states.get(this.spectateId);
      if (spectated) {
        targetX = spectated.x;
        targetZ = spectated.z;
      }
    }

    const min = this.adminValue('camera.minDistance', 18);
    const max = Math.max(min + 1, this.adminValue('camera.maxDistance', 60));
    this.zoom = Math.max(min, Math.min(max, this.zoom));
    const radius = this.zoom * 1.5;
    const pitch = (this.adminValue('camera.pitch', 54.8) * Math.PI) / 180;
    const cos = Math.cos(pitch);
    const sin = Math.sin(pitch);
    let distance = radius;

    // La cámara retrocede si su posición cae dentro de un árbol, una roca o el
    // agua; se queda en un mínimo para no pegarse al mago.
    if (this.adminFlag('camera.collision', true)) {
      for (let i = 0; i < 7; i++) {
        const cz = targetZ + distance * cos;
        if (this.worldData.canStand(targetX, cz, 0.45)) break;
        distance *= 0.86;
      }
      distance = Math.max(radius * 0.4, distance);
    }

    const camZ = targetZ + distance * cos;
    const groundY = this.worldData.heightAt(targetX, targetZ);
    const camGround = this.worldData.heightAt(targetX, camZ);
    const extra = this.adminValue('camera.height', 0);
    const desired = new THREE.Vector3(
      targetX,
      camGround + distance * sin + extra,
      camZ
    );
    if (this.adminFlag('camera.collision', true)) {
      desired.y = Math.max(desired.y, camGround + 1.8);
    }

    const jump = selfState ? selfState.jumpY : 0;
    const focus = new THREE.Vector3(targetX, groundY + 2.4 * this.characterScaleY() + jump, targetZ);
    const aimBias = new THREE.Vector3(this.aim.x - targetX, 0, this.aim.z - targetZ);
    if (aimBias.lengthSq() > 4) {
      aimBias.normalize().multiplyScalar(6 * this.adminValue('camera.sensitivity', 1));
      focus.x += aimBias.x;
      focus.z += aimBias.z;
    }
    if (immediate) {
      this.camera.position.copy(desired);
      this.camera.lookAt(focus);
      this.cameraLook = focus.clone();
    } else {
      const follow = 1 - Math.exp(-dt * this.adminValue('camera.follow', 7));
      const smooth = 1 - Math.exp(-dt * this.adminValue('camera.smooth', 10));
      this.camera.position.lerp(desired, follow);
      if (!this.cameraLook) this.cameraLook = focus.clone();
      this.cameraLook.lerp(focus, smooth);
      this.camera.lookAt(this.cameraLook);
    }
  }

  jump() {
    if (!this.matchActive || this.frozen || this.jumpY > 0.01) return false;
    if (!this.adminFlag('physics.enabled', true)) return false;
    const h = this.adminValue('jump.height', 3.4);
    const t = Math.max(0.1, this.adminValue('jump.duration', 0.55));
    if (h <= 0) return false;
    this.jumpV = (4 * h) / t;
    this.jumpY = 0.001;
    return true;
  }

  setZoom(delta) {
    const min = this.adminValue('camera.minDistance', 18);
    const max = Math.max(min + 1, this.adminValue('camera.maxDistance', 60));
    this.zoom = Math.max(min, Math.min(max, this.zoom + delta));
    this.onAdminValueChange?.({ 'camera.distance': Math.round(this.zoom * 10) / 10 });
  }

  // --------------------------------------------------------------- debug

  clearDebugGroup() {
    if (!this.debugGroup) return;
    this.scene.remove(this.debugGroup);
    this.debugGroup.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material && object.material !== this.debugMaterial) object.material.dispose();
    });
    if (this.debugMaterial) this.debugMaterial.dispose();
    this.debugMaterial = null;
    this.debugGroup = null;
    this.debugAxes = null;
    this.debugCapsule = null;
    this.debugProps = [];
  }

  applyDebugVisuals() {
    this.clearDebugGroup();
    if (!this.matchActive || !this.states.size) return;
    const self = this.states.get(this.selfId);
    if (!self) return;
    const group = new THREE.Group();
    group.renderOrder = 40;
    this.scene.add(group);
    this.debugGroup = group;

    if (this.adminFlag('debug.skeleton', false)) {
      const helper = new THREE.SkeletonHelper(self.model.rig);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.9;
      group.add(helper);
    }
    if (this.adminFlag('debug.axes', false)) {
      const axes = new THREE.AxesHelper(6);
      axes.material.depthTest = false;
      group.add(axes);
      this.debugAxes = axes;
    }
    if (this.adminFlag('debug.colliders', false)) {
      this.debugMaterial = new THREE.LineBasicMaterial({
        color: 0xff5d7a,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      });
      const geometry = new THREE.CapsuleGeometry(
        Math.max(0.1, this.collisionRadius()),
        Math.max(0.1, this.adminValue('physics.capsuleHeight', 3.2)),
        4,
        10
      );
      const material = new THREE.MeshBasicMaterial({ color: 0xf3c96b, wireframe: true, transparent: true, opacity: 0.55 });
      const capsule = new THREE.Mesh(geometry, material);
      capsule.visible = false;
      this.debugCapsule = capsule;
      group.add(capsule);
      this.debugPropTimer = 0;
    }
    group.visible = this.adminFlag('debug.skeleton', false) || this.adminFlag('debug.axes', false) || this.adminFlag('debug.colliders', false);
  }

  makeDebugRing(x, z, radius, material, color) {
    const points = [];
    const segments = 28;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const mat = material || new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65, depthTest: false });
    const ring = new THREE.Line(geometry, mat);
    ring.position.set(x, this.worldData.heightAt(x, z) + 0.15, z);
    return ring;
  }

  updateDebug(dt) {
    if (!this.debugGroup || !this.debugGroup.visible) return;
    const self = this.states.get(this.selfId);
    if (!self) return;
    if (this.debugAxes) {
      this.debugAxes.position.copy(self.model.group.position);
      this.debugAxes.rotation.y = self.yaw;
    }
    if (this.debugCapsule) {
      const height = this.adminValue('physics.capsuleHeight', 3.2);
      this.debugCapsule.position.set(self.x, self.model.group.position.y + height / 2, self.z);
      this.debugCapsule.visible = self.alive;
    }
    if (!this.adminFlag('debug.colliders', false)) return;
    this.debugPropTimer -= dt;
    if (this.debugPropTimer > 0) return;
    this.debugPropTimer = 0.45;
    for (const ring of this.debugProps) {
      this.debugGroup.remove(ring);
      ring.geometry.dispose();
    }
    this.debugProps = [];
    if (!this.worldData) return;
    const selfRing = this.makeDebugRing(self.x, self.z, this.collisionRadius(), null, 0xf3c96b);
    this.debugGroup.add(selfRing);
    this.debugProps.push(selfRing);
    let count = 0;
    for (const prop of this.worldData.props) {
      if (!prop.r || count >= 70) continue;
      if (Math.hypot(prop.x - self.x, prop.z - self.z) > 150) continue;
      const ring = this.makeDebugRing(prop.x, prop.z, prop.r, this.debugMaterial, 0xff5d7a);
      this.debugGroup.add(ring);
      this.debugProps.push(ring);
      count++;
    }
  }

  project(x, y, z) {
    const vector = new THREE.Vector3(x, y, z);
    vector.project(this.camera);
    const visible = vector.z < 1 && vector.z > -1;
    return {
      x: (vector.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth,
      y: (-vector.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight,
      visible,
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  clearMatch() {
    this.matchActive = false;
    this.debugSignature = null;
    this.clearDebugGroup();
    this.jumpY = 0;
    this.jumpV = 0;
    this.mvX = 0;
    this.mvZ = 0;
    if (this.world) {
      this.world.detach(this.scene);
      this.world.dispose();
      this.world = null;
    }
    if (this.effects) {
      this.effects.dispose();
      this.effects = null;
    }
    for (const state of this.states.values()) {
      this.scene.remove(state.model.group);
      state.model.dispose();
    }
    this.states.clear();
    if (this.aimMarker) {
      this.scene.remove(this.aimMarker);
      this.aimMarker.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.aimMarker = null;
    }
    if (this.selfMarker) {
      this.scene.remove(this.selfMarker);
      this.selfMarker.geometry.dispose();
      this.selfMarkerMaterial.dispose();
      this.selfMarker = null;
    }
    this.worldData = null;
    this.lastSnapshot = null;
    this.selfSnapshot = null;
    this.cameraLook = null;
  }
}
