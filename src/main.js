// Punto de entrada del cliente: conecta menús, red, entrada, HUD y escena 3D.

import { GameView } from './three/gameview.js';
import { createWizardPreview } from './preview.js';
import { Net } from './net.js';
import { SoundEngine } from './audio.js';
import { hud } from './hud.js';
import { ui } from './ui.js';
import { ELEMENTS, RARITIES, comboFor, elementCss } from '../shared/constants.js';
import { biomeAt } from '../shared/worldgen.js';
import { createAdminPanel } from './admin/panel.js';
import './admin/admin.css';

const app = document.getElementById('app');
const sceneCanvas = document.getElementById('scene');
const swimCineEl = document.getElementById('swim-cine');
const initialSettings = ui.getSettings();

const preview = createWizardPreview();
const audio = new SoundEngine();
const net = new Net();
const gameView = new GameView(sceneCanvas, initialSettings.quality);
gameView.camera.position.set(0, 90, 60);

let inMatch = false;
let loadingMatch = false;
let joined = false;
let matchEnded = false;
let paused = false;
let selfId = 0;
let clientId = 0;
let lastSnapshot = null;
let selfSnapshot = null;
let previousHp = 100;
let wasAlive = true;
let inputTimer = null;
let lookTimer = null;
let nameTimer = null;
let footstepTimer = 0;
let regionTimer = 0;
let lastSpectateName = null;
let lastFrame = performance.now();
let fpsValue = 60;
let frameMs = 16.7;
let fpsFrames = 0;
let fpsAccum = 0;
let serverAllowsAdmin = false;
let tuneTimer = 0;
let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let orbiting = false;
const keys = new Set();

// La cinemática la dirige la escena (cámara); la interfaz solo abre y cierra
// las barras y el rótulo del plano.
window.addEventListener('wizard:cinematic', (event) => {
  const detail = event.detail || {};
  if (detail.kind !== 'swim' || !swimCineEl) return;
  const start = detail.phase === 'start';
  swimCineEl.classList.toggle('active', start);
  if (start) audio.splash();
});

audio.setVolume(initialSettings.volume);
audio.setMuted(initialSettings.muted);

// ------------------------------------------------------------------ admin

let admin = null;
admin = createAdminPanel({
  getInitialLook: () => ui.getLook(),
  applyValues: (values) => applyAdminValues(values),
  onOpenChange: (open) => {
    if (open) {
      keys.clear();
      orbiting = false;
      // El panel necesita el cursor: se suelta el puntero de la vista en
      // primera persona y se recupera al volver a la partida con un clic.
      document.exitPointerLock?.();
    }
  },
  debugInfo: () => {
    const self = gameView.states.get(selfId);
    const info = self?.model.clipInfo || { time: 0, duration: 1 };
    return {
      fps: fpsValue,
      frameMs,
      x: self?.x ?? gameView.selfPred.x,
      z: self?.z ?? gameView.selfPred.z,
      y: self?.model.group.position.y ?? 0,
      yaw: self?.yaw ?? 0,
      speed: gameView.selfMoving ? Math.hypot(gameView.mvX, gameView.mvZ) : 0,
      clip: self?.model.clip,
      clipTime: info.time,
      animPaused: !!admin?.values['anim.paused'],
      alive: !!self?.alive,
      frozen: gameView.frozen,
      server: serverAllowsAdmin,
      draws: gameView.renderer.info.render.calls,
      triangles: gameView.renderer.info.render.triangles,
      inMatch,
    };
  },
  scrub: (fraction) => gameView.states.get(selfId)?.model.scrub(fraction),
  restartAnimation: () => gameView.states.get(selfId)?.model.restartClip(),
  stepAnimation: (seconds) => gameView.states.get(selfId)?.model.stepClip(seconds),
  playClip: (name) => gameView.states.get(selfId)?.model.playClip(name),
  resumeAnimation: () => gameView.states.get(selfId)?.model.applyAdmin(admin.values),
  resetCamera: () => gameView.resetCamera(),
  teleport: (x, z) => requestTeleport({ x, z }),
  resetPosition: () => requestTeleport({ reset: true }),
  syncServer: () => {
    sendAdminTune();
    return serverAllowsAdmin;
  },
});

function applyAdminValues(values) {
  gameView.setAdmin(values);
  if (admin && Math.abs((values['camera.distance'] ?? 0) - gameView.zoom) > 0.01) {
    admin.setExternal({ 'camera.distance': gameView.zoom });
  }
  preview.applyAdmin?.(values);
  const self = gameView.states.get(selfId);
  if (self) self.model.applyAdmin(values);
  scheduleAdminTune();
}

// El taller y el panel de administración comparten los mismos colores. Si al
// elegir un tono solo se reconstruía la vista previa, el panel volvía a
// empujar su copia antigua y el pelo (o la túnica) recuperaba el color
// anterior. Se sincronizan los dos lados antes de repintar.
function lookColorValues(look) {
  return {
    'look.robe': look.robe,
    'look.hatColor': look.hatColor,
    'look.staffColor': look.staffColor,
    'look.skin': look.skin,
    'look.hair': look.hair,
    'look.magic': look.magic,
  };
}

function syncLookColors(look) {
  const colors = lookColorValues(look);
  admin?.setExternal(colors);
  applyAdminValues({ ...admin.values, ...colors });
}

function adminTunePayload() {
  const v = admin.values;
  return {
    walkSpeed: v['move.walkSpeed'],
    runMult: v['move.runMultiplier'],
    accel: v['move.accel'],
    decel: v['move.decel'],
    strafe: v['move.strafe'],
    back: v['move.back'],
    airControl: v['move.airControl'],
    jumpHeight: v['physics.enabled'] ? v['jump.height'] : 0,
    jumpDuration: v['jump.duration'],
    fallForce: v['jump.fallForce'],
    maxHeight: v['jump.maxHeight'],
    radius: v['physics.capsuleRadius'] * v['size.scale'] * Math.max(v['size.x'], v['size.z']),
    mass: v['physics.mass'],
    power: v['magic.power'],
    projSpeed: v['magic.projectileSpeed'],
    projSize: v['magic.projectileSize'],
    cooldown: v['magic.cooldown'],
    range: v['magic.range'],
    duration: v['magic.duration'],
    manaCost: v['magic.manaCost'],
    manaRegen: v['magic.manaRegen'],
  };
}

function sendAdminTune() {
  if (!serverAllowsAdmin || !inMatch || !net.connected) return;
  net.send('adminTune', { tune: adminTunePayload() });
}

function scheduleAdminTune() {
  if (!serverAllowsAdmin || !inMatch) return;
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(sendAdminTune, 140);
}

gameView.onAdminValueChange = (patch) => admin?.setExternal(patch);

function requestTeleport(payload) {
  if (!inMatch || !net.connected || !serverAllowsAdmin) return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = 0;
    const handler = (msg) => {
      clearTimeout(timer);
      net.handlers.delete('adminTeleport');
      resolve(!!msg.ok);
      if (!msg.ok && msg.msg) admin.notify(msg.msg, 'error');
    };
    net.on('adminTeleport', handler);
    net.send('adminTeleport', payload);
    timer = setTimeout(() => {
      net.handlers.delete('adminTeleport');
      resolve(false);
    }, 1800);
  });
}

// ------------------------------------------------------------------- menús

function mountPreviewForScreen(screen) {
  const targets = {
    home: 'preview-home',
    customize: 'preview-editor',
    lobby: 'preview-lobby',
  };
  const id = targets[screen];
  if (!id) return;
  const element = document.getElementById(id);
  if (!element) return;
  preview.mount(element);
  preview.setLook(ui.getLook());
  preview.setElement(null);
}

ui.init({
  onScreen: (screen) => mountPreviewForScreen(screen),
  onLook: (look) => {
    syncLookColors(look);
    preview.setLook(look);
    if (joined && !inMatch) {
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => net.send('look', { look }), 220);
    }
  },
  onPreviewElement: (color) => preview.setElement(color),
  onName: (name) => {
    hud.setPlayerName(name || 'Mago');
    if (joined && !inMatch) {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => net.send('join', { name, look: ui.getLook() }), 320);
    }
  },
  onSettings: (settings) => {
    audio.setVolume(settings.volume);
    audio.setMuted(settings.muted);
    gameView.setQuality(settings.quality);
  },
  play: joinGame,
  start: () => net.send('start'),
  again: () => {
    ui.showScreen('lobby');
    ui.setLobbyStatus('Preparando la siguiente ronda…');
    ui.showWaiting(true);
  },
  resume: () => setPaused(false),
  leave: leaveToHome,
  quit: quitGame,
  onResumePause: () => setPaused(true),
  uiClick: () => {
    audio.unlock();
    audio.uiClick();
  },
});

function quitGame() {
  audio.uiClick();
  ui.toast('Cierra la pestaña del navegador para salir del juego.');
  try {
    window.close();
  } catch {
    /* los navegadores suelen bloquearlo */
  }
}

async function joinGame() {
  audio.unlock();
  if (joined) {
    if (!inMatch) ui.showScreen('lobby');
    return;
  }
  ui.setPlayBusy(true);
  ui.setConnection('Conectando con la sala…');
  try {
    await net.connect();
    joined = true;
    net.send('join', { name: ui.getName(), look: ui.getLook() });
    ui.showScreen('lobby');
    ui.setLobbyStatus('Conectando con la sala…');
    ui.setConnection('');
    audio.setMusicMode('menu');
    audio.startMusic();
  } catch (error) {
    console.error(error);
    ui.setConnection('No se pudo conectar al servidor. Comprueba que esté arrancado e inténtalo de nuevo.', true);
  } finally {
    ui.setPlayBusy(false);
  }
}

function leaveToHome() {
  stopInputLoop();
  net.close();
  serverAllowsAdmin = false;
  admin.setServer(false);
  joined = false;
  inMatch = false;
  loadingMatch = false;
  matchEnded = false;
  paused = false;
  wasAlive = true;
  keys.clear();
  gameView.clearMatch();
  hud.show(false);
  hud.reset();
  hud.setSpectate(null);
  app.classList.remove('playing');
  ui.hidePause();
  ui.showWaiting(false);
  ui.setConnection('');
  ui.showScreen('home');
  audio.setMusicMode('menu');
  audio.startMusic();
  audio.setStormIntensity(0);
}

function setPaused(value) {
  if (!inMatch || matchEnded) {
    paused = false;
    ui.showPause(false);
    return;
  }
  paused = value;
  ui.showPause(value);
  if (value) {
    keys.clear();
    orbiting = false;
    swimCineEl?.classList.remove('active');
    gameView.skipCine();
    document.exitPointerLock?.();
  } else if (gameView.firstPerson && document.pointerLockElement !== sceneCanvas) {
    // Al reanudar en primera persona se recupera el puntero: el clic del botón
    // cuenta como gesto del usuario y el navegador lo permite.
    requestLookLock();
  }
}

function requestLookLock() {
  const request = sceneCanvas.requestPointerLock?.();
  // En navegadores antiguos devuelve undefined; en los nuevos, una promesa
  // que se rechaza si el documento aún no puede capturar el puntero.
  request?.catch?.(() => {});
}

// ------------------------------------------------------------------- red

net.on('welcome', (msg) => {
  clientId = msg.id;
  serverAllowsAdmin = !!msg.admin;
  admin.setServer(serverAllowsAdmin);
  ui.setSelfClientId(msg.id);
  if (msg.name) hud.setPlayerName(msg.name);
});

net.on('admin', (msg) => {
  if (typeof msg.enabled === 'boolean') {
    serverAllowsAdmin = msg.enabled;
    admin.setServer(msg.enabled);
  }
});

net.on('lobby', (msg) => {
  if (inMatch) return;
  joined = true;
  ui.setSelfClientId(clientId);
  ui.showLobby(msg, clientId);
  if (gameView.matchActive) {
    gameView.clearMatch();
    app.classList.remove('playing');
  }
});

net.on('start', (msg) => {
  void startMatch(msg);
});

net.on('snap', (msg) => {
  if (!inMatch || loadingMatch) return;
  if (!gameView.world) return;
  gameView.applySnapshot(msg);
  lastSnapshot = msg;
  selfSnapshot = msg.players.find((p) => p.i === selfId) || null;
  hud.update(msg, selfId);
  processFx(msg.fx || []);
  if (selfSnapshot) {
    const totalHp = selfSnapshot.hp + selfSnapshot.sh;
    if (totalHp < previousHp - 0.5) {
      hud.flashDamage();
      gameView.states.get(selfId)?.model.flashHit();
    }
    previousHp = totalHp;
    const alive = !!selfSnapshot.al;
    if (wasAlive && !alive) {
      hud.setSpectate('…');
      audio.death();
      previousHp = 0;
    }
    wasAlive = alive;
  }
  if (msg.storm && selfSnapshot) {
    const distance = Math.hypot(selfSnapshot.x - msg.storm.cx, selfSnapshot.z - msg.storm.cz);
    const outside = distance > msg.storm.r;
    const near = Math.max(0, 1 - (msg.storm.r - distance) / 260);
    audio.setStormIntensity(outside ? 1 : near * 0.35);
  }
});

net.on('end', (msg) => {
  if (!inMatch) return;
  inMatch = false;
  matchEnded = true;
  loadingMatch = false;
  stopInputLoop();
  const duration = lastSnapshot?.time || 0;
  hud.show(false);
  hud.setSpectate(null);
  app.classList.remove('playing');
  gameView.clearMatch();
  setPaused(false);
  ui.showWaiting(false);
  ui.showEnd(msg, duration, ui.getName());
  audio.setStormIntensity(0);
  audio.stopMusic();
  if (msg.you?.place === 1) audio.victory();
  else audio.defeat();
  previousHp = 100;
  wasAlive = false;
});

net.on('error', (msg) => {
  ui.setConnection(msg.msg || 'Error de conexión', true);
  ui.setPlayBusy(false);
});

net.onClose((manual, wasConnected) => {
  stopInputLoop();
  serverAllowsAdmin = false;
  admin.setServer(false);
  joined = false;
  if (manual) return;
  inMatch = false;
  loadingMatch = false;
  paused = false;
  gameView.clearMatch();
  hud.show(false);
  hud.reset();
  app.classList.remove('playing');
  ui.hidePause();
  ui.showWaiting(false);
  ui.showScreen('home');
  ui.setConnection(
    wasConnected ? 'Se perdió la conexión con la partida.' : 'No se pudo conectar con el servidor.',
    true
  );
  audio.setStormIntensity(0);
});

async function startMatch(msg) {
  inMatch = true;
  loadingMatch = true;
  matchEnded = false;
  paused = false;
  wasAlive = true;
  previousHp = 100;
  selfId = msg.you;
  lastSnapshot = null;
  selfSnapshot = null;
  keys.clear();
  setPaused(false);
  ui.showWaiting(false);
  ui.showPause(false);
  ui.showScreen('loading');
  ui.setLoadingTip('Tejiendo bosques, desiertos, montañas y mares…');
  hud.reset();
  hud.show(false);
  app.classList.remove('playing');
  const selfInfo = (msg.players || []).find((p) => p.id === selfId);
  if (selfInfo) hud.setPlayerName(selfInfo.name);
  audio.setMusicMode('battle');
  audio.startMusic();

  try {
    await gameView.startMatch(msg);
  } catch (error) {
    console.error(error);
    ui.setConnection('No se pudo generar el mundo. Inténtalo de nuevo.', true);
    inMatch = false;
    loadingMatch = false;
    ui.showScreen('home');
    return;
  }

  loadingMatch = false;
  applyAdminValues(admin.values);
  sendAdminTune();
  app.classList.add('playing');
  ui.hideScreens();
  hud.show(true);
  hud.setMinimapWorld(gameView.world.minimap);
  hud.setPlayerName(selfInfo?.name || ui.getName() || 'Mago');
  hud.toast('Recoge cristales y combina dos elementos', '#8fe8ff');
  ui.setConnection('');
  startInputLoop();
  sendInput();
}

// --------------------------------------------------------------- entrada

function isTyping() {
  const element = document.activeElement;
  return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
}

window.addEventListener('keydown', (event) => {
  if (isTyping()) return;
  if (admin.isOpen()) return;
  if (event.code === 'Escape') {
    if (inMatch && !matchEnded) {
      event.preventDefault();
      setPaused(!paused);
    }
    return;
  }
  if (!inMatch || matchEnded) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(event.code)) {
    event.preventDefault();
  }
  if (event.repeat) return;
  keys.add(event.code);
  if (paused) return;
  if (event.code === 'KeyV') toggleView();
  else if (event.code === 'Digit1') sendSelect(0);
  else if (event.code === 'Digit2') sendSelect(1);
  else if (event.code === 'Digit3') sendCombo();
  else if (event.code === 'Space') {
    if (gameView.skipCine()) return;
    if (gameView.jump()) {
      net.send('jump');
      audio.jump();
    }
  } else if (event.code === 'Tab') {
    event.preventDefault();
    setPaused(true);
  }
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

window.addEventListener('blur', () => {
  keys.clear();
  orbiting = false;
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 1) orbiting = false;
});

window.addEventListener('mousemove', (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
  if (orbiting) {
    const sensitivity = gameView.adminValue('camera.sensitivity', 1);
    gameView.orbitBy(
      (event.movementX || 0) * 0.0045 * sensitivity,
      -(event.movementY || 0) * 0.0035 * sensitivity
    );
    return;
  }
  // Si el navegador no concede el bloqueo del puntero (iframe, permisos),
  // mover el ratón sigue girando la vista; el primer clic vuelve a pedirlo.
  if (!gameView.firstPerson || paused || admin.isOpen() || ui.currentScreen() !== 'none') return;
  gameView.look(event.movementX || 0, event.movementY || 0);
});

// Si el navegador suelta el puntero (Esc, cambio de ventana), la partida se
// pausa igual que con Esc: sin bloqueo la cámara dejaría de responder.
document.addEventListener('pointerlockchange', () => {
  if (!gameView.firstPerson || document.pointerLockElement === sceneCanvas) return;
  if (paused || matchEnded || admin.isOpen() || ui.currentScreen() !== 'none') return;
  setPaused(true);
});

function toggleView() {
  if (!inMatch || matchEnded) return;
  const firstPerson = gameView.toggleFirstPerson();
  if (firstPerson) {
    requestLookLock();
    hud.toast('Primera persona · V cambia la vista', '#8fe8ff');
  } else {
    document.exitPointerLock?.();
    hud.toast('Vista elevada · Q/E gira la cámara', '#8fe8ff');
  }
}

sceneCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
sceneCanvas.addEventListener('auxclick', (event) => {
  if (event.button === 1) event.preventDefault();
});
sceneCanvas.addEventListener('mousedown', (event) => {
  if (!inMatch || loadingMatch || paused || matchEnded || admin.isOpen()) return;
  if (ui.currentScreen() !== 'none') return;
  // Botón central: orbitar la vista elevada sin lanzar ningún hechizo.
  if (event.button === 1) {
    if (gameView.firstPerson) return;
    event.preventDefault();
    orbiting = true;
    return;
  }
  if (!selfSnapshot || !selfSnapshot.al) return;
  if (event.button !== 0 && event.button !== 2) return;
  event.preventDefault();
  // El primer clic en primera persona captura el puntero en vez de lanzar.
  if (gameView.firstPerson && document.pointerLockElement !== sceneCanvas) {
    requestLookLock();
    return;
  }
  const ability = event.button === 0 ? 0 : 1;
  const slot = selfSnapshot.act;
  const power = selfSnapshot.sl[slot];
  if (!power) {
    hud.toast('Necesitas un poder. Busca un cristal elemental.', '#f3c96b');
    return;
  }
  const cds = selfSnapshot.cd[slot] || [0, 0];
  if (cds[ability] > 0) return;
  if (selfSnapshot.mn < ELEMENTS[power.e].abilities[ability].mana) {
    hud.toast('Maná insuficiente', '#82d8ff');
    return;
  }
  net.send('cast', {
    slot,
    ability,
    ax: gameView.aim.x,
    az: gameView.aim.z,
  });
  const state = gameView.states.get(selfId);
  state?.model.flashCast();
  audio.cast(power.e);
});

window.addEventListener('wheel', (event) => {
  if (!inMatch || admin.isOpen() || ui.currentScreen() !== 'none') return;
  gameView.setZoom(event.deltaY > 0 ? 2.2 : -2.2);
});

function sendSelect(slot) {
  if (!selfSnapshot || !selfSnapshot.sl[slot]) return;
  net.send('select', { slot });
  audio.uiClick();
}

function sendCombo() {
  if (!selfSnapshot) return;
  const a = selfSnapshot.sl[0];
  const b = selfSnapshot.sl[1];
  if (!a || !b) {
    hud.toast('Necesitas dos elementos equipados', '#f3c96b');
    return;
  }
  const combo = comboFor(a.e, b.e);
  if (!combo) return;
  if (selfSnapshot.cc > 0) {
    hud.toast(`La combinación se recarga en ${Math.ceil(selfSnapshot.cc)}s`, '#f3c96b');
    return;
  }
  if (selfSnapshot.mn < combo.mana) {
    hud.toast('Maná insuficiente para la combinación', '#82d8ff');
    return;
  }
  net.send('combo', { ax: gameView.aim.x, az: gameView.aim.z });
  gameView.states.get(selfId)?.model.flashCast();
  audio.combo();
}

function movementInput() {
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  return {
    up,
    down,
    left,
    right,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

function sendInput() {
  if (!inMatch || loadingMatch || matchEnded || paused || admin.isOpen() || admin.isFrozen()) {
    net.send('input', { mx: 0, mz: 0, ax: gameView.aim.x, az: gameView.aim.z, sprint: false });
    return;
  }
  const input = movementInput();
  // El servidor mueve con el vector en coordenadas del mundo: se gira aquí
  // con el rumbo de la cámara para que W vaya siempre hacia delante.
  const move = gameView.worldInput(input);
  net.send('input', {
    mx: move.mx,
    mz: move.mz,
    ax: gameView.aim.x,
    az: gameView.aim.z,
    sprint: input.sprint,
  });
}

function startInputLoop() {
  stopInputLoop();
  inputTimer = setInterval(sendInput, 50);
}

function stopInputLoop() {
  if (inputTimer) clearInterval(inputTimer);
  inputTimer = null;
}

// --------------------------------------------------------------- efectos

function selfPosition() {
  return gameView.selfPred || { x: 0, z: 0 };
}

function closeToSelf(x, z, radius = 520) {
  const self = selfPosition();
  return Math.hypot(self.x - x, self.z - z) <= radius;
}

function processFx(fxList) {
  for (const fx of fxList) {
    switch (fx.k) {
      case 'cast':
        if (closeToSelf(fx.x, fx.z, 380)) audio.cast(fx.el);
        break;
      case 'boom':
        if (closeToSelf(fx.x, fx.z, 620)) audio.impact('fire');
        break;
      case 'quake':
        if (closeToSelf(fx.x, fx.z, 620)) audio.impact('earth');
        break;
      case 'splash':
        if (closeToSelf(fx.x, fx.z, 500)) audio.impact('water');
        break;
      case 'gust':
        if (closeToSelf(fx.x, fx.z, 500)) audio.impact('wind');
        break;
      case 'hit':
        if (closeToSelf(fx.x, fx.z, 420)) audio.hit();
        break;
      case 'death':
        hud.pushFeed(fx.name, fx.by, fx.cause);
        if (closeToSelf(fx.x, fx.z, 700)) audio.death();
        if (fx.by) {
          hud.toast(`${fx.by} ha eliminado a ${fx.name}`, '#ff9aa8');
        }
        break;
      case 'pickup':
        if (fx.i === selfId) {
          const meta = ELEMENTS[fx.el];
          const rarity = RARITIES[fx.rarity] || RARITIES.common;
          hud.toast(`Has recogido ${meta.name} · ${rarity.name}`, elementCss(fx.el));
          audio.pickup(fx.rarity);
        }
        break;
      case 'heal':
        if (fx.i === selfId) {
          hud.toast('Cristal de vida · +28', '#7bffcf');
          audio.heal();
        }
        break;
      case 'combo':
        if (fx.i === selfId) hud.toast(`¡${fx.name}!`, '#f3c96b');
        if (closeToSelf(fx.x, fx.z, 700)) audio.combo();
        break;
      default:
        break;
    }
  }
}

// ------------------------------------------------------------------ bucle

function updateNameplates() {
  if (!inMatch || !gameView.worldData) return;
  const entries = [];
  const cameraPosition = gameView.camera.position;
  for (const state of gameView.states.values()) {
    if (state.isSelf || !state.alive) continue;
    const distance = Math.hypot(cameraPosition.x - state.x, cameraPosition.z - state.z);
    if (distance > 780) continue;
    const screen = gameView.project(state.x, state.model.group.position.y + (state.model.height || 4.5), state.z);
    const onScreen =
      screen.visible &&
      screen.x > -80 &&
      screen.x < window.innerWidth + 80 &&
      screen.y > -40 &&
      screen.y < window.innerHeight + 80;
    entries.push({
      id: state.id,
      name: state.name,
      bot: state.bot,
      hp: state.hp,
      x: screen.x,
      y: screen.y,
      visible: onScreen,
    });
  }
  hud.updateNameplates(entries);
}

function updateSpectate() {
  if (!selfSnapshot || selfSnapshot.al) {
    hud.setSpectate(null);
    lastSpectateName = null;
    return;
  }
  const alive = [...gameView.states.values()].filter((s) => s.alive);
  alive.sort((a, b) => b.kills - a.kills);
  const target = alive[0];
  const name = target ? target.name : null;
  if (name !== lastSpectateName) {
    lastSpectateName = name;
    if (name) hud.setSpectate(name);
  }
}

function updateAimCursor() {
  const active = selfSnapshot && selfSnapshot.al ? selfSnapshot.sl[selfSnapshot.act] : null;
  const color = active ? elementCss(active.e) : '#f3c96b';
  const visible =
    inMatch &&
    !loadingMatch &&
    !matchEnded &&
    !paused &&
    ui.currentScreen() === 'none' &&
    !!selfSnapshot &&
    !!selfSnapshot.al;
  // En primera persona la cruz vive en el centro: ahí apunta la cámara.
  const aimX = gameView.firstPerson ? window.innerWidth / 2 : mouse.x;
  const aimY = gameView.firstPerson ? window.innerHeight / 2 : mouse.y;
  hud.setAim(aimX, aimY, color, visible);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  fpsFrames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    fpsValue = fpsFrames / fpsAccum;
    frameMs = 1000 / Math.max(1, fpsValue);
    fpsFrames = 0;
    fpsAccum = 0;
  }

  if (gameView.matchActive) {
    const blocked = paused || admin.isOpen() || admin.isFrozen();
    gameView.input = blocked ? { up: false, down: false, left: false, right: false, sprint: false } : movementInput();
    if (!blocked) {
      gameView.orbitStep(
        dt,
        keys.has('KeyQ'),
        keys.has('KeyE'),
        keys.has('KeyR'),
        keys.has('KeyF')
      );
    }
    gameView.update(dt, mouse);
    updateNameplates();
    updateSpectate();
    updateAimCursor();

    if (gameView.selfMoving && !paused) {
      footstepTimer += dt;
      if (footstepTimer > 0.36) {
        footstepTimer = 0;
        audio.footstep();
      }
    } else {
      footstepTimer = 0.2;
    }

    regionTimer += dt;
    if (regionTimer > 1.2 && gameView.seed != null) {
      regionTimer = 0;
      const pos = selfPosition();
      const biome = biomeAt(pos.x, pos.z, gameView.seed);
      hud.setRegion(biome);
    }
  }
}

requestAnimationFrame(loop);

window.addEventListener('beforeunload', () => {
  net.close();
});

// Consola de depuración (útil para pruebas y para curiosos).
window.__elemental = {
  gameView,
  hud,
  ui,
  net,
  audio,
  preview,
  admin,
  get state() {
    return {
      inMatch,
      loadingMatch,
      joined,
      paused,
      matchEnded,
      selfId,
      clientId,
      snapshot: lastSnapshot,
      self: selfSnapshot,
    };
  },
  get keys() {
    return [...keys];
  },
};
