// Constantes compartidas entre servidor y cliente.

export const GAME_NAME = 'Elemental Royale';
export const WORLD_SIZE = 2400;
export const HALF_WORLD = WORLD_SIZE / 2;

export const MAX_HP = 100;
export const MAX_MANA = 100;
export const MAX_STAMINA = 100;
export const PLAYER_SPEED = 94;
export const PLAYER_RADIUS = 2.1;
export const MATCH_PLAYERS = 10;

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const LOBBY_TIME = 15;

export const STORM_PHASES = [
  { wait: 32, shrink: 24, radius: 950, dps: 3 },
  { wait: 22, shrink: 20, radius: 640, dps: 5 },
  { wait: 18, shrink: 17, radius: 400, dps: 8 },
  { wait: 15, shrink: 14, radius: 230, dps: 12 },
  { wait: 12, shrink: 11, radius: 110, dps: 16 },
  { wait: 8, shrink: 8, radius: 45, dps: 24 },
];

export const ELEMENT_KEYS = ['fire', 'water', 'wind', 'earth'];

export const ELEMENTS = {
  fire: {
    name: 'Fuego',
    color: 0xff6b2c,
    dark: 0x8a2b0c,
    passive: '+12% de daño elemental',
    abilities: [
      {
        id: 'lavabolt',
        name: 'Disparo de lava',
        desc: 'Proyectil incandescente que explota y deja un charco de lava.',
        cd: 1.4,
        mana: 14,
        range: 620,
      },
      {
        id: 'flamewall',
        name: 'Muro de llamas',
        desc: 'Levanta una barrera de fuego que quema a quien la cruza.',
        cd: 7,
        mana: 24,
        range: 460,
      },
    ],
  },
  water: {
    name: 'Agua',
    color: 0x3fb6ff,
    dark: 0x0d4f78,
    passive: 'Regeneras 1 de vida por segundo',
    abilities: [
      {
        id: 'jet',
        name: 'Chorro de agua',
        desc: 'Un chorro a presión que atraviesa a varios enemigos.',
        cd: 1.1,
        mana: 12,
        range: 500,
      },
      {
        id: 'tsunami',
        name: 'Tsunami',
        desc: 'Una ola enorme avanza, daña y empuja a los rivales.',
        cd: 9,
        mana: 28,
        range: 600,
      },
    ],
  },
  wind: {
    name: 'Viento',
    color: 0x8ef0c0,
    dark: 0x1d6b52,
    passive: 'Te mueves un 10% más rápido',
    abilities: [
      {
        id: 'gust',
        name: 'Ráfaga de viento',
        desc: 'Onda de aire veloz que empuja y desestabiliza.',
        cd: 1.2,
        mana: 10,
        range: 560,
      },
      {
        id: 'tornado',
        name: 'Tornado',
        desc: 'Un remolino que atrae y desgarra a los enemigos.',
        cd: 9,
        mana: 26,
        range: 520,
      },
    ],
  },
  earth: {
    name: 'Tierra',
    color: 0xc08a4a,
    dark: 0x5b3a1d,
    passive: 'Ganas 30 de escudo al recoger el poder',
    abilities: [
      {
        id: 'rocks',
        name: 'Invocar rocas',
        desc: 'Tres rocas gigantes brotan y vuelan hacia tu objetivo.',
        cd: 3.6,
        mana: 18,
        range: 580,
      },
      {
        id: 'quake',
        name: 'Terremoto',
        desc: 'Sacude el suelo: daña y ralentiza a los enemigos cercanos.',
        cd: 8,
        mana: 22,
        range: 0,
      },
    ],
  },
};

export function elementCss(key) {
  const c = ELEMENTS[key].color;
  return '#' + c.toString(16).padStart(6, '0');
}

// Combinaciones elementales. Se desbloquean al llevar los dos elementos.
export const COMBOS = {
  'earth+fire': {
    id: 'meteor',
    name: 'Meteorito',
    desc: 'Un meteorito cae sobre el objetivo y abre un cráter ardiente.',
    cd: 24,
    mana: 40,
    range: 700,
  },
  'water+wind': {
    id: 'thunderstorm',
    name: 'Tormenta',
    desc: 'Una tormenta eléctrica descarga sobre una gran zona.',
    cd: 26,
    mana: 45,
    range: 640,
  },
  'earth+water': {
    id: 'mud',
    name: 'Pantano de barro',
    desc: 'Un cenagal que atrapa y ralentiza a los rivales.',
    cd: 22,
    mana: 35,
    range: 600,
  },
  'fire+wind': {
    id: 'firestorm',
    name: 'Torbellino ígneo',
    desc: 'Un tornado en llamas que arrastra y quema.',
    cd: 25,
    mana: 42,
    range: 600,
  },
  'fire+water': {
    id: 'steam',
    name: 'Nube de vapor',
    desc: 'Vapor ardiente que ciega y ralentiza dentro de la nube.',
    cd: 20,
    mana: 30,
    range: 600,
  },
  'earth+wind': {
    id: 'sandstorm',
    name: 'Tormenta de arena',
    desc: 'Una tempestad de polvo que azota una amplia zona.',
    cd: 23,
    mana: 38,
    range: 620,
  },
};

export function comboFor(elementA, elementB) {
  if (!elementA || !elementB || elementA === elementB) return null;
  const key = [elementA, elementB].sort().join('+');
  return COMBOS[key] || null;
}

export const RARITIES = {
  common: { name: 'Común', color: 0xcbd5e1, power: 1, weight: 48 },
  uncommon: { name: 'Poco común', color: 0x5fd47a, power: 1.09, weight: 26 },
  rare: { name: 'Raro', color: 0x4aa3ff, power: 1.18, weight: 15 },
  epic: { name: 'Épico', color: 0xb35cff, power: 1.27, weight: 8 },
  legendary: { name: 'Legendario', color: 0xffc247, power: 1.38, weight: 3 },
};

export const RARITY_KEYS = Object.keys(RARITIES);

// Los ids son históricos (se guardan en los aspectos): las piezas son, en este
// orden, sombrero de fieltro, sombrero de ala ancha, casco de cuero, capucha de
// cuero con vuelta de pelo, capucha de paño y diadema sobre casquete.
export const HATS = [
  { id: 'pointy', name: 'Sombrero de archimago' },
  { id: 'wide', name: 'Sombrero de caminante' },
  { id: 'horns', name: 'Casco de cuero' },
  { id: 'leaves', name: 'Capucha de cuero' },
  { id: 'dark', name: 'Capucha de paño' },
  { id: 'crystal', name: 'Diadema rúnica' },
];

export const STAVES = [
  { id: 'wood', name: 'Bastón de madera' },
  { id: 'crystal', name: 'Bastón de cristal' },
  { id: 'fire', name: 'Bastón de fuego' },
  { id: 'ice', name: 'Bastón de hielo' },
  { id: 'roots', name: 'Bastón de raíces' },
  { id: 'dark', name: 'Bastón oscuro' },
];

export const ROBE_COLORS = [
  '#5b4bd6', '#2f8f6e', '#c0392b', '#d99a2b', '#2b6cb0',
  '#8e44ad', '#d35480', '#3c4a5a', '#7bbf4a', '#e8e0c8',
  '#1f2937', '#ef8bb5',
];

export const HAT_COLORS = [
  '#2b2440', '#3d2b56', '#1f2937', '#123f3a', '#5a1f24',
  '#e8e0c8', '#d9a441', '#7b3fa0', '#2f8f6e', '#0d4f78',
];

export const STAFF_COLORS = [
  '#8a5a2b', '#d8d2c0', '#3b3b46', '#c9a227', '#6b4a8a',
  '#a0522d', '#e8e0c8', '#5a1f24',
];

export const MAGIC_COLORS = [
  '#63e6ff', '#ffb347', '#ff6b8a', '#a6ff7a', '#c184ff',
  '#ffe066', '#7dd3fc', '#f5f5f5',
];

export const SKIN_COLORS = ['#f2c7a0', '#d99b6c', '#b5794f', '#8a5a3b', '#6b3f28'];
export const HAIR_COLORS = ['#2b2440', '#6b3f28', '#c9a227', '#e8e0c8', '#a33b3b', '#5b4bd6'];

export function defaultLook() {
  return {
    robe: '#5b4bd6',
    hat: 'pointy',
    hatColor: '#2b2440',
    staff: 'crystal',
    staffColor: '#8a5a2b',
    magic: '#63e6ff',
    skin: '#f2c7a0',
    hair: '#6b3f28',
  };
}

export function randomLook(rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  return {
    robe: pick(ROBE_COLORS),
    hat: pick(HATS).id,
    hatColor: pick(HAT_COLORS),
    staff: pick(STAVES).id,
    staffColor: pick(STAFF_COLORS),
    magic: pick(MAGIC_COLORS),
    skin: pick(SKIN_COLORS),
    hair: pick(HAIR_COLORS),
  };
}

const NAME_A = [
  'Astra', 'Bruma', 'Ceniza', 'Duna', 'Eira', 'Faro', 'Grim', 'Hielo',
  'Iris', 'Jade', 'Kael', 'Luna', 'Mira', 'Nube', 'Orion', 'Pico',
  'Quark', 'Runa', 'Sable', 'Tilo', 'Umbra', 'Vega', 'Wisp', 'Yara', 'Zafiro',
];
const NAME_B = [
  'el Errante', 'la Sabia', 'Tormenta', 'de Cristal', 'el Veloz',
  'Sombraverde', 'el Antiguo', 'de Fuego', 'la Bruma', 'el Sabio',
];

export function randomWizardName(rand = Math.random) {
  const a = NAME_A[Math.floor(rand() * NAME_A.length)];
  const b = NAME_B[Math.floor(rand() * NAME_B.length)];
  return `${a} ${b}`;
}
