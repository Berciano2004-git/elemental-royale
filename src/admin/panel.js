// Panel de administrador en juego. Es una herramienta real: cada control lee y
// escribe el estado que consumen GameView, los magos y el servidor.

import {
  APPEARANCE_VARIANTS,
  GROUPS,
  PARAMS,
  PRESETS,
  clampNumber,
  gravityOf,
  makeDefaults,
  sanitizeValues,
} from './config.js';

const STORAGE = {
  live: 'elementalRoyale.admin.live',
  key: 'elementalRoyale.admin.key.v2',
  slot: 'elementalRoyale.admin.config',
  profiles: 'elementalRoyale.admin.profiles',
};

const DEFAULT_KEY = 'ñ';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function storeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento */
  }
}

function keyLabel(code) {
  if (!code) return '—';
  if (code === 'ñ') return 'Ñ';
  if (code === 'Escape') return 'Esc';
  if (code === 'Space') return 'Espacio';
  if (code.length === 1) return code.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Backquote') return '`';
  return code.replace('Arrow', '↑ ').replace('Left', '←').replace('Right', '→').replace('Up', '↑').replace('Down', '↓');
}

// Identifica la tecla por su carácter cuando es imprimible (por ejemplo, ñ en
// un teclado español, que llega con code "Semicolon") y por su código en el
// resto de casos (F1, flechas, Espacio…).
function keyToken(event) {
  const key = event?.key;
  if (key === ' ') return 'Space';
  if (typeof key === 'string' && key.length === 1) return key.toLowerCase();
  if (key === 'Dead' || key === 'Unidentified' || key === 'Process') return '';
  return event?.code || key || '';
}

function isTextField(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName !== 'INPUT') return false;
  const type = (target.getAttribute('type') || 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(type);
}

function isPrintableToken(token) {
  return token === 'Space' || (typeof token === 'string' && token.length === 1);
}

function decimalsOf(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function formatNumber(value, param) {
  if (!Number.isFinite(value)) return '—';
  const d = decimalsOf(param.step);
  return value.toFixed(Math.min(4, d));
}

function normalize(param, raw) {
  if (param.kind === 'toggle') return !!raw;
  if (param.kind === 'select') return (param.options || []).some((o) => o.id === raw) ? raw : undefined;
  if (param.kind === 'color') {
    if (typeof raw !== 'string') return undefined;
    let value = raw.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(value)) value = '#' + value.slice(1).split('').map((c) => c + c).join('');
    return COLOR_RE.test(value) ? value : undefined;
  }
  if (param.kind === 'text') return typeof raw === 'string' ? raw.slice(0, 24) : String(raw).slice(0, 24);
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (typeof param.min === 'number' && typeof param.max === 'number') {
    const clamped = clampNumber(n, param.min, param.max);
    return Number(clamped.toFixed(decimalsOf(param.step)));
  }
  return n;
}

export function createAdminPanel(adapter) {
  const defaults = makeDefaults(adapter.getInitialLook?.());
  const stored = sanitizeValues(loadJSON(STORAGE.live, null), defaults);
  const values = stored.values;
  const rowsByKey = new Map();
  const computedRows = new Set();
  const panes = new Map();
  let boundCode = DEFAULT_KEY;
  try {
    // La versión nueva de la tecla usa una clave de almacenamiento distinta:
    // así el antiguo F1 guardado no impide que el panel arranque con ñ.
    boundCode = localStorage.getItem(STORAGE.key) || DEFAULT_KEY;
  } catch {
    boundCode = DEFAULT_KEY;
  }
  let open = false;
  let activeTab = 'character';
  let rebinding = false;
  let serverEnabled = false;
  let saveTimer = 0;
  let toastTimer = 0;
  let telemetryTimer = 0;
  let drag = null;

  // ------------------------------------------------------------------ DOM

  const panel = el('div', 'admin-panel hidden');
  panel.id = 'admin-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Consola de administrador');

  const head = el('header', 'admin-head');
  const crest = el('div', 'admin-crest', '✦');
  const headCopy = el('div', 'admin-head-copy');
  const title = el('h2', null, 'Consola del Archimago');
  const subtitle = el('p', null, 'Ajustes en vivo del personaje y del mundo');
  headCopy.append(title, subtitle);
  const serverBadge = el('span', 'admin-badge', 'Servidor …');
  const keyButton = el('button', 'admin-key', 'Ñ');
  keyButton.type = 'button';
  keyButton.title = 'Cambiar la tecla de apertura';
  const minimizeButton = el('button', 'admin-icon-btn', '–');
  minimizeButton.type = 'button';
  minimizeButton.title = 'Minimizar';
  const closeButton = el('button', 'admin-icon-btn', '×');
  closeButton.type = 'button';
  closeButton.title = 'Cerrar (Esc)';
  head.append(crest, headCopy, serverBadge, keyButton, minimizeButton, closeButton);

  const tabs = el('nav', 'admin-tabs');
  const body = el('div', 'admin-body');
  const footer = el('footer', 'admin-foot');
  const status = el('span', 'admin-status', 'Listo');
  const saveButton = el('button', 'admin-btn', 'Guardar');
  const loadButton = el('button', 'admin-btn', 'Cargar');
  const exportButton = el('button', 'admin-btn', 'Exportar');
  const importButton = el('button', 'admin-btn', 'Importar');
  const resetButton = el('button', 'admin-btn danger', 'Restablecer todo');
  for (const button of [saveButton, loadButton, exportButton, importButton, resetButton]) button.type = 'button';
  footer.append(status, saveButton, loadButton, exportButton, importButton, resetButton);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className = 'admin-file';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) importFile(file);
    fileInput.value = '';
  });

  panel.append(head, tabs, body, footer, fileInput);

  const debugHud = el('div', 'admin-debug-hud hidden');
  debugHud.id = 'admin-debug-hud';
  document.body.append(panel, debugHud);

  // --------------------------------------------------------------- helpers

  function notify(text, tone = 'info') {
    status.textContent = text;
    status.classList.remove('ok', 'error');
    if (tone === 'ok') status.classList.add('ok');
    if (tone === 'error') status.classList.add('error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      status.textContent = 'Listo';
      status.classList.remove('ok', 'error');
    }, 4200);
  }

  function persistLive() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeJSON(STORAGE.live, values), 160);
  }

  function emit(changedKey) {
    adapter.applyValues?.({ ...values }, changedKey);
    persistLive();
    refreshKey(changedKey);
  }

  function setExternal(patch) {
    for (const [key, raw] of Object.entries(patch || {})) {
      const param = PARAMS.find((p) => p.key === key);
      if (!param) continue;
      const value = normalize(param, raw);
      if (value !== undefined) values[param.alias || param.key] = value;
    }
    persistLive();
    refreshKey('camera.distance');
  }

  function effectiveKey(param) {
    return param.alias || param.key;
  }

  function getValue(param) {
    if (param.kind === 'computed') return param.get(values);
    if (param.kind === 'readout') return param.get(values);
    return values[effectiveKey(param)];
  }

  function refreshKey(key) {
    if (!key) return;
    for (const row of rowsByKey.get(key) || []) row.sync();
    for (const row of computedRows) row.sync?.();
  }

  function refreshAll() {
    for (const row of rowsByKey.values()) for (const item of row) item.sync?.();
    for (const row of computedRows) row.sync?.();
    refreshServerUi();
  }

  function setValue(param, raw, options = {}) {
    const key = effectiveKey(param);
    if (param.kind === 'computed') {
      param.set(values, Number(raw));
      refreshKey('jump.duration');
      refreshKey('physics.gravity');
    } else {
      const value = normalize(param, raw);
      if (value === undefined) {
        refreshKey(key);
        return;
      }
      values[key] = value;
    }
    if (key === 'camera.minDistance' && values[key] > values['camera.maxDistance'] - 2) {
      values['camera.maxDistance'] = Math.min(100, values[key] + 2);
      refreshKey('camera.maxDistance');
    }
    if (key === 'camera.maxDistance' && values[key] < values['camera.minDistance'] + 2) {
      values['camera.minDistance'] = Math.max(8, values[key] - 2);
      refreshKey('camera.minDistance');
    }
    if (key === 'camera.distance') {
      values[key] = clampNumber(values[key], values['camera.minDistance'], Math.max(values['camera.maxDistance'], values['camera.minDistance'] + 1));
    }
    refreshKey(key);
    if (options.silent) {
      persistLive();
      return;
    }
    emit(key);
    if (param.key === 'anim.time') adapter.scrub?.(values['anim.time']);
  }

  if (stored.rejected) notify(`Se ignoraron ${stored.rejected} valores guardados fuera de rango.`);

  // ------------------------------------------------------------ tabs/pane

  for (const group of GROUPS) {
    const button = el('button', 'admin-tab', `${group.icon} ${group.label}`);
    button.type = 'button';
    button.title = group.title;
    button.dataset.tab = group.id;
    button.addEventListener('click', () => showTab(group.id));
    tabs.append(button);

    const pane = el('section', 'admin-pane');
    pane.dataset.pane = group.id;
    body.append(pane);
    panes.set(group.id, pane);
  }

  function showTab(id) {
    activeTab = id;
    for (const [key, pane] of panes) pane.classList.toggle('active', key === id);
    for (const button of tabs.querySelectorAll('.admin-tab')) {
      button.classList.toggle('active', button.dataset.tab === id);
    }
    body.scrollTop = 0;
    if (id === 'debug') updateTelemetry();
  }

  // -------------------------------------------------------------- rows

  function addRow(pane, section, param) {
    if (param.kind === 'readout') return buildReadout(pane, param);
    if (param.kind === 'toggle') return buildToggle(pane, param);
    if (param.kind === 'select') return buildSelect(pane, param);
    if (param.kind === 'color') return buildColor(pane, param);
    if (param.kind === 'text') return buildText(pane, param);
    return buildNumber(pane, param);
  }

  function registerRow(param, row) {
    const key = effectiveKey(param);
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key).push(row);
    if (param.kind === 'computed' || param.kind === 'readout') computedRows.add(row);
  }

  function baseRow(param) {
    const row = el('div', 'admin-row');
    row.dataset.key = param.alias || param.key;
    const label = el('label', 'admin-row-label');
    label.textContent = param.label;
    if (param.hint) {
      const hint = el('span', 'admin-hint', '?');
      hint.title = param.hint;
      label.append(hint);
    }
    if (param.sync) {
      const badge = el('span', 'admin-sync', '⇅');
      badge.title = 'Se sincroniza con el servidor en partida';
      label.append(badge);
    }
    row.append(label);
    return row;
  }

  function buildNumber(pane, param) {
    const row = baseRow(param);
    const valueWrap = el('div', 'admin-value');
    const number = el('input', 'admin-number');
    number.type = 'number';
    number.min = String(param.min);
    number.max = String(param.max);
    number.step = String(param.step);
    const unit = el('span', 'admin-unit', param.unit || '');
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer este parámetro';
    valueWrap.append(number, unit, reset);
    const range = el('input', 'admin-range');
    range.type = 'range';
    range.min = String(param.min);
    range.max = String(param.max);
    range.step = String(param.step);
    row.append(valueWrap, range);
    pane.append(row);

    let syncing = false;
    const commit = (raw) => {
      if (syncing) return;
      const value = normalize(param, raw);
      if (value === undefined) return;
      syncing = true;
      setValue(param, value);
      syncing = false;
    };
    range.addEventListener('input', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    number.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') number.blur();
    });
    reset.addEventListener('click', () => {
      setValue(param, defaults[effectiveKey(param)]);
      notify(`«${param.label}» restablecido`);
    });

    const item = {
      sync() {
        const value = getValue(param);
        syncing = true;
        if (Number.isFinite(value)) {
          range.value = String(value);
          if (document.activeElement !== number) number.value = formatNumber(value, param);
        }
        syncing = false;
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildToggle(pane, param) {
    const row = baseRow(param);
    row.classList.add('admin-row-toggle');
    const wrap = el('label', 'admin-switch');
    const input = el('input');
    input.type = 'checkbox';
    const track = el('span', 'admin-switch-track');
    wrap.append(input, track);
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer';
    row.append(wrap, reset);
    pane.append(row);

    input.addEventListener('change', () => {
      setValue(param, input.checked);
      if (param.key === 'anim.paused') notify(input.checked ? 'Animación pausada' : 'Animación reanudada');
    });
    reset.addEventListener('click', () => setValue(param, defaults[effectiveKey(param)]));

    const item = {
      sync() {
        input.checked = !!getValue(param);
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildSelect(pane, param) {
    const row = baseRow(param);
    const select = el('select', 'admin-select');
    for (const option of param.options || []) {
      const node = el('option', null, option.name);
      node.value = option.id;
      select.append(node);
    }
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer';
    const valueWrap = el('div', 'admin-value wide');
    valueWrap.append(select, reset);
    row.append(valueWrap);
    pane.append(row);

    select.addEventListener('change', () => {
      setValue(param, select.value);
      if (param.key === 'anim.clip') {
        values['anim.paused'] = false;
        refreshKey('anim.paused');
        emit('anim.clip');
        if (select.value !== 'auto') adapter.playClip?.(select.value);
      }
    });
    reset.addEventListener('click', () => setValue(param, defaults[effectiveKey(param)]));

    const item = {
      sync() {
        const value = getValue(param);
        if ((param.options || []).some((o) => o.id === value)) select.value = value;
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildColor(pane, param) {
    const row = baseRow(param);
    const valueWrap = el('div', 'admin-value');
    const colorInput = el('input', 'admin-color');
    colorInput.type = 'color';
    const hex = el('input', 'admin-hex');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer';
    valueWrap.append(colorInput, hex, reset);
    row.append(valueWrap);
    pane.append(row);

    let syncing = false;
    colorInput.addEventListener('input', () => {
      if (syncing) return;
      setValue(param, colorInput.value);
    });
    hex.addEventListener('change', () => {
      const value = normalize(param, hex.value);
      if (value === undefined) {
        notify('Color no válido: usa #rrggbb', 'error');
        refreshKey(effectiveKey(param));
        return;
      }
      setValue(param, value);
    });
    reset.addEventListener('click', () => setValue(param, defaults[effectiveKey(param)]));

    const item = {
      sync() {
        const value = getValue(param);
        syncing = true;
        if (typeof value === 'string' && COLOR_RE.test(value)) {
          colorInput.value = value;
          if (document.activeElement !== hex) hex.value = value;
        }
        syncing = false;
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildText(pane, param) {
    const row = baseRow(param);
    const input = el('input', 'admin-text');
    input.type = 'text';
    input.maxLength = 24;
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer';
    const valueWrap = el('div', 'admin-value');
    valueWrap.append(input, reset);
    row.append(valueWrap);
    pane.append(row);

    input.addEventListener('change', () => setValue(param, input.value));
    reset.addEventListener('click', () => setValue(param, defaults[effectiveKey(param)]));

    const item = {
      sync() {
        if (document.activeElement !== input) input.value = String(getValue(param) ?? '');
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildReadout(pane, param) {
    const row = baseRow(param);
    const value = el('strong', 'admin-readout', '—');
    row.append(value);
    pane.append(row);
    const item = {
      sync() {
        const raw = param.get(values);
        value.textContent = param.format ? param.format(raw) : String(raw);
      },
    };
    registerRow(param, item);
    item.sync();
    return item;
  }

  function buildComputed(pane, param) {
    const row = baseRow(param);
    const valueWrap = el('div', 'admin-value');
    const number = el('input', 'admin-number');
    number.type = 'number';
    number.min = String(param.min);
    number.max = String(param.max);
    number.step = String(param.step);
    const unit = el('span', 'admin-unit', param.unit || '');
    const reset = el('button', 'admin-reset', '↺');
    reset.type = 'button';
    reset.title = 'Restablecer gravedad';
    valueWrap.append(number, unit, reset);
    const range = el('input', 'admin-range');
    range.type = 'range';
    range.min = String(param.min);
    range.max = String(param.max);
    range.step = String(param.step);
    row.append(valueWrap, range);
    pane.append(row);

    let syncing = false;
    const commit = (raw) => {
      if (syncing) return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      syncing = true;
      param.set(values, n);
      refreshKey('jump.duration');
      refreshKey('physics.gravity');
      emit('physics.gravity');
      syncing = false;
    };
    range.addEventListener('input', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    reset.addEventListener('click', () => {
      values['jump.height'] = defaults['jump.height'];
      values['jump.duration'] = defaults['jump.duration'];
      refreshKey('jump.height');
      refreshKey('jump.duration');
      refreshKey('physics.gravity');
      emit('physics.gravity');
    });

    const item = {
      sync() {
        const value = gravityOf(values);
        syncing = true;
        range.value = String(value);
        if (document.activeElement !== number) number.value = value.toFixed(1);
        syncing = false;
      },
    };
    rowsByKey.set(param.key, [item]);
    computedRows.add(item);
    item.sync();
    return item;
  }

  // ------------------------------------------------------------ sections

  function buildSection(pane, group, section) {
    const details = el('details', 'admin-section');
    details.open = true;
    const summary = el('summary');
    summary.append(el('span', null, section.title));
    const chevron = el('span', 'admin-chevron', '⌄');
    summary.append(chevron);
    details.append(summary);
    const content = el('div', 'admin-section-body');
    if (section.note) content.append(el('p', 'admin-note', section.note));
    for (const param of section.params) {
      if (param.kind === 'computed') buildComputed(content, param);
      else addRow(content, section, param);
    }
    if (section.actions) buildActions(content, section.actions);
    details.append(content);
    pane.append(details);
  }

  function actionButton(label, onClick, tone = '') {
    const button = el('button', `admin-btn ${tone}`, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function buildActions(content, actions) {
    const wrap = el('div', 'admin-actions');
    for (const action of actions) {
      if (action === 'play') {
        wrap.append(actionButton('▶ Reproducir', () => {
          values['anim.paused'] = false;
          refreshKey('anim.paused');
          emit('anim.paused');
          if (values['anim.clip'] === 'auto') adapter.resumeAnimation?.();
        }));
      } else if (action === 'pause') {
        wrap.append(actionButton('❚❚ Pausar', () => {
          values['anim.paused'] = !values['anim.paused'];
          refreshKey('anim.paused');
          emit('anim.paused');
        }));
      } else if (action === 'restart') {
        wrap.append(actionButton('↺ Reiniciar', () => {
          values['anim.paused'] = false;
          refreshKey('anim.paused');
          emit('anim.paused');
          adapter.restartAnimation?.();
          notify('Clip reiniciado');
        }));
      } else if (action === 'stepBack') {
        wrap.append(actionButton('− Fotograma', () => adapter.stepAnimation?.(-1 / 30)));
      } else if (action === 'stepForward') {
        wrap.append(actionButton('+ Fotograma', () => adapter.stepAnimation?.(1 / 30)));
      } else if (action === 'resetCamera') {
        wrap.append(actionButton('Centrar cámara', () => {
          for (const key of Object.keys(defaults)) {
            if (key.startsWith('camera.')) values[key] = defaults[key];
          }
          refreshAll();
          emit('camera.reset');
          adapter.resetCamera?.();
          notify('Cámara restablecida', 'ok');
        }, 'gold'));
      } else if (action === 'variants') {
        for (const variant of APPEARANCE_VARIANTS) {
          wrap.append(actionButton(variant.name, () => {
            applyPatch(variant.colors);
            notify(`Variante «${variant.name}» aplicada`, 'ok');
          }));
        }
      } else if (action === 'teleport') {
        wrap.append(actionButton('Teletransportar', async () => {
          const x = Number(values['debug.teleportX']);
          const z = Number(values['debug.teleportZ']);
          if (!Number.isFinite(x) || !Number.isFinite(z)) {
            notify('Coordenadas no válidas', 'error');
            return;
          }
          const result = await adapter.teleport?.(x, z);
          if (result === false) notify('El servidor rechazó el destino o estás fuera de combate', 'error');
          else if (result === null) notify('Teletransporte no disponible (sin partida o servidor de solo cliente)', 'error');
          else notify(`Teletransportado a ${x}, ${z}`, 'ok');
        }, 'gold'));
      } else if (action === 'resetPosition') {
        wrap.append(actionButton('Restablecer posición', async () => {
          const result = await adapter.resetPosition?.();
          if (result === false) notify('No se pudo restablecer la posición (fuera de combate o servidor de solo cliente)', 'error');
          else if (result === null) notify('Restablecer posición no disponible fuera de partida', 'error');
          else notify('Posición restablecida', 'ok');
        }));
      } else if (action === 'syncServer') {
        wrap.append(actionButton('Sincronizar con el servidor', () => {
          const ok = adapter.syncServer?.();
          notify(ok ? 'Ajustes enviados al servidor' : 'El servidor no acepta ajustes', ok ? 'ok' : 'error');
        }));
      }
    }
    content.append(wrap);
  }

  // -------------------------------------------------------------- presets

  function applyPatch(patch, options = {}) {
    const sanitized = sanitizeValues({ ...values, ...patch }, defaults).values;
    Object.assign(values, sanitized);
    refreshAll();
    emit('preset');
    if (!options.silent) persistLive();
  }

  function applyPreset(preset) {
    const base = makeDefaults(adapter.getInitialLook?.());
    const next = sanitizeValues({ ...base, ...preset.patch }, base);
    Object.assign(values, next.values);
    refreshAll();
    emit('preset');
    notify(`Perfil «${preset.name}» aplicado`, 'ok');
  }

  function buildPresetsPane(pane) {
    const intro = el('p', 'admin-note', 'Los perfiles guardan los valores reales de todos los parámetros. Al aplicar uno se escribe en los sistemas del juego, no solo en el formulario.');
    pane.append(intro);

    const builtin = el('div', 'admin-preset-grid');
    for (const preset of PRESETS) {
      const card = el('button', 'admin-preset');
      card.type = 'button';
      card.append(el('span', 'admin-preset-icon', preset.icon));
      const copy = el('span', 'admin-preset-copy');
      copy.append(el('strong', null, preset.name), el('small', null, preset.desc));
      card.append(copy);
      card.addEventListener('click', () => applyPreset(preset));
      builtin.append(card);
    }
    pane.append(el('h3', 'admin-h3', 'Perfiles iniciales'), builtin);

    const custom = el('div', 'admin-custom');
    const nameInput = el('input', 'admin-text');
    nameInput.type = 'text';
    nameInput.placeholder = 'Nombre del perfil';
    nameInput.maxLength = 28;
    const saveProfile = actionButton('Guardar perfil actual', () => {
      const name = nameInput.value.trim().slice(0, 28);
      if (!name) {
        notify('Escribe un nombre para el perfil', 'error');
        return;
      }
      const profiles = loadJSON(STORAGE.profiles, []);
      const next = profiles.filter((p) => p.name !== name);
      next.unshift({ name, savedAt: Date.now(), values: { ...values } });
      storeJSON(STORAGE.profiles, next.slice(0, 12));
      nameInput.value = '';
      renderProfiles();
      notify(`Perfil «${name}» guardado`, 'ok');
    }, 'gold');
    const row = el('div', 'admin-inline');
    row.append(nameInput, saveProfile);
    custom.append(row);
    const list = el('div', 'admin-profile-list');
    custom.append(list);
    pane.append(el('h3', 'admin-h3', 'Perfiles personalizados'), custom);

    function renderProfiles() {
      list.textContent = '';
      const profiles = loadJSON(STORAGE.profiles, []);
      if (!profiles.length) {
        list.append(el('p', 'admin-empty', 'Aún no hay perfiles guardados. Ajusta el mago y guarda uno.'));
        return;
      }
      for (const profile of profiles) {
        const item = el('div', 'admin-profile');
        const copy = el('div', 'admin-profile-copy');
        copy.append(el('strong', null, profile.name));
        copy.append(el('small', null, new Date(profile.savedAt).toLocaleString('es-ES')));
        const load = actionButton('Cargar', () => {
          const clean = sanitizeValues(profile.values, defaults);
          Object.assign(values, clean.values);
          refreshAll();
          emit('profile');
          notify(`Perfil «${profile.name}» cargado${clean.rejected ? ` (${clean.rejected} valores ignorados)` : ''}`, 'ok');
        });
        const remove = actionButton('Borrar', () => {
          const rest = loadJSON(STORAGE.profiles, []).filter((p) => p.name !== profile.name);
          storeJSON(STORAGE.profiles, rest);
          renderProfiles();
          notify(`Perfil «${profile.name}» eliminado`);
        }, 'danger');
        item.append(copy, load, remove);
        list.append(item);
      }
    }
    renderProfiles();

    const io = el('div', 'admin-actions');
    io.append(
      actionButton('Exportar JSON', exportConfig, 'gold'),
      actionButton('Importar JSON', () => fileInput.click()),
      actionButton('Restablecer todos los valores', resetAll, 'danger')
    );
    pane.append(el('h3', 'admin-h3', 'Configuración'), io);

    const keyRow = el('div', 'admin-key-row');
    keyRow.append(el('span', null, 'Tecla del panel'), keyButton.cloneNode(true));
    const cloned = keyRow.querySelector('button');
    cloned.addEventListener('click', startRebinding);
    pane.append(keyRow);
  }

  // ---------------------------------------------------------------- build

  for (const group of GROUPS) {
    const pane = panes.get(group.id);
    if (group.id === 'presets') {
      buildPresetsPane(pane);
      continue;
    }
    for (const section of group.sections) {
      buildSection(pane, group, section);
      if (group.id === 'debug' && section.readouts) {
        const box = el('div', 'admin-telemetry');
        box.id = 'admin-telemetry';
        const grid = el('div', 'admin-telemetry-grid');
        const fields = [
          ['fps', 'FPS'],
          ['pos', 'Posición'],
          ['speed', 'Velocidad'],
          ['rot', 'Rotación'],
          ['clip', 'Animación'],
          ['state', 'Estado'],
          ['draws', 'Llamadas de dibujo'],
          ['tris', 'Triángulos'],
        ];
        for (const [key, label] of fields) {
          const item = el('div');
          item.append(el('span', null, label), el('strong', null, '—'));
          item.dataset.field = key;
          grid.append(item);
        }
        box.append(el('h4', null, 'Telemetría en vivo'), grid);
        const serverRow = el('p', 'admin-note');
        serverRow.id = 'admin-server-note';
        box.append(serverRow);
        pane.append(box);
      }
    }
  }

  showTab(activeTab);
  refreshAll();

  // ------------------------------------------------------------- telemetry

  function updateTelemetry() {
    const info = adapter.debugInfo?.() || {};
    const overlayLines = [];
    if (values['debug.fps']) {
      overlayLines.push(`FPS ${Math.round(info.fps || 0)} · ${info.frameMs ? info.frameMs.toFixed(1) : '—'} ms`);
    }
    if (values['debug.speed']) overlayLines.push(`Velocidad ${Number(info.speed || 0).toFixed(1)} u/s`);
    if (values['debug.coords']) {
      overlayLines.push(`X ${Number(info.x || 0).toFixed(1)} · Z ${Number(info.z || 0).toFixed(1)} · Y ${Number(info.y || 0).toFixed(1)}`);
      overlayLines.push(`Giro ${((info.yaw || 0) * 180 / Math.PI).toFixed(0)}°`);
    }
    if (values['debug.animState']) {
      overlayLines.push(`Clip ${info.clip || '—'} · ${((info.clipTime || 0) * 100).toFixed(0)}%${info.animPaused ? ' · pausa' : ''}`);
    }
    if (overlayLines.length) {
      debugHud.textContent = '';
      for (const line of overlayLines) debugHud.append(el('div', null, line));
      debugHud.classList.remove('hidden');
    } else {
      debugHud.classList.add('hidden');
    }

    if (!open || activeTab !== 'debug') return;
    const grid = panel.querySelector('.admin-telemetry-grid');
    if (!grid) return;
    const setField = (field, text) => {
      const item = grid.querySelector(`[data-field="${field}"] strong`);
      if (item) item.textContent = text;
    };
    setField('fps', `${Math.round(info.fps || 0)} · ${info.frameMs ? info.frameMs.toFixed(1) : '—'} ms`);
    setField('pos', `${Number(info.x || 0).toFixed(1)}, ${Number(info.z || 0).toFixed(1)}, ${Number(info.y || 0).toFixed(1)}`);
    setField('speed', `${Number(info.speed || 0).toFixed(1)} u/s`);
    setField('rot', `${((info.yaw || 0) * 180 / Math.PI).toFixed(0)}°`);
    setField('clip', `${info.clip || '—'}${info.animPaused ? ' (pausa)' : ''}`);
    setField('state', info.alive ? (info.frozen ? 'Congelado' : 'En pie') : 'Caído');
    setField('draws', String(info.draws ?? '—'));
    setField('tris', Number(info.triangles ?? 0).toLocaleString('es-ES'));
    const note = panel.querySelector('#admin-server-note');
    if (note) {
      note.textContent = serverEnabled
        ? 'Servidor: los ajustes de movimiento y magia se aplican de forma autoritativa.'
        : 'Servidor: solo cliente. En este entorno el servidor no acepta ajustes; la velocidad puede corregirse en la siguiente instantánea.';
    }
  }

  telemetryTimer = setInterval(updateTelemetry, 240);

  // --------------------------------------------------------------- server

  function refreshServerUi() {
    serverBadge.textContent = serverEnabled ? 'Servidor activo' : 'Solo cliente';
    serverBadge.classList.toggle('off', !serverEnabled);
    serverBadge.title = serverEnabled
      ? 'El servidor de desarrollo acepta ajustes de movimiento y magia para tu mago.'
      : 'El servidor no acepta ajustes (modo producción). Los controles de cliente siguen funcionando.';
  }

  function setServer(enabled) {
    serverEnabled = !!enabled;
    refreshServerUi();
    updateTelemetry();
  }

  // ------------------------------------------------------------- save/load

  function saveSlot() {
    storeJSON(STORAGE.slot, { format: 'elemental-royale/admin', version: 1, savedAt: Date.now(), values });
    notify('Configuración guardada en este navegador', 'ok');
  }

  function loadSlot() {
    const raw = loadJSON(STORAGE.slot, null);
    if (!raw) {
      notify('No hay ninguna configuración guardada', 'error');
      return;
    }
    const clean = sanitizeValues(raw, defaults);
    Object.assign(values, clean.values);
    refreshAll();
    emit('load');
    notify(`Configuración cargada${clean.rejected ? ` · ${clean.rejected} valores ignorados` : ''}`, 'ok');
  }

  function exportConfig() {
    const payload = {
      format: 'elemental-royale/admin',
      version: 1,
      savedAt: new Date().toISOString(),
      values,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `elemental-royale-admin-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify('Configuración exportada como JSON', 'ok');
  }

  async function importFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const clean = sanitizeValues(parsed, defaults);
      Object.assign(values, clean.values);
      refreshAll();
      emit('import');      notify(
        `Configuración importada${
          clean.rejected
            ? ` · ${clean.rejected} ${clean.rejected === 1 ? 'valor fuera de rango ignorado' : 'valores fuera de rango ignorados'}`
            : ''
        }`,
        'ok'
      );
    } catch {
      notify('El archivo no es un JSON de configuración válido', 'error');
    }
  }

  function resetAll() {
    const fresh = makeDefaults(adapter.getInitialLook?.());
    Object.assign(defaults, fresh);
    Object.assign(values, fresh);
    refreshAll();
    emit('reset');
    notify('Todos los parámetros han vuelto a sus valores originales', 'ok');
  }

  // ------------------------------------------------------------- keybind

  function startRebinding() {
    rebinding = true;
    for (const button of panel.querySelectorAll('.admin-key')) {
      button.textContent = '…';
      button.classList.add('listening');
    }
    notify('Pulsa la nueva tecla del panel (Esc cancela)');
  }

  function finishRebinding(token) {
    rebinding = false;
    for (const button of panel.querySelectorAll('.admin-key')) button.classList.remove('listening');
    if (token) {
      boundCode = token;
      try {
        localStorage.setItem(STORAGE.key, token);
      } catch {
        /* ignorar */
      }
      notify(`El panel se abre con ${keyLabel(token)}`, 'ok');
    }
    syncKeyButton();
  }

  function syncKeyButton() {
    keyButton.textContent = keyLabel(boundCode);
    keyButton.title = `Abrir/cerrar el panel (${keyLabel(boundCode)}). Clic para cambiar.`;
    for (const button of panel.querySelectorAll('.admin-key')) button.textContent = keyLabel(boundCode);
  }

  keyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    startRebinding();
  });

  // --------------------------------------------------------------- toggle

  function setOpen(next) {
    open = next;
    panel.classList.toggle('hidden', !open);
    if (open) {
      refreshAll();
      updateTelemetry();
      panel.style.zIndex = '90';
    }
    adapter.onOpenChange?.(open);
  }

  function toggle() {
    setOpen(!open);
  }

  closeButton.addEventListener('click', () => setOpen(false));
  minimizeButton.addEventListener('click', () => {
    panel.classList.toggle('min');
    minimizeButton.textContent = panel.classList.contains('min') ? '▢' : '–';
    minimizeButton.title = panel.classList.contains('min') ? 'Restaurar' : 'Minimizar';
  });

  // arrastrar por la cabecera
  head.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, select')) return;
    const rect = panel.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, id: event.pointerId };
    head.setPointerCapture?.(event.pointerId);
    panel.classList.add('dragging');
  });
  head.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = clampNumber(event.clientX - drag.dx, 6, Math.max(6, window.innerWidth - width - 6));
    const top = clampNumber(event.clientY - drag.dy, 6, Math.max(6, window.innerHeight - Math.min(height, 80)));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
  });
  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    panel.classList.remove('dragging');
    head.releasePointerCapture?.(event.pointerId);
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // atajos de teclado; se captura antes que el juego
  window.addEventListener(
    'keydown',
    (event) => {
      if (rebinding) {
        event.preventDefault();
        event.stopPropagation();
        const token = keyToken(event);
        if (token === 'Escape') {
          finishRebinding(null);
          notify('Cambio de tecla cancelado');
        } else if (!token) {
          notify('Esa tecla no se puede usar; prueba con otra', 'error');
        } else {
          finishRebinding(token);
        }
        return;
      }
      const token = keyToken(event);
      // ñ (y cualquier otra tecla imprimible) debe poder escribirse en los
      // campos de texto sin abrir o cerrar el panel; Esc sigue cerrando.
      const typing = isTextField(event.target) && isPrintableToken(boundCode);
      if (!typing && token && token === boundCode) {
        event.preventDefault();
        event.stopPropagation();
        toggle();
        return;
      }
      if (open && token === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    },
    true
  );

  // Botones del pie
  saveButton.addEventListener('click', saveSlot);
  loadButton.addEventListener('click', loadSlot);
  exportButton.addEventListener('click', exportConfig);
  importButton.addEventListener('click', () => fileInput.click());
  resetButton.addEventListener('click', resetAll);

  // Posición inicial y límites al redimensionar.
  function place() {
    if (panel.style.left) return;
    const width = Math.min(440, window.innerWidth - 24);
    panel.style.width = `${Math.max(340, width)}px`;
    panel.style.left = `${Math.max(12, window.innerWidth - width - 18)}px`;
    panel.style.top = '74px';
    panel.style.right = 'auto';
  }
  place();
  window.addEventListener('resize', () => {
    if (!panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.min(rect.left, Math.max(6, window.innerWidth - panel.offsetWidth - 6));
    const top = Math.min(rect.top, Math.max(6, window.innerHeight - 80));
    panel.style.left = `${Math.max(6, left)}px`;
    panel.style.top = `${Math.max(6, top)}px`;
  });

  syncKeyButton();
  refreshServerUi();

  // Primer empujón a los sistemas reales, para que la configuración guardada
  // se aplique aunque el panel no se haya abierto todavía.
  adapter.applyValues?.({ ...values }, 'init');

  return {
    values,
    defaults,
    isOpen: () => open,
    isFrozen: () => !!values['debug.freeze'],
    toggle,
    open: (tab) => {
      if (tab) showTab(tab);
      setOpen(true);
    },
    close: () => setOpen(false),
    setServer,
    setExternal,
    refresh: refreshAll,
    notify,
    getKey: () => boundCode,
    destroy() {
      clearInterval(telemetryTimer);
      panel.remove();
      debugHud.remove();
    },
  };
}
