// Interfaz de menús, personalización, sala, colección y resultados.

import {
  COMBOS,
  ELEMENTS,
  HAT_COLORS,
  HATS,
  HAIR_COLORS,
  MAGIC_COLORS,
  RARITIES,
  ROBE_COLORS,
  SKIN_COLORS,
  STAFF_COLORS,
  STAVES,
  defaultLook,
  elementCss,
  randomLook,
} from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const ICONS = { fire: '🔥', water: '💧', wind: '🌀', earth: '🪨' };

const STORAGE = {
  name: 'elementalRoyale.name',
  look: 'elementalRoyale.look',
  settings: 'elementalRoyale.settings',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function storeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible */
  }
}

const screenNames = ['home', 'customize', 'collection', 'settings', 'lobby', 'loading', 'end'];
const screens = Object.fromEntries(screenNames.map((name) => [name, $(`screen-${name}`)]));

let callbacks = {};
let currentScreen = 'home';
let returnScreen = 'home';
let collectionReturn = 'home';
let settingsReturn = 'home';
let customizeReturn = 'home';
let lobbyData = null;
let selfClientId = 0;
let pauseOpen = false;
let waitingOpen = false;
let saveTimer = null;
let nameTimer = null;

let look = loadJSON(STORAGE.look, defaultLook());
let name = (() => {
  try {
    return localStorage.getItem(STORAGE.name) || '';
  } catch {
    return '';
  }
})();
let settings = loadJSON(STORAGE.settings, { volume: 0.65, muted: false, quality: 'medium' });

function saveLook() {
  storeJSON(STORAGE.look, look);
}

function saveName() {
  try {
    localStorage.setItem(STORAGE.name, name);
  } catch {
    /* ignorar */
  }
}

function saveSettings() {
  storeJSON(STORAGE.settings, settings);
}

function showScreen(next) {
  for (const key of screenNames) {
    screens[key].classList.toggle('hidden', key !== next);
  }
  currentScreen = next;
  callbacks.onScreen?.(next);
}

function hideScreens() {
  for (const key of screenNames) screens[key].classList.add('hidden');
  currentScreen = 'none';
  callbacks.onScreen?.('none');
}

function flashSaveTag() {
  const tag = $('save-tag');
  tag.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => tag.classList.remove('show'), 1200);
}

function commitLook() {
  saveLook();
  flashSaveTag();
  callbacks.onLook?.(look);
}

function syncNameInputs() {
  $('input-name').value = name;
  $('customize-name').value = name;
  $('home-wizard-name').textContent = name || 'Mago Errante';
  $('lobby-wizard-name').textContent = name || 'Mago Errante';
}

function setLook(nextLook) {
  look = { ...defaultLook(), ...nextLook };
  syncCustomizer();
  saveLook();
  callbacks.onLook?.(look);
}

function setElementPreview(element) {
  callbacks.onPreviewElement?.(element ? elementCss(element) : null);
}

function openCustomize(from) {
  customizeReturn = from || currentScreen;
  hidePause();
  hideWaiting();
  syncCustomizer();
  showScreen('customize');
}

function closeCustomize() {
  saveLook();
  const target = customizeReturn;
  if (target === 'lobby') {
    showScreen('lobby');
    if (lobbyData?.inProgress) showWaiting(true);
  } else if (target === 'home') {
    showScreen('home');
  } else {
    showScreen('home');
  }
}

function openCollection(from) {
  collectionReturn = from || currentScreen;
  if (from === 'pause') hidePause();
  showScreen('collection');
}

function closeCollection() {
  if (collectionReturn === 'pause') {
    hideScreens();
    callbacks.onResumePause?.();
  } else {
    showScreen(collectionReturn === 'collection' ? 'home' : collectionReturn);
  }
}

function openSettings(from) {
  settingsReturn = from || currentScreen;
  showScreen('settings');
}

function closeSettings() {
  showScreen(settingsReturn || 'home');
}

// ------------------------------------------------------------ personalización

function buildSwatches(containerId, colors, field) {
  const container = $(containerId);
  container.innerHTML = '';
  for (const color of colors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.background = color;
    button.dataset.color = color;
    button.title = color;
    button.addEventListener('click', () => {
      look[field] = color;
      syncCustomizer();
      commitLook();
    });
    container.appendChild(button);
  }
}

function buildDots(containerId, items, field) {
  const container = $(containerId);
  container.innerHTML = '';
  for (const item of items) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.id = item.id;
    dot.title = item.name;
    container.appendChild(dot);
  }
  void field;
}

function syncCustomizer() {
  const hatIndex = Math.max(0, HATS.findIndex((h) => h.id === look.hat));
  const staffIndex = Math.max(0, STAVES.findIndex((s) => s.id === look.staff));
  $('hat-name').textContent = HATS[hatIndex].name;
  $('staff-name').textContent = STAVES[staffIndex].name;
  for (const dot of $('hat-dots').children) dot.classList.toggle('active', dot.dataset.id === look.hat);
  for (const dot of $('staff-dots').children) dot.classList.toggle('active', dot.dataset.id === look.staff);

  const fields = [
    ['robe-swatches', 'robe'],
    ['hatcolor-swatches', 'hatColor'],
    ['staffcolor-swatches', 'staffColor'],
    ['magic-swatches', 'magic'],
    ['hair-swatches', 'hair'],
    ['skin-swatches', 'skin'],
  ];
  for (const [containerId, field] of fields) {
    for (const swatch of $(containerId).children) {
      swatch.classList.toggle('active', swatch.dataset.color === look[field]);
    }
  }
  $('home-wizard-name').textContent = name || 'Mago Errante';
  $('customize-name').value = name;
  callbacks.onLook?.(look);
}

function cycleHat(direction) {
  let index = HATS.findIndex((h) => h.id === look.hat);
  index = (index + direction + HATS.length) % HATS.length;
  look.hat = HATS[index].id;
  syncCustomizer();
  commitLook();
}

function cycleStaff(direction) {
  let index = STAVES.findIndex((s) => s.id === look.staff);
  index = (index + direction + STAVES.length) % STAVES.length;
  look.staff = STAVES[index].id;
  syncCustomizer();
  commitLook();
}

// ------------------------------------------------------------------ lobby

function avatarStyle(player) {
  const robe = player.look?.robe || '#5b4bd6';
  const hat = player.look?.hatColor || '#2b2440';
  return `--av-a:${robe};--av-b:${hat};`;
}

function showLobby(data, clientId) {
  lobbyData = data;
  selfClientId = clientId ?? selfClientId ?? 0;
  const players = data.players || [];
  $('lobby-count').textContent = `${players.length} / ${data.capacity || 10}`;
  $('lobby-bots').textContent = data.bots ?? Math.max(0, (data.capacity || 10) - players.length);
  $('lobby-countdown').textContent = data.inProgress ? '…' : String(data.countdown ?? 0);
  $('lobby-title').textContent = data.inProgress ? 'Partida en curso' : 'Reuniendo magos…';
  const list = $('lobby-player-list');
  list.innerHTML = '';
  for (const player of players) {
    const row = document.createElement('div');
    row.className = 'lobby-player';
    const avatar = document.createElement('div');
    avatar.className = 'lobby-avatar';
    avatar.style.cssText = avatarStyle(player);
    avatar.textContent = '✦';
    const text = document.createElement('strong');
    text.textContent = player.name;
    row.append(avatar, text);
    if (player.id === selfClientId) {
      const chip = document.createElement('span');
      chip.className = 'you';
      chip.textContent = 'TÚ';
      row.appendChild(chip);
    } else if (player.id === data.hostId) {
      const chip = document.createElement('span');
      chip.className = 'you';
      chip.textContent = 'ANFITRIÓN';
      row.appendChild(chip);
    }
    list.appendChild(row);
  }
  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'fineprint';
    empty.textContent = 'Conectando con la sala…';
    list.appendChild(empty);
  }
  const isHost = data.hostId && data.hostId === selfClientId;
  $('btn-start').classList.toggle('hidden', !(isHost && !data.inProgress));
  $('lobby-status').textContent = data.inProgress
    ? 'La partida ya está en curso. Entrarás en la siguiente ronda; puedes personalizar a tu mago mientras esperas.'
    : isHost
      ? 'Eres el anfitrión. Puedes empezar ya o esperar a que se complete el círculo de magos.'
      : 'La partida comenzará automáticamente. Puedes editar tu mago mientras esperas.';
  $('lobby-url').textContent = location.host;
  $('lobby-wizard-name').textContent = name || 'Tu mago';
  const editing = ['customize', 'collection', 'settings'].includes(currentScreen);
  if (!editing) showWaiting(!!data.inProgress);
  if (!editing) {
    showScreen('lobby');
  }
}

function showWaiting(visible) {
  waitingOpen = visible;
  $('waiting-overlay').classList.toggle('hidden', !visible);
}

function setLobbyStatus(text) {
  $('lobby-status').textContent = text;
}

// ---------------------------------------------------------------- resultados

function showEnd(data, duration, selfName) {
  const victory = data.you?.place === 1;
  hidePause();
  hideWaiting();
  $('end-icon').textContent = victory ? '🏆' : '☠';
  $('end-eyebrow').textContent = victory ? 'VICTORIA' : 'FIN DE LA PARTIDA';
  $('end-title').textContent = victory ? '¡Último mago en pie!' : 'Derrotado';
  $('end-subtitle').textContent = victory
    ? 'La isla entera se rinde ante tu magia.'
    : data.winner
      ? `Ganador: ${data.winner.name} con ${data.winner.kills} eliminaciones.`
      : 'La tormenta arcana lo ha consumido todo.';
  $('end-place').textContent = `#${data.you?.place ?? 2}`;
  $('end-kills').textContent = String(data.you?.kills ?? 0);
  $('end-time').textContent = formatDuration(duration);
  const top = $('end-top');
  top.innerHTML = '';
  for (const row of data.top || []) {
    const item = document.createElement('div');
    item.className = 'end-row';
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = `#${row.place ?? '?'}`;
    const who = document.createElement('strong');
    who.textContent = row.name;
    const kills = document.createElement('span');
    kills.textContent = `${row.kills} eliminaciones`;
    item.append(pos, who, kills);
    top.appendChild(item);
  }
  void selfName;
  showScreen('end');
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showPause(visible) {
  pauseOpen = visible;
  $('pause').classList.toggle('hidden', !visible);
}

function hidePause() {
  showPause(false);
}

function hideWaiting() {
  showWaiting(false);
}

// ------------------------------------------------------------------ colección

function buildCollection() {
  const grid = $('collection-grid');
  grid.innerHTML = '';
  for (const [key, meta] of Object.entries(ELEMENTS)) {
    const color = elementCss(key);
    const card = document.createElement('article');
    card.className = 'element-card';
    card.style.setProperty('--el-glow', `${color}55`);
    card.style.setProperty('--el-soft', `${color}22`);
    card.style.setProperty('--el-line', `${color}66`);
    card.innerHTML = `
      <div class="element-card-head">
        <div class="element-orb">${ICONS[key]}</div>
        <div><h3>${meta.name}</h3><p class="element-passive">${meta.passive}</p></div>
      </div>
    `;
    for (let index = 0; index < meta.abilities.length; index++) {
      const ability = meta.abilities[index];
      const line = document.createElement('div');
      line.className = 'ability-line';
      line.innerHTML = `
        <div class="ability-key">${index === 0 ? 'LMB' : 'RMB'}</div>
        <div>
          <strong>${ability.name}</strong>
          <p>${ability.desc}</p>
          <div class="ability-stats">${ability.cd}s de recarga · ${ability.mana} maná${ability.range ? ` · alcance ${ability.range}` : ' · área personal'}</div>
        </div>
      `;
      card.appendChild(line);
    }
    grid.appendChild(card);
  }

  const rarityCard = document.createElement('article');
  rarityCard.className = 'element-card';
  rarityCard.style.setProperty('--el-glow', 'rgba(243,201,107,0.25)');
  rarityCard.style.setProperty('--el-soft', 'rgba(243,201,107,0.12)');
  rarityCard.style.setProperty('--el-line', 'rgba(243,201,107,0.3)');
  rarityCard.innerHTML = `
    <div class="element-card-head">
      <div class="element-orb">✦</div>
      <div><h3>Rarezas</h3><p class="element-passive">Cuanto más raro, más potencia. Ninguna es invencible.</p></div>
    </div>
  `;
  for (const [key, rarity] of Object.entries(RARITIES)) {
    const line = document.createElement('div');
    line.className = 'ability-line';
    const color = '#' + rarity.color.toString(16).padStart(6, '0');
    line.innerHTML = `
      <div class="ability-key" style="color:${color};border-color:${color}66">${key === 'common' ? 'C' : key === 'uncommon' ? 'U' : key === 'rare' ? 'R' : key === 'epic' ? 'E' : 'L'}</div>
      <div><strong style="color:${color}">${rarity.name}</strong><p>Multiplicador de daño ×${rarity.power.toFixed(2)}. Aparece con más frecuencia en cofres de lugares especiales.</p></div>
    `;
    rarityCard.appendChild(line);
  }
  grid.appendChild(rarityCard);

  const combosSection = document.createElement('div');
  combosSection.style.gridColumn = '1 / -1';
  combosSection.innerHTML = '<div class="eyebrow" style="margin-bottom:10px">Combinaciones elementales · tecla 3</div>';
  const comboGrid = document.createElement('div');
  comboGrid.className = 'combo-grid';
  for (const [pair, combo] of Object.entries(COMBOS)) {
    const [a, b] = pair.split('+');
    const tile = document.createElement('div');
    tile.className = 'combo-tile';
    tile.innerHTML = `
      <span>${ELEMENTS[a].name} + ${ELEMENTS[b].name}</span>
      <strong>${combo.name}</strong>
      <p>${combo.desc}</p>
      <p style="color:#8f9ac0;margin-top:6px">${combo.cd}s de recarga · ${combo.mana} maná</p>
    `;
    comboGrid.appendChild(tile);
  }
  combosSection.appendChild(comboGrid);
  grid.appendChild(combosSection);
}

// ------------------------------------------------------------------ ajustes

function syncSettings() {
  $('volume').value = String(Math.round(settings.volume * 100));
  $('mute').checked = !!settings.muted;
  $('quality').value = settings.quality || 'medium';
}

// ------------------------------------------------------------------- init

export const ui = {
  init(handlers) {
    callbacks = handlers || {};

    buildSwatches('robe-swatches', ROBE_COLORS, 'robe');
    buildSwatches('hatcolor-swatches', HAT_COLORS, 'hatColor');
    buildSwatches('staffcolor-swatches', STAFF_COLORS, 'staffColor');
    buildSwatches('magic-swatches', MAGIC_COLORS, 'magic');
    buildSwatches('hair-swatches', HAIR_COLORS, 'hair');
    buildSwatches('skin-swatches', SKIN_COLORS, 'skin');
    buildDots('hat-dots', HATS, 'hat');
    buildDots('staff-dots', STAVES, 'staff');
    buildCollection();
    syncSettings();
    syncNameInputs();
    syncCustomizer();

    $('btn-play').addEventListener('click', () => {
      callbacks.uiClick?.();
      callbacks.play?.();
    });
    $('btn-customize').addEventListener('click', () => openCustomize('home'));
    $('btn-customize-2').addEventListener('click', () => openCustomize('home'));
    $('btn-collection').addEventListener('click', () => openCollection('home'));
    $('btn-settings').addEventListener('click', () => openSettings('home'));
    $('btn-quit').addEventListener('click', () => callbacks.quit?.());
    $('btn-collection-close').addEventListener('click', closeCollection);
    $('btn-settings-close').addEventListener('click', closeSettings);
    $('btn-save-look').addEventListener('click', closeCustomize);
    $('btn-random-look').addEventListener('click', () => {
      look = randomLook();
      syncCustomizer();
      commitLook();
      callbacks.uiClick?.();
    });
    $('hat-prev').addEventListener('click', () => cycleHat(-1));
    $('hat-next').addEventListener('click', () => cycleHat(1));
    $('staff-prev').addEventListener('click', () => cycleStaff(-1));
    $('staff-next').addEventListener('click', () => cycleStaff(1));
    $('btn-start').addEventListener('click', () => {
      callbacks.uiClick?.();
      callbacks.start?.();
    });
    $('btn-again').addEventListener('click', () => callbacks.again?.());
    $('btn-lobby-customize').addEventListener('click', () => openCustomize('lobby'));
    $('btn-wait-customize').addEventListener('click', () => openCustomize('lobby'));
    $('btn-resume').addEventListener('click', () => callbacks.resume?.());
    $('btn-leave').addEventListener('click', () => callbacks.leave?.());
    $('btn-pause-collection').addEventListener('click', () => {
      hidePause();
      openCollection('pause');
    });
    $('volume').addEventListener('input', (event) => {
      settings.volume = Number(event.target.value) / 100;
      saveSettings();
      callbacks.onSettings?.(settings);
    });
    $('mute').addEventListener('change', (event) => {
      settings.muted = event.target.checked;
      saveSettings();
      callbacks.onSettings?.(settings);
    });
    $('quality').addEventListener('change', (event) => {
      settings.quality = event.target.value;
      saveSettings();
      callbacks.onSettings?.(settings);
    });

    const handleName = (value) => {
      name = value.slice(0, 20);
      saveName();
      syncNameInputs();
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => callbacks.onName?.(name), 450);
    };
    $('input-name').addEventListener('input', (event) => handleName(event.target.value));
    $('customize-name').addEventListener('input', (event) => handleName(event.target.value));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && document.activeElement === $('input-name')) {
        $('input-name').blur();
      }
      if (event.key === 'Enter' && document.activeElement === $('customize-name')) {
        $('customize-name').blur();
      }
    });

    showScreen('home');
  },

  showScreen,
  hideScreens,
  showLobby,
  showWaiting,
  hideWaiting,
  showEnd,
  showPause,
  hidePause,
  setLobbyStatus,
  setConnection(text, isError = false) {
    const el = $('connection-status');
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.classList.toggle('error', isError);
    el.textContent = text;
  },
  setLoadingTip(text) {
    $('loading-tip').textContent = text;
  },
  setPlayBusy(busy) {
    const button = $('btn-play');
    button.disabled = busy;
    button.style.opacity = busy ? '0.65' : '1';
    button.querySelector('.arrow').textContent = busy ? '…' : '➜';
  },
  openCustomize,
  openCollection,
  openSettings,
  getName: () => name,
  getLook: () => look,
  getSettings: () => ({ ...settings }),
  setSelfClientId(id) {
    selfClientId = id;
    if (lobbyData) showLobby(lobbyData, id);
  },
  getSelfClientId: () => selfClientId,
  isPaused: () => pauseOpen,
  currentScreen: () => currentScreen,
  toast: (text) => {
    $('connection-status').textContent = text;
    $('connection-status').classList.remove('hidden');
    setTimeout(() => $('connection-status').classList.add('hidden'), 3000);
  },
  previewLook: (nextLook) => setLook(nextLook),
  previewElement: (element) => setElementPreview(element),
};
