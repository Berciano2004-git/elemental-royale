// Grimorio elemental: datos compartidos por servidor y cliente.
//
// Cada hechizo es una receta declarativa. El servidor interpreta `fx` con un
// puñado de primitivas (proyectil, zona, estallido, rayo, salto, invocación) y
// el cliente elige la silueta y los materiales por `style`/`v`. Así los 32
// hechizos y las 28 fusiones comparten arquitectura en lugar de duplicar
// sistemas, y añadir uno nuevo es añadir una entrada aquí.

export const ELEMENT_KEYS = ['fire', 'water', 'wind', 'earth', 'lightning', 'ice', 'nature', 'dark'];

const ab = (id, name, desc, cd, mana, range, fx) => ({ id, name, desc, cd, mana, range, fx });
const projectile = (v, options) => ({ kind: 'projectile', v, ...options });
const volley = (v, count, spread, options) => ({ kind: 'volley', v, count, spread, ...options });
const zone = (type, style, options) => ({ kind: 'zone', type, style, ...options });
const burst = (style, options) => ({ kind: 'burst', style, ...options });
const beam = (style, options) => ({ kind: 'beam', style, ...options });
const dash = (style, options) => ({ kind: 'dash', style, ...options });
const leap = (style, options) => ({ kind: 'leap', style, ...options });
const summon = (mob, options) => ({ kind: 'summon', mob, ...options });

export const ELEMENTS = {
  fire: {
    name: 'Fuego',
    color: 0xff6b2c,
    dark: 0x8a2b0c,
    icon: '🔥',
    passive: '+12% de daño elemental',
    abilities: [
      ab('fireball', 'Bola de fuego', 'Orbe incandescente con estela de llamas que estalla al impactar y abre brasas ardientes.', 1.3, 12, 640,
        projectile('fireball', { speed: 540, life: 1.45, dmg: 17, radius: 3, splash: 64, splashDmg: 9, trail: 'fire' })),
      ab('meteorrain', 'Lluvia de meteoritos', 'Cuatro meteoritos caen en abanico sobre la zona marcada y dejan cráteres humeantes.', 13, 32, 720,
        zone('meteors', 'fire', { r: 160, count: 4, delay: 0.6, life: 2.6, dmg: 20, spread: 95 })),
      ab('flamewall', 'Muro de llamas', 'Una cortina de fuego irregular que corta el paso y quema a quien la cruza durante siete segundos.', 9, 24, 500,
        zone('wall', 'fire', { width: 180, life: 7, dps: 12 })),
      ab('fireburst', 'Explosión ígnea', 'El mago libera un estallido circular de fuego a su alrededor que aparta a los rivales cercanos.', 8, 22, 0,
        burst('fire', { radius: 200, dmg: 24, knock: 46, slow: { factor: 0.8, duration: 1.2 } })),
    ],
  },
  water: {
    name: 'Agua',
    color: 0x3fb6ff,
    dark: 0x0d4f78,
    icon: '💧',
    passive: 'Regeneras 1 de vida por segundo',
    abilities: [
      ab('jet', 'Chorro a presión', 'Atraviesa en línea recta a todos los que pilla y los deja pesados y lentos.', 1.0, 9, 520,
        projectile('jet', { speed: 760, life: 0.68, dmg: 11, radius: 3.2, pierce: true, slow: { factor: 0.68, duration: 0.9 } })),
      ab('tsunami', 'Ola de marea', 'Una ola tridimensional que avanza empujando y golpeando a todo el que alcanza.', 9, 26, 600,
        zone('wave', 'water', { width: 220, speed: 230, dmg: 14, life: 3, knock: 45 })),
      ab('waterprison', 'Prisión de agua', 'Una esfera líquida envuelve al objetivo y lo deja atrapado sin poder moverse.', 11, 26, 500,
        projectile('waterprison', { speed: 430, life: 1.2, dmg: 6, radius: 5, prison: { r: 58, life: 2.6 } })),
      ab('geyser', 'Géiser', 'Una columna de agua emerge violentamente del suelo y vuelve a golpear en oleadas.', 9, 24, 480,
        zone('geyser', 'water', { r: 92, life: 4, delay: 0.35, dmg: 14, interval: 0.9 })),
    ],
  },
  wind: {
    name: 'Aire',
    color: 0x8ef0c0,
    dark: 0x1d6b52,
    icon: '🌀',
    passive: 'Te mueves un 10% más rápido',
    abilities: [
      ab('tornado', 'Tornado', 'Un embudo de viento que arrastra hacia el centro y desgarra a quien queda dentro.', 10, 28, 540,
        zone('tornado', 'wind', { r: 105, pull: 240, speed: 24, dps: 11, life: 6 })),
      ab('gust', 'Ráfaga de viento', 'Aire comprimido que cruza la línea y aparta de un empujón a varios rivales.', 0.95, 8, 560,
        projectile('gust', { speed: 820, life: 0.62, dmg: 8, radius: 9, pierce: true, knock: 45 })),
      ab('airjump', 'Salto aéreo', 'Un impulso vertical y un desplazamiento que salva obstáculos y abre ángulos nuevos.', 10, 18, 280,
        leap('wind', { distance: 190, height: 5.2 })),
      ab('windcutter', 'Corte de viento', 'Dos cuchillas de aire comprimido que atraviesan a los enemigos alineados.', 2.4, 14, 620,
        volley('windblade', 2, 0.05, { speed: 900, life: 0.55, dmg: 10, radius: 7, pierce: true, knock: 20 })),
    ],
  },
  earth: {
    name: 'Tierra',
    color: 0xc08a4a,
    dark: 0x5b3a1d,
    icon: '🪨',
    passive: 'Ganas 30 de escudo al recoger el poder',
    abilities: [
      ab('rocks', 'Rocas proyectiles', 'Tres peñascos salen en abanico y apartan de un empujón a quien golpean.', 3.2, 16, 580,
        volley('rock', 3, 0.18, { speed: 440, life: 1.35, dmg: 13, radius: 3.4, knock: 22, delay: 0.1 })),
      ab('stonewall', 'Muro de piedra', 'Grandes bloques emergen del suelo y forman una cobertura que también golpea.', 10, 26, 460,
        zone('wall', 'stone', { width: 190, life: 9, dps: 6, slow: { factor: 0.7, duration: 0.4 } })),
      ab('spikes', 'Pinchos terrestres', 'Columnas de piedra estallan desde el terreno y dejan el suelo sembrado de esquirlas.', 8, 24, 520,
        zone('spikes', 'earth', { r: 150, delay: 0.35, life: 4, dmg: 26, slow: { factor: 0.6, duration: 0.6 } })),
      ab('golem', 'Golem de piedra', 'Un coloso rocoso camina junto al mago y aplasta a los rivales que se acercan.', 22, 42, 420,
        summon('golem', { r: 130, dps: 16, life: 12, speed: 120 })),
    ],
  },
  lightning: {
    name: 'Rayo',
    color: 0x9d8bff,
    dark: 0x3b2a8a,
    icon: '⚡',
    passive: 'Tus hechizos se recargan un 8% más rápido',
    abilities: [
      ab('discharge', 'Descarga eléctrica', 'Un relámpago instantáneo cae sobre la línea de tiro y electrifica a quien toca.', 1.1, 11, 560,
        beam('lightning', { dmg: 15, width: 16 })),
      ab('chain', 'Cadena de rayos', 'El rayo salta entre enemigos cercanos perdiendo fuerza en cada salto.', 5.5, 20, 520,
        beam('lightning', { dmg: 13, width: 14, chain: 4, chainRange: 190, falloff: 0.82 })),
      ab('blink', 'Teletransporte eléctrico', 'El mago se convierte en una chispa y reaparece unos metros más adelante.', 10, 20, 320,
        dash('lightning', { distance: 260 })),
      ab('electricfield', 'Campo electrificado', 'Un anillo de descargas continuas daña y ralentiza a quien se queda dentro.', 12, 30, 0,
        zone('field', 'lightning', { r: 120, life: 5, dps: 9, slow: { factor: 0.8, duration: 0.4 }, strike: 0.5 })),
    ],
  },
  ice: {
    name: 'Hielo',
    color: 0x7fe6ff,
    dark: 0x1c5f80,
    icon: '❄️',
    passive: 'Los cristales de vida te curan 6 más',
    abilities: [
      ab('icelances', 'Lanzas de hielo', 'Tres carámbanos perforan la línea y dejan a los heridos con los pies helados.', 2.2, 13, 620,
        volley('icelance', 3, 0.12, { speed: 700, life: 0.85, dmg: 9, radius: 2.6, pierce: true, slow: { factor: 0.6, duration: 1.1 } })),
      ab('freeze', 'Congelación', 'Una explosión de escarcha inmoviliza unos instantes a todo el que pilla.', 11, 28, 520,
        burst('ice', { atAim: true, radius: 110, dmg: 10, root: 1.8, slow: { factor: 0.4, duration: 2 } })),
      ab('slippery', 'Suelo resbaladizo', 'Una placa de hielo pulido frena y descontrola a quien intenta cruzarla.', 12, 24, 420,
        zone('field', 'ice', { r: 150, life: 6, slow: { factor: 0.5, duration: 0.4 } })),
      ab('iceprison', 'Prisión de hielo', 'Una estructura cristalina encierra al objetivo y le impide salir.', 14, 30, 500,
        zone('prison', 'ice', { r: 70, life: 2.8, root: true, dmg: 8 })),
    ],
  },
  nature: {
    name: 'Naturaleza',
    color: 0x62d97a,
    dark: 0x1e5c31,
    icon: '🌿',
    passive: 'Recuperas 5 de vida al recoger un cristal',
    abilities: [
      ab('roots', 'Raíces atrapantes', 'Raíces vivas brotan del suelo y retienen a quien pisa la zona.', 10, 26, 480,
        zone('prison', 'nature', { r: 100, life: 3, root: true, dps: 6 })),
      ab('vines', 'Enredaderas', 'Un látigo vegetal golpea y salta entre varios enemigos cercanos.', 6, 18, 520,
        beam('nature', { dmg: 11, width: 20, chain: 2, chainRange: 130, slow: { factor: 0.65, duration: 1 } })),
      ab('tree', 'Árbol protector', 'Un árbol frondoso crece al instante y sirve de cobertura real contra proyectiles.', 20, 30, 380,
        zone('tree', 'nature', { r: 80, life: 12, cover: true })),
      ab('spores', 'Esporas venenosas', 'Una nube de esporas contamina el aire y desgasta a quien respira dentro.', 12, 28, 500,
        zone('field', 'poison', { r: 150, life: 8, dps: 7, slow: { factor: 0.7, duration: 0.4 } })),
    ],
  },
  dark: {
    name: 'Oscuridad',
    color: 0xb06bff,
    dark: 0x2a1140,
    icon: '🌑',
    passive: 'Ganas 15 de escudo al recoger oscuridad',
    abilities: [
      ab('shadowstep', 'Paso sombrío', 'El mago se hunde en su propia sombra y emerge donde apunta.', 8, 18, 320,
        dash('dark', { distance: 280 })),
      ab('darkness', 'Zona de oscuridad', 'Una cúpula de penumbra reduce la visibilidad y arrastra a quien entra.', 14, 30, 520,
        zone('field', 'dark', { r: 160, life: 6, dps: 3, slow: { factor: 0.9, duration: 0.4 }, blind: true })),
      ab('shadowbolts', 'Proyectiles sombríos', 'Dos orbes de sombra persiguen ligeramente a los enemigos cercanos.', 2, 14, 600,
        volley('shadowbolt', 2, 0.08, { speed: 600, life: 1.1, dmg: 12, radius: 3, homing: 180 })),
      ab('shadowclone', 'Clon de sombras', 'Un doble de penumbra distrae y ralentiza a los rivales que lo rodean.', 18, 32, 300,
        summon('clone', { r: 100, dps: 0, slow: 0.75, life: 7, speed: 90 })),
    ],
  },
};

// 28 fusiones. La clave va ordenada alfabéticamente por `comboFor`.
export const COMBOS = {
  'dark+wind': {
    id: 'spectral', name: 'Vendaval espectral',
    desc: 'El mago avanza como una sombra de viento y deja un estallido espectral al llegar.',
    cd: 20, mana: 34, range: 340,
    fx: dash('spectral', { distance: 300, burst: { r: 120, dmg: 16, slow: { factor: 0.75, duration: 1.2 } } }),
  },
  'earth+wind': {
    id: 'sandstorm', name: 'Tormenta de arena',
    desc: 'Un remolino de polvo que azota, frena y reduce la visibilidad en una amplia zona.',
    cd: 21, mana: 36, range: 620,
    fx: zone('sandstorm', 'sand', { r: 190, life: 7, dps: 8, slow: { factor: 0.6, duration: 0.4 } }),
  },
  'fire+wind': {
    id: 'firestorm', name: 'Tormenta ígnea',
    desc: 'Un tornado en llamas que avanza por el escenario arrastrando y quemando.',
    cd: 23, mana: 40, range: 600,
    fx: zone('tornado', 'fire', { r: 120, pull: 260, speed: 32, dps: 16, life: 6 }),
  },
  'ice+wind': {
    id: 'blizzard', name: 'Ventisca',
    desc: 'Una tormenta de nieve y viento que ralentiza y llega a congelar a quien se queda dentro.',
    cd: 22, mana: 38, range: 620,
    fx: zone('field', 'blizzard', { r: 200, life: 7, dps: 7, slow: { factor: 0.45, duration: 0.5 }, root: 1.1 }),
  },
  'lightning+wind': {
    id: 'hurricane', name: 'Huracán eléctrico',
    desc: 'Un tornado cargado que descarga rayos mientras arrastra a los rivales.',
    cd: 24, mana: 42, range: 600,
    fx: zone('tornado', 'storm', { r: 120, pull: 260, speed: 34, dps: 14, life: 6, strike: 0.45 }),
  },
  'nature+wind': {
    id: 'pollen', name: 'Polen salvaje',
    desc: 'Una ráfaga de esporas vegetales que se pega a la piel y frena a los enemigos.',
    cd: 19, mana: 32, range: 600,
    fx: zone('field', 'pollen', { r: 170, life: 8, dps: 5, slow: { factor: 0.6, duration: 0.5 } }),
  },
  'water+wind': {
    id: 'icestorm', name: 'Tormenta helada',
    desc: 'Lluvia y viento gélidos cubren la zona y dejan a los rivales empapados y lentos.',
    cd: 22, mana: 38, range: 640,
    fx: zone('storm', 'ice', { r: 190, life: 6, dps: 9, slow: { factor: 0.5, duration: 0.4 }, strike: 0.7 }),
  },
  'dark+earth': {
    id: 'abyssalprison', name: 'Prisión abismal',
    desc: 'Una jaula de piedra oscura emerge del suelo y encierra a todo el que pilla dentro.',
    cd: 23, mana: 40, range: 560,
    fx: zone('prison', 'abyss', { r: 110, life: 3.2, root: true, dps: 5 }),
  },
  'dark+fire': {
    id: 'abyssflame', name: 'Llama abismal',
    desc: 'Fuego negro que persigue al objetivo y deja un reguero de lava oscura.',
    cd: 22, mana: 40, range: 640,
    fx: projectile('abyssflame', { speed: 420, life: 2.4, dmg: 24, radius: 5, splash: 70, splashDmg: 12, homing: 220, leavesLava: true }),
  },
  'dark+ice': {
    id: 'frostmist', name: 'Escarcha espectral',
    desc: 'Una niebla oscura que congela lentamente y roba la vista a quien se adentra.',
    cd: 21, mana: 36, range: 620,
    fx: zone('field', 'frost', { r: 180, life: 8, dps: 6, slow: { factor: 0.35, duration: 0.6 }, blind: true }),
  },
  'dark+lightning': {
    id: 'shadowbolt', name: 'Relámpago sombrío',
    desc: 'El mago salta entre sombras eléctricas y descarga una explosión al reaparecer.',
    cd: 20, mana: 34, range: 360,
    fx: dash('shadow', { distance: 320, burst: { r: 130, dmg: 20, slow: { factor: 0.7, duration: 1 } } }),
  },
  'dark+nature': {
    id: 'cursedforest', name: 'Bosque maldito',
    desc: 'Raíces sombrías persiguen y atrapan a los enemigos dentro de un bosque retorcido.',
    cd: 24, mana: 42, range: 620,
    fx: zone('field', 'cursed', { r: 190, life: 8, dps: 9, root: 1.0, slow: { factor: 0.6, duration: 0.4 } }),
  },
  'dark+water': {
    id: 'abyss', name: 'Abismo',
    desc: 'Un vórtice de agua negra que atrae hacia el centro y desgasta a quien cae dentro.',
    cd: 23, mana: 40, range: 620,
    fx: zone('tornado', 'abyss', { r: 130, pull: 300, speed: 18, dps: 9, life: 6 }),
  },
  'earth+fire': {
    id: 'magma', name: 'Magma',
    desc: 'El suelo se abre en grietas volcánicas que escupen lava y frenan el paso.',
    cd: 22, mana: 40, range: 700,
    fx: zone('field', 'magma', { r: 160, life: 7, dps: 13, slow: { factor: 0.7, duration: 0.4 }, erupt: 1.2 }),
  },
  'earth+ice': {
    id: 'crystal', name: 'Cristalización',
    desc: 'Grandes cristales de hielo y piedra emergen del suelo y encierran a los rivales.',
    cd: 22, mana: 38, range: 600,
    fx: zone('spikes', 'crystal', { r: 180, delay: 0.4, life: 6, dmg: 24, root: 0.8, slow: { factor: 0.5, duration: 0.8 } }),
  },
  'earth+lightning': {
    id: 'earthquake', name: 'Terremoto eléctrico',
    desc: 'El suelo se agrieta y libera descargas en cadena que sacuden toda la zona.',
    cd: 24, mana: 42, range: 620,
    fx: burst('earthquake', { atAim: true, radius: 210, dmg: 28, slow: { factor: 0.55, duration: 2 }, chain: 3 }),
  },
  'earth+nature': {
    id: 'guardian', name: 'Guardián ancestral',
    desc: 'Un coloso de piedra, raíces y madera se alza y combate junto a su invocador.',
    cd: 26, mana: 46, range: 460,
    fx: summon('guardian', { r: 150, dps: 20, life: 14, speed: 105 }),
  },
  'earth+water': {
    id: 'mud', name: 'Pantano',
    desc: 'El suelo se convierte en barro espeso que atrapa los pies y ralentiza mucho.',
    cd: 20, mana: 32, range: 600,
    fx: zone('mud', 'earth', { r: 170, life: 7, dps: 4, slow: { factor: 0.5, duration: 0.4 } }),
  },
  'fire+ice': {
    id: 'thermal', name: 'Choque térmico',
    desc: 'Un cambio de temperatura imposible revienta la zona y desestabiliza a los rivales.',
    cd: 21, mana: 36, range: 580,
    fx: burst('thermal', { atAim: true, radius: 170, dmg: 26, knock: 70, slow: { factor: 0.7, duration: 1.4 } }),
  },
  'fire+lightning': {
    id: 'plasma', name: 'Plasma',
    desc: 'Una esfera de plasma se forma y explota liberando descargas alrededor.',
    cd: 23, mana: 40, range: 620,
    fx: zone('plasma', 'plasma', { r: 110, delay: 0.5, life: 4, dmg: 30, chain: 3 }),
  },
  'fire+nature': {
    id: 'wildfire', name: 'Incendio forestal',
    desc: 'Raíces incendiadas se extienden por el terreno y amplían el fuego sin parar.',
    cd: 22, mana: 38, range: 620,
    fx: zone('field', 'wildfire', { r: 150, life: 8, dps: 11, slow: { factor: 0.75, duration: 0.4 }, grow: 240 }),
  },
  'fire+water': {
    id: 'steam', name: 'Vapor',
    desc: 'Una explosión de vapor caliente levanta una nube enorme que deja a todos lentos.',
    cd: 18, mana: 30, range: 600,
    fx: zone('steam', 'steam', { r: 180, life: 7, dps: 4, slow: { factor: 0.55, duration: 0.4 } }),
  },
  'ice+lightning': {
    id: 'polar', name: 'Tormenta polar',
    desc: 'Cristales de hielo electrificados caen y descargan sobre la zona helada.',
    cd: 23, mana: 40, range: 620,
    fx: zone('field', 'polar', { r: 180, life: 7, dps: 11, slow: { factor: 0.4, duration: 0.5 }, strike: 0.5 }),
  },
  'ice+nature': {
    id: 'glacial', name: 'Jardín glacial',
    desc: 'Vegetación congelada brota del suelo y forma trampas que atrapan a los rivales.',
    cd: 22, mana: 38, range: 600,
    fx: zone('prison', 'glacial', { r: 190, life: 7, root: true, dps: 7, slow: { factor: 0.5, duration: 0.5 } }),
  },
  'ice+water': {
    id: 'glacierwave', name: 'Maremoto glaciar',
    desc: 'Una ola gigantesca de agua congelada avanza y deja el terreno helado a su paso.',
    cd: 23, mana: 40, range: 620,
    fx: zone('wave', 'ice', { width: 240, speed: 200, dmg: 24, life: 3, slow: { factor: 0.5, duration: 1.6 }, knock: 30 }),
  },
  'lightning+nature': {
    id: 'vital', name: 'Sobrecarga vital',
    desc: 'Raíces conductoras transmiten la corriente entre todos los enemigos de la zona.',
    cd: 22, mana: 38, range: 600,
    fx: zone('field', 'vital', { r: 170, life: 7, dps: 10, slow: { factor: 0.6, duration: 0.4 }, strike: 0.6 }),
  },
  'lightning+water': {
    id: 'overload', name: 'Sobrecarga',
    desc: 'El agua se electrifica y los arcos recorren la superficie buscando rivales.',
    cd: 22, mana: 38, range: 620,
    fx: zone('field', 'electricwater', { r: 170, life: 6, dps: 13, slow: { factor: 0.75, duration: 0.4 }, strike: 0.35 }),
  },
  'nature+water': {
    id: 'growth', name: 'Crecimiento salvaje',
    desc: 'Una maraña de raíces y vegetación gigantes invade la zona y retiene a los rivales.',
    cd: 20, mana: 34, range: 600,
    fx: zone('prison', 'overgrowth', { r: 190, life: 7, root: true, dps: 6 }),
  },
};

export function comboFor(elementA, elementB) {
  if (!elementA || !elementB || elementA === elementB) return null;
  const key = [elementA, elementB].sort().join('+');
  return COMBOS[key] || null;
}
