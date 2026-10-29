// Esquema central del panel de administrador.
// Todo parámetro que aparece en la interfaz está declarado aquí, con sus
// límites y su valor por defecto, y se aplica a los sistemas reales del juego.

import { defaultLook } from '../../shared/constants.js';

const num = (key, label, def, min, max, step, extra = {}) => ({
  key,
  label,
  kind: 'number',
  def,
  min,
  max,
  step,
  ...extra,
});

const toggle = (key, label, def, extra = {}) => ({ key, label, kind: 'toggle', def, ...extra });

const select = (key, label, def, options, extra = {}) => ({
  key,
  label,
  kind: 'select',
  def,
  options,
  ...extra,
});

const color = (key, label, def, extra = {}) => ({ key, label, kind: 'color', def, ...extra });

export const ANIMATION_CLIPS = [
  { id: 'auto', name: 'Automática (según el estado)' },
  { id: 'idle', name: 'Idle · respiración' },
  { id: 'walk', name: 'Walk · caminar' },
  { id: 'run', name: 'Run · correr' },
  { id: 'start', name: 'Start · arranque' },
  { id: 'stop', name: 'Stop · frenada' },
  { id: 'cast', name: 'Cast · lanzamiento' },
  { id: 'hit', name: 'Hit · impacto' },
  { id: 'death', name: 'Death · muerte' },
];

export const GROUPS = [
  {
    id: 'character',
    label: 'Personaje',
    icon: '✦',
    title: 'Cuerpo y locomoción',
    sections: [
      {
        id: 'move',
        title: 'Movimiento',
        note: 'Estos valores se envían al servidor en partida: la velocidad, la aceleración y el radio de colisión se aplican en cliente y servidor para que no haya tirones.',
        params: [
          num('move.walkSpeed', 'Velocidad al caminar', 94, 30, 200, 1, { unit: 'u/s', sync: true }),
          num('move.runMultiplier', 'Multiplicador al correr', 1.32, 1, 2.5, 0.01, { unit: '×', sync: true }),
          num('move.accel', 'Aceleración', 30, 1, 40, 0.5, { unit: '/s', sync: true }),
          num('move.decel', 'Desaceleración · fricción', 30, 1, 40, 0.5, { unit: '/s', sync: true }),
          num('move.turnSpeed', 'Velocidad de giro', 14, 1, 40, 0.5, { unit: '/s' }),
          num('move.strafe', 'Movimiento lateral', 1, 0.3, 1.5, 0.01, { unit: '×', sync: true }),
          num('move.back', 'Movimiento hacia atrás', 1, 0.3, 1.5, 0.01, { unit: '×', sync: true }),
          num('move.airControl', 'Control en el aire', 0.35, 0, 1, 0.01, { unit: '×', sync: true }),
          num('jump.height', 'Altura del salto', 3.4, 0, 10, 0.1, { unit: 'u', sync: true }),
          num('jump.duration', 'Duración del salto', 0.55, 0.2, 2, 0.01, {
            unit: 's',
            sync: true,
            hint: 'Altura y duración definen la gravedad del salto.',
          }),
          num('jump.fallForce', 'Fuerza de caída', 1.25, 0.5, 3, 0.05, { unit: '×', sync: true }),
          num('jump.maxHeight', 'Altura máxima del salto', 8, 1, 20, 0.1, { unit: 'u', sync: true }),
        ],
      },
      {
        id: 'size',
        title: 'Tamaño y proporciones',
        note: 'El escalado se aplica desde los pies y ajusta a la vez la altura de la cámara, las placas de nombre y el radio de colisión. Las longitudes de brazos y piernas se estiran sobre el eje del hueso, sin cambiar la pose base.',
        params: [
          num('size.scale', 'Escala general', 1, 0.5, 2, 0.01, { unit: '×' }),
          num('size.x', 'Escala X', 1, 0.5, 2, 0.01, { unit: '×' }),
          num('size.y', 'Escala Y', 1, 0.5, 2, 0.01, { unit: '×' }),
          num('size.z', 'Escala Z', 1, 0.5, 2, 0.01, { unit: '×' }),
          num('size.head', 'Tamaño de la cabeza', 1, 0.7, 1.4, 0.01, { unit: '×' }),
          num('size.torso', 'Tamaño del torso', 1, 0.8, 1.2, 0.01, { unit: '×' }),
          num('size.arms', 'Longitud de los brazos', 1, 0.8, 1.2, 0.01, { unit: '×' }),
          num('size.legs', 'Longitud de las piernas', 1, 0.8, 1.2, 0.01, { unit: '×' }),
          num('size.staff', 'Escala del bastón', 1, 0.5, 1.6, 0.01, { unit: '×' }),
          num('size.hat', 'Escala del gorro', 1, 0.5, 1.6, 0.01, { unit: '×' }),
        ],
      },
    ],
  },
  {
    id: 'anim',
    label: 'Animaciones',
    icon: '✧',
    title: 'Ritmo y lenguaje corporal',
    sections: [
      {
        id: 'anim-speed',
        title: 'Velocidad y transiciones',
        params: [
          num('anim.master', 'Multiplicador de velocidad', 1, 0, 3, 0.01, { unit: '×' }),
          num('anim.idle', 'Velocidad de idle', 1, 0.2, 2, 0.01, { unit: '×' }),
          num('anim.walk', 'Velocidad de caminar', 1, 0.2, 2, 0.01, { unit: '×' }),
          num('anim.run', 'Velocidad de correr', 1, 0.2, 2, 0.01, { unit: '×' }),
          num('anim.cast', 'Velocidad de lanzamiento', 1, 0.2, 2, 0.01, { unit: '×' }),
          num('anim.transition', 'Suavidad de las transiciones', 0.18, 0, 0.6, 0.01, { unit: 's' }),
        ],
      },
      {
        id: 'anim-secondary',
        title: 'Movimiento secundario',
        note: 'El modelo no tiene huesos de tela independientes: la túnica y las mangas cuelgan de caderas, columna y brazos, así que su intensidad se aplica sobre esos huesos.',
        params: [
          num('anim.arm', 'Balanceo de brazos', 1, 0, 2, 0.01, { unit: '×' }),
          num('anim.torso', 'Movimiento del torso', 1, 0, 2, 0.01, { unit: '×' }),
          num('anim.head', 'Movimiento de la cabeza', 1, 0, 2, 0.01, { unit: '×' }),
          num('anim.cloth', 'Túnica y mangas', 1, 0, 2, 0.01, { unit: '×' }),
          num('anim.accessory', 'Accesorios (bastón y gorro)', 1, 0, 2, 0.01, { unit: '×' }),
          toggle('anim.secondary', 'Activar movimiento secundario', true),
        ],
      },
      {
        id: 'anim-player',
        title: 'Reproductor de clips',
        note: 'Selecciona un clip para forzarlo en tu mago; «Automática» devuelve el control al estado del juego.',
        params: [
          select('anim.clip', 'Clip en reproducción', 'auto', ANIMATION_CLIPS),
          toggle('anim.paused', 'Pausar la animación', false),
          num('anim.time', 'Tiempo de reproducción', 0, 0, 1, 0.005, { unit: '×' }),
        ],
        actions: ['play', 'pause', 'restart', 'stepBack', 'stepForward'],
      },
    ],
  },
  {
    id: 'magic',
    label: 'Magia',
    icon: '✺',
    title: 'Hechizos y maná',
    sections: [
      {
        id: 'magic-spells',
        title: 'Parámetros de hechizos',
        note: 'Daño, recarga, alcance, maná y velocidad de proyectil se calculan en el servidor. El panel los envía solo a tu mago cuando el servidor de desarrollo lo permite.',
        params: [
          num('magic.power', 'Potencia de los hechizos', 1, 0.1, 3, 0.01, { unit: '×', sync: true }),
          num('magic.castSpeed', 'Velocidad de lanzamiento', 1, 0.3, 3, 0.01, { unit: '×' }),
          num('magic.cooldown', 'Tiempo de reutilización', 1, 0.1, 3, 0.01, { unit: '×', sync: true }),
          num('magic.range', 'Alcance', 1, 0.3, 3, 0.01, { unit: '×', sync: true }),
          num('magic.duration', 'Duración de los efectos', 1, 0.2, 3, 0.01, { unit: '×', sync: true }),
          num('magic.projectileSize', 'Tamaño de proyectiles', 1, 0.3, 3, 0.01, { unit: '×', sync: true }),
          num('magic.projectileSpeed', 'Velocidad de los proyectiles', 1, 0.3, 3, 0.01, { unit: '×', sync: true }),
          num('magic.vfx', 'Intensidad de partículas', 1, 0, 2, 0.01, { unit: '×' }),
          num('magic.manaCost', 'Coste de maná', 1, 0.1, 3, 0.01, { unit: '×', sync: true }),
          num('magic.manaRegen', 'Regeneración de maná', 1, 0.1, 4, 0.01, { unit: '×', sync: true }),
        ],
      },
      {
        id: 'magic-future',
        title: 'Mecánicas no implementadas',
        note: 'El juego actual no tiene hechizos con carga ni tiempos de casteo mantenidos. No se muestra un control falso: cuando se añada esa mecánica, su parámetro debe declararse en este esquema.',
        params: [],
      },
    ],
  },
  {
    id: 'camera',
    label: 'Cámara',
    icon: '◉',
    title: 'Seguimiento y encuadre',
    sections: [
      {
        id: 'camera-main',
        title: 'Seguimiento',
        params: [
          num('camera.distance', 'Distancia de seguimiento', 30, 12, 100, 0.5, {
            unit: 'u',
            hint: 'La rueda del ratón modifica este valor; queda limitado por la distancia mínima y máxima.',
          }),
          num('camera.height', 'Altura adicional', 0, -5, 25, 0.5, { unit: 'u' }),
          num('camera.pitch', 'Inclinación vertical', 54.8, 20, 80, 0.5, { unit: '°' }),
          num('camera.fov', 'Campo de visión (FOV)', 52, 35, 90, 0.5, { unit: '°' }),
          num('camera.sensitivity', 'Sensibilidad de giro', 1, 0, 2, 0.01, {
            unit: '×',
            hint: 'Velocidad de la órbita con Q/E y con el arrastre del botón central; no afecta al apuntado.',
          }),
          num('camera.follow', 'Velocidad de seguimiento', 7, 1, 25, 0.5, { unit: '/s' }),
          num('camera.smooth', 'Suavidad del movimiento', 10, 1, 30, 0.5, { unit: '/s' }),
          num('camera.minDistance', 'Distancia mínima', 18, 8, 40, 0.5, { unit: 'u' }),
          num('camera.maxDistance', 'Distancia máxima', 60, 30, 100, 0.5, { unit: 'u' }),
          toggle('camera.collision', 'Evitar geometría y suelo', true),
        ],
        actions: ['resetCamera'],
      },
    ],
  },
  {
    id: 'physics',
    label: 'Físicas',
    icon: '⌁',
    title: 'Gravedad, masa y colisión',
    sections: [
      {
        id: 'physics-main',
        title: 'Cuerpo físico',
        note: 'El movimiento es 2D sobre el terreno y el servidor es autoritativo. El salto y la gravedad ahora también se simulan en el servidor para que todos los clientes vean el mismo arco.',
        params: [
          {
            key: 'physics.gravity',
            label: 'Gravedad',
            kind: 'computed',
            min: 5,
            max: 200,
            step: 0.5,
            unit: 'u/s²',
            sync: true,
            get: (v) => gravityOf(v),
            set: (v, value) => {
              const h = Math.max(0.2, v['jump.height']);
              v['jump.duration'] = clampNumber(2 * Math.sqrt((2 * h) / Math.max(1, value)), 0.2, 2);
            },
            hint: 'Derivada de la altura y la duración del salto; al cambiarla se ajusta la duración.',
          },
          {
            key: 'physics.jumpForce',
            label: 'Fuerza de salto',
            kind: 'readout',
            get: (v) => jumpForceOf(v),
            format: (v) => `${v.toFixed(1)} u/s`,
          },
          num('physics.mass', 'Masa · resistencia al retroceso', 1, 0.3, 3, 0.01, {
            unit: '×',
            sync: true,
            hint: 'No hay simulación de masa completa: se usa para dividir los empujones y el retroceso.',
          }),
          {
            ...num('physics.friction', 'Fricción', 30, 1, 40, 0.5, { unit: '/s', alias: 'move.decel' }),
            label: 'Fricción · desaceleración',
          },
          {
            key: 'physics.resistance',
            label: 'Resistencia al avance',
            kind: 'readout',
            get: () => 'No implementada',
          },
          num('physics.capsuleRadius', 'Radio de colisión', 2.1, 0.8, 4.5, 0.05, { unit: 'u', sync: true }),
          num('physics.capsuleHeight', 'Altura de la cápsula', 3.2, 1, 8, 0.1, {
            unit: 'u',
            hint: 'Se usa para la visualización de depuración; el juego no resuelve colisión vertical.',
          }),
          toggle('physics.enabled', 'Físicas activas', true),
          toggle('physics.groundSnap', 'Detección de suelo', true),
          toggle('debug.colliders', 'Visualizar colisiones', false),
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Apariencia',
    icon: '❈',
    title: 'Materiales y tinte',
    sections: [
      {
        id: 'appearance-colors',
        title: 'Colores',
        note: 'Cada mago clona sus materiales al cargarse, así que teñir tu túnica no afecta a otros jugadores ni a los objetos del mundo.',
        params: [
          color('look.robe', 'Túnica', null),
          color('look.hatColor', 'Gorro', null),
          color('look.staffColor', 'Bastón', null),
          color('look.detail', 'Cinturón, botas y detalles', '#ffffff'),
          color('look.skin', 'Piel', null),
          color('look.hair', 'Cabello', null),
          color('look.magic', 'Color de la magia', null),
        ],
      },
      {
        id: 'appearance-material',
        title: 'Materiales y efectos',
        note: 'El modelo usa cuatro materiales: Túnica, Piel, Pelo y Detalle. El cinturón y las botas comparten «Detalle», por eso se tiñen juntos.',
        params: [
          select('look.material', 'Material disponible', 'original', [
            { id: 'original', name: 'Original del GLB' },
            { id: 'mate', name: 'Mate · tela' },
            { id: 'satinado', name: 'Satinado · seda' },
            { id: 'metalico', name: 'Metálico · armadura' },
          ]),
          num('look.emissive', 'Intensidad de emisión', 0, 0, 1.5, 0.01, { unit: '×' }),
          num('look.magicGlow', 'Brillo de efectos mágicos', 1, 0, 2, 0.01, { unit: '×' }),
          toggle('look.hatVisible', 'Mostrar gorro', true),
          toggle('look.staffVisible', 'Mostrar bastón', true),
          toggle('look.shadow', 'Mostrar sombra', true),
        ],
      },
      {
        id: 'appearance-variants',
        title: 'Variantes de apariencia',
        note: 'Aplican una paleta completa al mago activo; no tocan el aspecto guardado en el taller.',
        params: [],
        actions: ['variants'],
      },
    ],
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: '⌘',
    title: 'Instrumentación',
    sections: [
      {
        id: 'debug-view',
        title: 'Visualización',
        params: [
          toggle('debug.skeleton', 'Mostrar esqueleto', false),
          toggle('debug.bones', 'Mostrar ejes de los huesos', false),
          toggle('debug.axes', 'Ejes y orientación del personaje', false),
          toggle('debug.colliders', 'Mostrar colisionadores', false),
          toggle('debug.speed', 'Mostrar velocidad', false),
          toggle('debug.coords', 'Mostrar coordenadas y rotación', false),
          toggle('debug.animState', 'Mostrar estado de animación', false),
          toggle('debug.fps', 'Mostrar FPS y rendimiento', false),
        ],
      },
      {
        id: 'debug-control',
        title: 'Control en caliente',
        params: [
          toggle('debug.freeze', 'Congelar movimiento', false),
          toggle('physics.enabled', 'Físicas activas', true),
          toggle('physics.groundSnap', 'Detección de suelo', true),
          { key: 'debug.teleportX', label: 'Destino X', kind: 'text', def: '0', hint: 'Coordenada dentro del mundo.' },
          { key: 'debug.teleportZ', label: 'Destino Z', kind: 'text', def: '0' },
        ],
        actions: ['teleport', 'resetPosition', 'syncServer'],
      },
      {
        id: 'debug-readout',
        title: 'Telemetría',
        params: [],
        readouts: true,
      },
    ],
  },
  {
    id: 'presets',
    label: 'Presets',
    icon: '❖',
    title: 'Perfiles y configuraciones',
    sections: [
      {
        id: 'presets-main',
        title: 'Perfiles',
        params: [],
        presets: true,
      },
    ],
  },
];

export const PARAMS = [];
for (const group of GROUPS) {
  for (const section of group.sections) {
    for (const param of section.params) {
      PARAMS.push({ ...param, group: group.id, section: section.id });
    }
  }
}

export const STORED_PARAMS = PARAMS.filter((p) => p.kind !== 'computed' && p.kind !== 'readout' && !p.alias);

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function gravityOf(values) {
  const h = Math.max(0.01, Number(values['jump.height']) || 0.01);
  const t = Math.max(0.1, Number(values['jump.duration']) || 0.1);
  return (8 * h) / (t * t);
}

export function jumpForceOf(values) {
  const h = Math.max(0, Number(values['jump.height']) || 0);
  const t = Math.max(0.1, Number(values['jump.duration']) || 0.1);
  return (4 * h) / t;
}

export function makeDefaults(baseLook) {
  const look = { ...defaultLook(), ...(baseLook || {}) };
  const values = {};
  for (const param of STORED_PARAMS) {
    if (param.alias) continue;
    if (param.key === 'look.robe') values[param.key] = look.robe;
    else if (param.key === 'look.hatColor') values[param.key] = look.hatColor;
    else if (param.key === 'look.staffColor') values[param.key] = look.staffColor;
    else if (param.key === 'look.skin') values[param.key] = look.skin;
    else if (param.key === 'look.hair') values[param.key] = look.hair;
    else if (param.key === 'look.magic') values[param.key] = look.magic;
    else values[param.key] = param.def;
  }
  return values;
}

const COLOR_RE = /^#([0-9a-f]{6})$/i;

function coerce(param, raw) {
  if (param.kind === 'toggle') return typeof raw === 'boolean' ? raw : !!raw;
  if (param.kind === 'select') {
    const allowed = (param.options || []).map((o) => o.id);
    return allowed.includes(raw) ? raw : undefined;
  }
  if (param.kind === 'color') {
    if (typeof raw !== 'string') return undefined;
    let value = raw.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(value)) {
      value = '#' + value.slice(1).split('').map((c) => c + c).join('');
    }
    return COLOR_RE.test(value) ? value : undefined;
  }
  if (param.kind === 'text') {
    return typeof raw === 'string' || typeof raw === 'number' ? String(raw).slice(0, 24) : undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (typeof param.min === 'number' && typeof param.max === 'number') {
    const clamped = clampNumber(n, param.min, param.max);
    const step = param.step || 0.01;
    const decimals = String(step).split('.')[1]?.length || 0;
    return Number(clamped.toFixed(decimals));
  }
  return n;
}

// Acepta objetos parciales (importaciones, perfiles) y devuelve valores
// completos, saneados y dentro de rango. Nunca lanza por culpa de un JSON raro.
export function sanitizeValues(raw, base = makeDefaults()) {
  const values = { ...base };
  let rejected = 0;
  if (!raw || typeof raw !== 'object') return { values, rejected: 1 };
  const source = raw.values && typeof raw.values === 'object' ? raw.values : raw;
  for (const param of STORED_PARAMS) {
    if (param.alias || !(param.key in source)) continue;
    const next = coerce(param, source[param.key]);
    if (next === undefined) {
      rejected++;
      continue;
    }
    values[param.key] = next;
  }
  // La gravedad es derivada, pero se acepta en importaciones para no perderla.
  if (Number.isFinite(Number(source['physics.gravity']))) {
    const gravity = clampNumber(Number(source['physics.gravity']), 5, 200);
    const h = Math.max(0.2, values['jump.height']);
    values['jump.duration'] = Number(
      clampNumber(2 * Math.sqrt((2 * h) / gravity), 0.2, 2).toFixed(2)
    );
  }
  if (values['camera.minDistance'] > values['camera.maxDistance'] - 2) {
    values['camera.minDistance'] = Math.max(8, values['camera.maxDistance'] - 2);
  }
  values['camera.distance'] = clampNumber(
    values['camera.distance'],
    values['camera.minDistance'],
    values['camera.maxDistance']
  );
  return { values, rejected };
}

export const PRESETS = [
  {
    id: 'normal',
    name: 'Normal',
    desc: 'Los valores originales del mago y del juego.',
    icon: '◇',
    patch: {},
  },
  {
    id: 'heavy',
    name: 'Lento y pesado',
    desc: 'Un mago de piedra: arranca despacio, gira poco y cae como un yunque.',
    icon: '⬢',
    patch: {
      'move.walkSpeed': 58,
      'move.runMultiplier': 1.15,
      'move.accel': 7,
      'move.decel': 9,
      'move.turnSpeed': 6,
      'move.strafe': 0.65,
      'move.back': 0.55,
      'jump.height': 2.1,
      'jump.duration': 0.85,
      'jump.fallForce': 2.2,
      'physics.mass': 2.4,
      'physics.capsuleRadius': 2.8,
      'camera.distance': 36,
      'camera.fov': 48,
      'anim.master': 0.82,
      'anim.arm': 0.7,
      'anim.torso': 1.35,
      'anim.transition': 0.32,
      'look.material': 'mate',
    },
  },
  {
    id: 'agile',
    name: 'Rápido y ágil',
    desc: 'Aceleración brutal, salto corto y cámara amplia para leer el combate.',
    icon: '➤',
    patch: {
      'move.walkSpeed': 138,
      'move.runMultiplier': 1.6,
      'move.accel': 38,
      'move.decel': 38,
      'move.turnSpeed': 26,
      'move.strafe': 1.18,
      'move.back': 0.95,
      'move.airControl': 0.65,
      'jump.height': 4.2,
      'jump.duration': 0.42,
      'jump.fallForce': 1.1,
      'physics.mass': 0.7,
      'physics.capsuleRadius': 1.8,
      'camera.distance': 27,
      'camera.fov': 62,
      'camera.smooth': 16,
      'anim.master': 1.18,
      'anim.transition': 0.1,
    },
  },
  {
    id: 'float',
    name: 'Mago flotante',
    desc: 'Salto largo y ingrávido, caída suave y mucho movimiento secundario.',
    icon: '❋',
    patch: {
      'move.walkSpeed': 72,
      'move.accel': 12,
      'move.airControl': 0.88,
      'jump.height': 2.7,
      'jump.duration': 1.55,
      'jump.fallForce': 0.55,
      'jump.maxHeight': 12,
      'physics.mass': 0.55,
      'camera.distance': 38,
      'camera.pitch': 42,
      'anim.accessory': 1.9,
      'anim.cloth': 1.6,
      'anim.torso': 1.25,
      'anim.secondary': true,
      'look.emissive': 0.22,
      'look.magicGlow': 1.55,
      'look.material': 'satinado',
    },
  },
  {
    id: 'test',
    name: 'Modo pruebas',
    desc: 'Velocidad y radio exagerados, recargas mínimas y depuración activa.',
    icon: '⌬',
    patch: {
      'move.walkSpeed': 185,
      'move.runMultiplier': 2.1,
      'move.accel': 40,
      'move.decel': 40,
      'move.turnSpeed': 40,
      'jump.height': 7,
      'jump.duration': 0.7,
      'jump.maxHeight': 14,
      'physics.capsuleRadius': 3.4,
      'camera.maxDistance': 90,
      'camera.distance': 46,
      'camera.fov': 72,
      'magic.power': 2.4,
      'magic.cooldown': 0.2,
      'magic.manaCost': 0.2,
      'magic.manaRegen': 3.5,
      'magic.projectileSpeed': 1.8,
      'magic.vfx': 1.8,
      'anim.master': 1.4,
      'debug.colliders': true,
      'debug.speed': true,
      'debug.coords': true,
      'debug.fps': true,
    },
  },
];

export const APPEARANCE_VARIANTS = [
  {
    id: 'archimago',
    name: 'Archimago',
    colors: { 'look.robe': '#2b3a8f', 'look.hatColor': '#15205a', 'look.staffColor': '#c9a227', 'look.magic': '#63e6ff', 'look.detail': '#d9b45a' },
  },
  {
    id: 'nigromante',
    name: 'Nigromante',
    colors: { 'look.robe': '#24102f', 'look.hatColor': '#140a1c', 'look.staffColor': '#3b3b46', 'look.magic': '#c184ff', 'look.detail': '#6d4b8f' },
  },
  {
    id: 'druida',
    name: 'Druida',
    colors: { 'look.robe': '#2f6a45', 'look.hatColor': '#21402b', 'look.staffColor': '#8a5a2b', 'look.magic': '#a6ff7a', 'look.detail': '#b58a5a' },
  },
  {
    id: 'igneo',
    name: 'Ígneo',
    colors: { 'look.robe': '#7a2216', 'look.hatColor': '#3d0f0a', 'look.staffColor': '#a0522d', 'look.magic': '#ffb347', 'look.detail': '#ff8a4c' },
  },
  {
    id: 'glacial',
    name: 'Glacial',
    colors: { 'look.robe': '#2b6cb0', 'look.hatColor': '#123f5a', 'look.staffColor': '#d8d2c0', 'look.magic': '#7dd3fc', 'look.detail': '#bde9ff' },
  },
];
