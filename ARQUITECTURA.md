# Arquitectura de Elemental Royale

Este documento explica **cómo funciona el proyecto por dentro**: qué procesos hay, quién manda,
cómo viaja un clic hasta convertirse en daño, cómo se genera el mundo, cómo se dibuja y dónde
tocar cada cosa para ampliarla.

Para jugar, los controles y el contenido del juego, empieza por el [README](README.md).

---

## 1. Idea general

Elemental Royale es un *battle royale* 3D para navegador. Diez magos (humanos y bots) caen en
una isla procedural, recogen cristales elementales y se enfrentan mientras una tormenta cierra
el círculo.

Tres decisiones explican casi todo el código:

1. **El servidor es autoritativo.** El cliente no decide posición, daño ni economía: envía
   intención (moverse, apuntar, lanzar) y recibe la verdad a 20 instantáneas por segundo.
2. **Cliente y servidor comparten la simulación barata.** La generación del mapa, las colisiones
   y las constantes viven en `shared/` y se ejecutan en ambos lados, de modo que el cliente puede
   predecir el movimiento sin inventarse un mundo distinto.
3. **El arte se genera por código.** Solo el mago viene de un GLB; terreno, vegetación, agua,
   cielo, partículas, sombreros, bastones, música y efectos se construyen con Three.js, Canvas y
   WebAudio.

```
┌──────────────────────────────┐         WebSocket /ws          ┌──────────────────────────────┐
│ Navegador                    │  ───────────────────────────▶  │ Node.js                      │
│                              │   input, jump, cast, combo...  │                              │
│ index.html + style.css       │                                │ server/index.js              │
│ src/main.js  (pegamento)     │  ◀───────────────────────────  │   HTTP + Vite o dist/        │
│ src/three/*  (WebGL)         │   welcome, lobby, start,       │   upgrade a /ws              │
│ src/ui.js, hud.js, audio.js  │   snap, end, error             │ server/game.js (autoritativo)│
│                              │                                │ server/bots.js (IA)          │
│ shared/*  (misma matemática) │                                │ shared/*  (misma matemática) │
└──────────────────────────────┘                                └──────────────────────────────┘
```

Todo el estado de una partida vive **en memoria del proceso Node**. No hay base de datos para la
partida: al terminar, el resumen se puede archivar en un disco Archil (opcional).

---

## 2. Cómo se arranca

Requisitos: Node.js 20+ (22.19+ si se usa el historial de Archil) y un navegador con WebGL.

```bash
npm install
npm run dev        # desarrollo: Vite como middleware, módulos transformados al pedirlos
npm run build      # compila a dist/
npm start          # producción: sirve dist/ y el WebSocket
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Arranca `server/index.js` sin `--prod`. Vite transforma los módulos al pedirlos (sin HMR). |
| `npm run build` | `vite build` → `dist/` (HTML, CSS y un bundle JS). |
| `npm start` | `node server/index.js --prod`: sirve `dist/` con MIME y caché básicos. |
| `npm run test:match` | Prueba de integración de una partida (necesita un servidor en 8081). |
| `npm run test:end` | Observa una partida completa hasta el ganador y el reinicio de sala. |
| `npm run rig`, `rig:optimize`, `rig:audit` | Pipeline del modelo del mago y su diagnóstico. |

Variables de entorno:

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `8080` | Puerto HTTP y WebSocket. |
| `NODE_ENV=production` | — | Equivale a `--prod` (sirve `dist/`). |
| `ADMIN_TOOLS` | activo en desarrollo | `1` permite tuning y teletransporte de admin también en producción. |
| `ARCHIL_API_KEY` | — | Activa el historial persistente de partidas. |
| `ARCHIL_REGION` | `aws-us-east-1` | Región del disco Archil. |
| `ARCHIL_DISK` | `elemental-royale` | Nombre del disco; se crea la primera vez. |

`server/index.js` carga `.env` y `.env.local` con `process.loadEnvFile` si existen. Las claves
nunca llegan al navegador.

En desarrollo, Vite se monta como *middleware* en el mismo servidor HTTP (`middlewareMode`,
`hmr: false`): un solo puerto sirve la app y el WebSocket. En producción, el servidor resuelve
rutas contra `dist/`, cae a `index.html` para rutas desconocidas y protege contra *path traversal*
comprobando que el archivo resuelto siga dentro de `dist/`.

El WebSocket se acepta solo en `/ws`; cualquier otro *upgrade* se destruye. El tamaño máximo de
mensaje es 16 KB, suficiente para el protocolo y pequeño frente a abusos.

---

## 3. Mapa del repositorio

```
index.html                  estructura de pantallas, HUD y cinemática de nado
src/
  main.js                   pegamento: red, entrada, bucle, pantallas, admin
  style.css                 toda la interfaz (menús, HUD, panel, cinemática)
  ui.js                     menús, taller, sala, colección, ajustes, resultados
  hud.js                    barras, poderes, minimapa, nombres flotantes, killfeed
  net.js                    cliente WebSocket con handlers por tipo de mensaje
  audio.js                  música y efectos procedurales con WebAudio
  preview.js                escaparate 3D del mago en menús y taller
  three/
    gameview.js             partida: cámara, predicción, magos, cámara de agua
    world.js                terreno, agua, cielo, props, botín, tormenta, minimapa
    wizard.js               mago GLB, materiales, sombreros, bastones, puño, nado
    effects.js              partículas, anillos, proyectiles y zonas de hechizo
  admin/
    config.js               esquema, límites, perfiles y validación del panel
    panel.js                interfaz del panel, atajos, presets, import/export
    admin.css               estilos del panel y overlays de depuración
shared/
  constants.js              elementos, hechizos, combos, rarezas, cosméticos, red
  worldgen.js               ruido, biomas, props, lugares, colisión y agua
  movement.js               normalización de entrada y deslizamiento con colisión
server/
  index.js                  HTTP + Vite/dist + upgrade WebSocket
  game.js                   sala, tick autoritativo, combate, tormenta, protocolo
  bots.js                   IA de los magos controlados por el servidor
  history.js                historial opcional en un disco Archil
tools/
  optimize-wizard.mjs       soldadura, simplificación y compresión del GLB base
  rig-wizard.mjs            esqueleto, pesos, regiones teñibles y clips
  audit-wizard.mjs          diagnóstico de huesos, pesos, suelo y ciclos
public/models/mago.glb      modelo final que carga el cliente
assets-source/              modelo intermedio del pipeline (fuera de dist/)
scripts/                    pruebas de integración y CLI del historial
```

---

## 4. El servidor

### 4.1 Arranque y conexión

`server/index.js` crea el servidor HTTP y un `WebSocketServer` en modo `noServer`, y engancha el
`upgrade` de `/ws`. `createGame(wss, { admin })` registra el manejador de conexiones y devuelve
`{ close }` para pruebas.

Cada conexión crea un objeto `client`:

```js
{ id, ws, joined: false, name: '', look: defaultLook(), player: null }
```

`joined` separa “conectado” de “dentro de la sala”. La sala admite como máximo `MATCH_PLAYERS`
(10) clientes humanos; los huecos se rellenan con bots. El primero en entrar es el **anfitrión**
y puede forzar el inicio (`start`).

### 4.2 Máquina de estados

```
lobby ──(cuenta atrás 15 s o start del anfitrión)──▶ match
match ──(queda un vivo, o 420 s)──────────────────▶ ending (9 s)
ending ──(fin del temporizador o todos se van)────▶ lobby
```

- En `lobby` se difunde `lobby` cada segundo con jugadores, cuenta atrás, anfitrión y capacidad.
- `startMatch()` genera semilla, mundo, jugadores (humanos y bots), tormenta y botín, y envía a
  cada humano un `start` con la lista inicial y los cristales.
- En `match` corre `simulate(dt)` a 30 Hz.
- `finishMatch()` calcula el podio, envía `end` y deja 9 segundos para leer resultados.
- Al volver a `lobby` se limpia el estado y los jugadores pueden cambiar de aspecto otra vez.

### 4.3 Bucle y reloj

```js
setInterval(() => {
  const dt = Math.min(0.12, (now - last) / 1000);
  if (phase === 'lobby') updateLobby(dt);
  else if (phase === 'match') simulate(dt);
  else if (phase === 'ending') { endTimer -= dt; if (endTimer <= 0) toLobby(); }
}, 1000 / TICK_RATE);   // TICK_RATE = 30
```

El `dt` se recorta a 0,12 s: si el proceso se congela, la simulación no da un salto enorme. La
instantánea se acumula en `snapAcc` y se emite a `SNAPSHOT_RATE` (20 Hz), independiente del tick.

### 4.4 Protocolo

Mensajes **cliente → servidor** (JSON con campo `t`):

| Mensaje | Campos | Efecto |
| --- | --- | --- |
| `join` | `name`, `look` | Sanea nombre y aspecto, responde `welcome` y difunde la sala. |
| `look` | `look` | Cambia el aspecto en la sala (no en partida). |
| `start` | — | Solo el anfitrión; inicia la partida si está en `lobby`. |
| `input` | `mx`, `mz`, `ax`, `az`, `sprint` | Intención de movimiento y apuntado; se guarda para el tick. |
| `select` | `slot` (0/1) | Cambia el poder activo si existe. |
| `jump` | — | Salto; rechazado si ya está en el aire o nadando. |
| `cast` | `slot`, `ability` (0/1), `ax`, `az` | Lanza el hechizo si hay poder, recarga y maná. |
| `combo` | `ax`, `az` | Lanza la combinación si hay dos elementos distintos. |
| `adminTune` | `tune` | Solo si el servidor permite admin; sanea cada valor. |
| `adminTeleport` | `x`, `z` o `reset` | Teletransporte validado con `canStand`. |

Mensajes **servidor → cliente**:

| Mensaje | Contenido |
| --- | --- |
| `welcome` | `id`, `name`, `look`, `hostId`, `admin` (si el servidor acepta tuning). |
| `lobby` | Lista de jugadores, bots que faltan, cuenta atrás, fase, anfitrión. |
| `start` | `seed`, `you`, `storm`, jugadores con aspecto y posición, cristales. |
| `snap` | Instantánea de 20 Hz (ver abajo). |
| `end` | Ganador, puesto propio, bajas y podio. |
| `error` | Sala llena u otros rechazos. |
| `admin` | Confirmación del tuning aplicado. |
| `adminTeleport` | Resultado del salto (`ok`, `x`, `z`, `swim`). |

Instantánea (`snap`), por jugador:

```js
{
  i: id, x, z, yaw,
  hp, sh,            // vida y escudo
  al,                // vivo (1/0)
  k,                 // bajas
  sl, act,           // dos poderes { e: elemento, r: rareza } y cuál está activo
  cd,                // recargas por poder
  cc,                // recarga de combo
  mn, st,            // maná y aguante redondeados
  j,                 // altura del salto
  sw,                // nadando
  sf,                // ralentizado
  place
}
```

Además: `storm` (centro, radio, siguiente círculo), `projs` (proyectiles con posición, dirección,
retardo y dueño), `zones` (muros, olas, tornados…), `alive` y `fx` (eventos visuales de un solo
uso: casteos, impactos, muertes, recogidas, curaciones). Los objetos pesados (mallas, texturas)
solo viajan en `start`; el resto es ligero y continuo.

---

## 5. La simulación

### 5.1 Jugador

`makePlayer()` crea el estado autoritativo. Lo importante:

```js
{
  id, name, look, bot, client,
  x, z, prevX, prevZ, velX, velZ, yaw, aimX, aimZ,
  hp, shield, mana, stamina, alive, kills, place,
  slots: [null, null], active,
  cds: { fire: [0, 0], water: [...], wind: [...], earth: [...] },
  comboCd, slowUntil, slowFactor,
  input: { x, z, sprint }, moving, mvX, mvZ,
  jumpY, jumpV, swimming, admin
}
```

Las posiciones son **XZ**; la altura se resuelve con el terreno. No hay física 3D de cuerpos: el
salto es un arco vertical (`jumpY`) y las colisiones son círculos en el plano.

### 5.2 Movimiento

Cada tick, para cada vivo:

1. Si no hay entrada humana en 0,7 s, se fuerza `input = 0` (evita clientes congelados que sigan
   corriendo).
2. `normalizeInput()` limita la diagonal a 1.
3. Se aplican los multiplicadores de lateral (`strafe`) y marcha atrás (`back`) respecto al yaw.
4. Velocidad base `walkSpeed`; viento ×1,1; sprint ×`runMult`; ralentización ×0,55; **agua ×0,56**.
5. Aceleración/freno exponenciales (`1 - e^(-rate·dt)`), con control aéreo reducido.
6. `moveWithCollision()` intenta el movimiento completo y, si falla, desliza por X o por Z.
7. Se actualiza `jumpY` con gravedad derivada de altura y duración; el salto no se puede repetir
   hasta tocar suelo y se cancela al entrar al agua.
8. `yaw` sigue al punto de apuntado si está a más de 0,4 unidades.

El salto se deriva de dos parámetros de diseño —altura y duración— y no de una gravedad fija:
`g = 8·h / t²`. Así el panel puede cambiar el salto sin tocar el código y cliente y servidor
calculan lo mismo.

**Nado.** `world.depthAt(x, z)` es `WATER_SURFACE - heightAt(x, z)`. Si supera `SWIM_DEPTH`
(0,32) el jugador nada: velocidad ×0,56, sin sprint, sin salto y sin gasto de aguante. El cliente
usa exactamente el mismo umbral para predecir. La orilla no es un muro: `canStand`, `canWade` y
`canSwim` se solapan, y `canTraverse()` (en `shared/movement.js`) acepta cualquiera de los tres.

### 5.3 Cristales y economía

- 74 cristales de poder y 22 de vida repartidos por tierra, más tesoros junto a cada lugar
  especial y un poder + una vida junto a cada aparición.
- Recoger es automático a menos de 8 unidades.
- Dos huecos de poder. Si ambos están llenos, el nuevo sustituye al activo y el antiguo cae al
  suelo con un breve bloqueo para el jugador que lo soltó (evita recogerlo sin querer).
- Vida: +28. Tierra: +30 de escudo (máximo 70).
- La rareza pondera la aparición (común 48, poco común 26, raro 15, épico 8, legendario 3) y
  multiplica el daño de 1,00 a 1,38.

### 5.4 Hechizos

Cada elemento tiene dos habilidades con recarga, maná y alcance propios, más un pasivo.
`castAbility()` comprueba fase, poder, recarga y maná; descuenta el coste, arranca la recarga y
resuelve el efecto. El daño final es:

```
daño = base × potenciaDeRareza × (fuego equipado ? 1,12 : 1) × tuning del servidor
```

| Elemento | Clic izquierdo | Clic derecho | Pasivo |
| --- | --- | --- | --- |
| Fuego | `lavabolt`: proyectil con explosión y charco | `flamewall`: muro de fuego de 7 s | +12 % de daño |
| Agua | `jet`: chorro perforante que ralentiza | `tsunami`: ola que daña y empuja | +1 vida/s |
| Viento | `gust`: ráfaga que empuja | `tornado`: remolino que atrae | +10 % de velocidad |
| Tierra | `rocks`: tres rocas | `quake`: daño y ralentización en área | +30 de escudo al recoger |

Las **combinaciones** (`comboFor`) requieren los dos elementos distintos y una recarga propia
(20–26 s, 30–45 de maná). Producen zonas persistentes o proyectiles especiales: meteorito,
tormenta, pantano, torbellino ígneo, nube de vapor y tormenta de arena.

Los proyectiles se mueven por pasos de 6 unidades como máximo para no atravesar objetivos a gran
velocidad; algunos perforan, otros explotan o empujan. Las zonas (`wall`, `wave`, `tornado`,
`meteor`, `thunderstorm`…) viven en `state.zones`, aplican daño por segundo o por impacto y se
sincronizan al cliente con su vida restante.

### 5.5 Daño, muerte y fin

`applyDamage()` consume primero el escudo y luego la vida; genera un `fx.hit` salvo daño
silencioso (tormenta). Al llegar a 0, `killPlayer()` marca el puesto, suma la baja al asesino,
suelta los dos poderes y emite `fx.death`. Si queda un solo vivo, `finishMatch()` cierra la
partida.

`applySlow()` fija factor y caducidad; `shove()` mueve al objetivo por pasos con la misma
colisión (la masa del tuning reduce el empuje).

### 5.6 Tormenta

Seis fases en `STORM_PHASES`: espera, cierre y radio, con daño creciente de 3 a 24 por segundo.
La tormenta alterna `wait` y `shrink`; durante el cierre interpola centro y radio con *smoothstep*
y planifica el siguiente círculo sobre terreno pisable (`planNextStorm`). El que queda fuera
recibe daño continuo. La duración máxima de partida es de 420 s; si nadie gana, decide el que
tenga más bajas y vida.

### 5.7 Bots

`server/bots.js` es una IA de intención, no de reflejos: piensa cada 0,22–0,44 s y escribe en
`bot.input` igual que un humano.

- Modos: buscar botín, pelear, huir hacia el círculo seguro y vagar.
- Valoran cristales por rareza, huecos libres y cercanía; ignoran los que acaban de soltar.
- En combate mantienen una distancia preferida (~260 u), orbitan y apuntan con predicción.
- Eligen hechizo disponible por coste/recarga y, a veces, combinan.
- Detectan atascos comparando su posición y buscan un rodeo.

---

## 6. El mundo compartido

`shared/worldgen.js` es la pieza que hace posible la predicción: el cliente no recibe el mapa,
lo **recalcula** con la misma semilla.

### 6.1 Terreno

- Ruido de valor 2D con interpolación suave y `fbm` de varias octavas.
- `elevationAt()` combina una base, crestas y una máscara de montaña; hunde los bordes de la isla
  para que el mar la rodee.
- `moistureAt()` decide desierto, pradera o bosque.
- `heightAt()` convierte elevación en altura: bajo el nivel del mar baja linealmente (fondo
  marino), en tierra aplica escala y ondulaciones finas.
- `biomeAt()` / `terrainSample()` devuelven `water`, `beach`, `grass`, `forest`, `desert`,
  `highland`, `mountain` o `snow`.

Coordenadas: `x` y `z` en unidades del mundo; `y` es altura. El mundo mide 2400 × 2400 y se
centra en 0. La cámara orbita en XZ; el frente local del mago es **+Z** (`yaw = atan2(dx, dz)`).

### 6.2 Props y lugares

`generateProps()` reparte árboles, rocas, cactus y demás por celdas deterministas; cada prop
guarda posición, escala, rotación y radio de colisión. `generateLandmarks()` coloca seis lugares
(Arena Antigua, Torre Arcana, Aldea Olvidada, Ruinas del Sol, Volcán Dormido, Santuario Verde)
con un claro alrededor y props propios, y `createWorld()` elimina los props que caerían dentro
del claro.

`createWorld(seed)` devuelve a la vez datos y consultas:

```js
{
  seed, props, landmarks, waterSurface,
  heightAt(x, z), depthAt(x, z), isWater(x, z),
  sampleAt(x, z), biomeAt(x, z), isWalkable(x, z),
  canStand(x, z, r), canSwim(x, z, r), canWade(x, z, r),
  propBlocked(x, z, r), terrainBlocked(x, z)
}
```

`canStand` exige que el centro y cuatro muestras del radio estén por encima de la línea de costa
y fuera de props. `canSwim` exige agua suficiente en esas muestras. `canWade` cubre la franja de
arena mojada y agua baja que une ambas. Esa unión es la que permite entrar y salir nadando sin
huecos invisibles.

`findOpenSpot()` busca en espiral un punto pisable para un teletransporte de emergencia, soltar
un poder o recolocar la tormenta.

---

## 7. El cliente

### 7.1 Arranque y pantallas

`index.html` es un único documento con todas las capas: canvas del mundo, viñeta, flash de daño,
overlay de tormenta, HUD, pantallas (inicio, taller, colección, ajustes, sala, carga, resultados),
pausa, espera, cinemática de nado y estado de conexión. `ui.js` alterna `.hidden` entre ellas y
`style.css` las viste.

`src/main.js` crea una sola vez:

- `GameView` sobre el canvas (escena de partida).
- `WizardPreview` (canvas aparte para menús y taller).
- `Net`, `SoundEngine`, `HUD` y el panel de admin.

El bucle de `main.js` corre siempre con `requestAnimationFrame`; solo llama a `gameView.update()`
cuando hay partida activa. El `dt` se limita a 0,05 s. Además actualiza nombres flotantes,
espectador, mira, pasos, región del minimapa y FPS.

### 7.2 Red y flujo de una partida

1. El jugador pulsa **Entrar**: `joinGame()` conecta, envía `join` y muestra la sala.
2. `lobby` actualiza la sala; el anfitrión o la cuenta atrás inician.
3. `start` → `startMatch()`: pantalla de carga, `gameView.startMatch(msg)` construye mundo y
   magos de forma síncrona, y después se oculta la carga y aparece el HUD.
4. Cada 50 ms (`setInterval`) se envía `input` con movimiento, apuntado y sprint.
5. Cada `snap`: `applySnapshot`, HUD, efectos, audio, daño, muerte y tormenta.
6. `end`: se limpia la escena, se muestra el podio y la sala vuelve a estar disponible.

### 7.3 Predicción y reconciliación

El jugador local no espera al servidor. `GameView.update()`:

- Calcula el vector de entrada y el yaw hacia el punto de apuntado.
- Aplica velocidad, aceleración y colisión **con las mismas fórmulas y constantes** que el
  servidor.
- Mueve `selfPred` y el modelo; el resto de magos se interpola hacia `targetX/targetZ` con una
  constante de suavizado de 12/s.

Cuando llega una instantánea, `applySnapshot()` compara la posición del servidor con la predicha:

- más de 45 unidades → corrección dura (teletransporte, reaparición);
- entre 5 y 45 → corrección suave del 22 % por instantánea;
- menos de 5 → se deja la predicción.

El servidor nunca “obedece” al cliente: si la distancia recorrida no es posible, su posición
manda en la siguiente instantánea.

### 7.4 Apuntado y cámara

El ratón se convierte en un rayo de cámara; se corta contra un plano horizontal y se refina la
altura del terreno unas cuantas veces (`computeAim`). El resultado es un punto XZ dentro del
mundo que se envía como `ax/az`. En primera persona el rayo sale del centro de la pantalla.

La cámara:
- Tercera persona orbital: distancia (`zoom`), inclinación, FOV y suavizado configurables;
  retrocede si su posición cae dentro de un prop y se mantiene por encima del suelo o del agua.
- Primera persona (**V**): bloquea el puntero, el ojo se coloca a 2,9 × escala sobre los pies y
  el FOV se abre 12°. Al soltar el puntero se pausa.
- Agua: baja a ~23°, se acerca, enfoca la línea de flotación y eleva el ojo en primera persona
  para no mirar desde el fondo.
- Entrada al agua: cinemática de 3,8 s con cámara baja que orbita, salpicadura, anillos y barras
  con el rótulo **Nado**; **Espacio** la salta y una pausa la cancela. Después queda la cámara de
  agua y un anillo dorado en la superficie para no perder al mago.

### 7.5 HUD, audio y efectos

- `HUD` lee la última instantánea: vida, escudo, maná, aguante, poderes con recarga, combinación,
  tormenta, cronómetro, minimapa, killfeed, avisos y nombres flotantes proyectados desde la
  cámara.
- `SoundEngine` genera todo con osciladores y ruido: pads de menú/batalla, pasos, saltos, casteos
  por elemento, impactos, recogidas, muerte y un zumbido de tormenta cuya intensidad depende de
  la distancia al círculo.
- `main.js` filtra los `fx` por cercanía antes de sonar; el HUD y `EffectsView` los consumen
  siempre.

---

## 8. El render 3D

### 8.1 `GameView`

Es el dueño de la escena de partida: cámara, luces del mundo, estados de los jugadores, marcador
de apuntado, anillo propio, predicción, cinemáticas y llamada final a `renderer.render()`.

- Renderer: WebGL2 con antialias, `ACESFilmicToneMapping`, salida sRGB y `pixelRatio` según
  calidad (1 / 1,5 / 2).
- Calidad: afecta al tamaño del render y a los segmentos del terreno (96 / 140 / 190).
- Cada mago es un `createWizard(look)` independiente; los materiales y el esqueleto se clonan
  para poder teñirlos sin compartir estado.
- Estados interpolados: posición, yaw, salto, vida, poderes, muerte y `swimBlend`.

### 8.2 `WorldView`

Construye el escenario en el cliente a partir de la semilla y de los props que calcula
`createWorld`:

- **Terreno**: `PlaneGeometry` deformada; colores por bioma, humedad y pendiente; material
  Lambert plano.
- **Agua**: plano de 3600 × 3600 con shader de olas (dos senos), mezcla profundo/claro y espuma;
  `depthWrite: false` y transparencia. La altura visible es `WATER_SURFACE` (0,12).
- **Cielo**: esfera con degradado y luces hemisférica + direccional.
- **Props**: geometrías low-poly agrupadas y `InstancedMesh` por tipo; los landmarks tienen
  modelos propios (torre, chozas, volcán…).
- **Botín**: `PickupView` con cristales animados, brillo y colores por elemento/rareza.
- **Tormenta**: muro cilíndrico con shader animado, anillo actual y anillo del siguiente círculo.
- **Minimapa**: canvas 150 × 150 pintado píxel a píxel con bioma, altura y ruido; se entrega al
  HUD.

`update()` avanza olas, tormenta y botín; `dispose()` libera geometrías y materiales al terminar
la partida.

### 8.3 `EffectsView`

- Un único `Points` con pool de 760 partículas, reutilizadas; el límite y la intensidad se pueden
  bajar desde el panel.
- Anillos expansivos para impactos, salpicaduras y estelas; *sprites* de brillo.
- Proyectiles con malla, estela y luz propia según el hechizo.
- Zonas persistentes: muros, olas, tornados, meteoritos, tormentas… con geometría y shader
  propios, sincronizadas por vida restante.
- `processFx()` traduce eventos del servidor (`cast`, `boom`, `splash`, `hit`, `death`, `pickup`,
  `heal`, `combo`, `quake`…) a partículas y anillos.

### 8.4 `wizard.js`

Es el módulo más grande del cliente. Carga `public/models/mago.glb`, clona el esqueleto con
`SkeletonUtils`, tiñe los materiales y cuelga cosméticos de los huesos.

- **Materiales del GLB**: `Tunica`, `Piel`, `Pelo`, `Detalle`. Los tres primeros usan una copia
  neutra del atlas (luminancia) para que el color elegido mande; `Detalle` conserva el original.
- **Animación**: `AnimationMixer` con clips `idle`, `walk`, `run`, `start`, `stop`, `cast`, `hit`
  y `death`. Los cambios de clip se funden; `walk`/`run` comparten fase. Encima, gestos
  procedurales: respiración, balanceo de brazos/torso, mirada de la cabeza, mecido del bastón y
  pose de nado.
- **Gorro**: se genera por código (fieltro, cuero, cinta, forro, hebillas, pespuntes) y se cuelga
  del hueso `Head`. Hay diez siluetas: archimago, caminante, casco de cuero, capucha de cuero,
  capucha de paño, diadema rúnica, corona, casco vikingo, aro de laurel y sombrero de copa.
- **Bastón**: seis piezas (madera, cristal, fuego, hielo, raíces, oscuro) con asta, puño de cuero
  y engarce; la gema brilla con el color mágico. Se cuelga de `Hand_L`.
- **Puño cerrado**: como el rig solo tiene un hueso para los cuatro dedos, la mano abierta se
  oculta y se modela un puño aparte (`src/three/fist.js`) con dedos envolventes y pulgar. El
  bastón se coloca respecto a la muñeca, no a la orientación de la mano.
- **Nado**: el cuerpo se inclina ~66°, la mano libre bracea, las piernas patalean y el bastón se
  mantiene vertical usando el rumbo del grupo (no la inclinación del cuerpo).
- `applyAdmin()` permite cambiar tamaño, proporciones, colores, clips y depuración sin recargar.

### 8.5 `preview.js`

Un segundo renderer pequeño, con fondo transparente, plataforma y luz neutra, montado dentro del
panel de menús/taller. Reconstruye el mago cuando cambia el aspecto y gira lentamente; se puede
arrastrar con el ratón. Comparte `createWizard`, así que lo que se ve en el taller es exactamente
lo que se juega.

---

## 9. Personaje y personalización

El aspecto es un objeto plano que viaja al servidor y se guarda en `localStorage`:

```js
{
  robe: '#5b4bd6',
  hat: 'pointy',        // id de HATS
  hatColor: '#2b2440',
  staff: 'crystal',     // id de STAVES
  staffColor: '#8a5a2b',
  magic: '#63e6ff',
  skin: '#f2c7a0',
  hair: '#6b3f28'
}
```

`defaultLook()` y `randomLook()` viven en `shared/constants.js`. El servidor sanea el objeto
(`sanitizeLook`) y lo usa para que todos vean el mismo mago; no afecta a estadísticas.

El modelo se regenera con dos herramientas:

1. `tools/optimize-wizard.mjs`: suelda vértices, simplifica manteniendo silueta, comprime
   texturas y deduplica.
2. `tools/rig-wizard.mjs`: construye el esqueleto de 27 huesos, calcula pesos gaussianos,
   reparte regiones teñibles y hornea los ocho clips a 60 fps. Ajusta la altura del `Root` para
   que el pie de apoyo quede en el suelo.

`tools/audit-wizard.mjs` (`npm run rig:audit`) comprueba alineación, pesos, contacto de pies,
coherencia de bucles y desplazamiento implícito.

---

## 10. Interfaz

- `index.html` define toda la estructura; no hay framework de UI.
- `ui.js` gestiona pantallas, nombre, aspecto, sala, colección, ajustes y resultados. Expone un
  objeto `ui` con métodos usados por `main.js` y callbacks para los botones.
- `hud.js` es la capa de juego: barras, slots, minimapa, killfeed, avisos, nombres flotantes y
  banner de espectador. Se actualiza con cada instantánea.
- `style.css` concentra la estética (azul noche, oro, cristales, *glassmorphism*), los layouts
  responsive y las animaciones. La cinemática de nado añade barras de cine y un rótulo serif.
- El HUD se oculta al terminar y en los menús; al morir sigue visible con el aviso de espectador.
  La pausa detiene entrada y puntero, pero el servidor sigue simulando.

Accesibilidad y detalles: los botones son reales, los campos tienen etiquetas, el canvas tiene
`aria-label`, y las teclas de juego no actúan mientras se escribe en un input.

---

## 11. Consola del Archimago

Se abre con **Ñ** (reconfigurable; se guarda en `localStorage`). Es un panel de instrumentación
en vivo, no un editor de archivos.

- `src/admin/config.js` declara cada parámetro con tipo, valor por defecto, mínimo, máximo, paso,
  unidad y si se sincroniza con el servidor. Los grupos son Personaje, Animaciones, Magia, Cámara,
  Físicas, Apariencia, Debug y Presets.
- `panel.js` construye la interfaz, permite arrastrar/redimensionar, valida números, aplica
  colores al mago local, reproduce clips, pinta huesos/cápsulas/colisionadores, muestra FPS y
  dibuja llamadas y triángulos.
- Los valores se guardan en `localStorage` (`elementalRoyale.admin.live`), se pueden exportar e
  importar como JSON y guardar como presets.
- Los cambios de movimiento, salto, radio, daño, recargas, maná y teletransporte se envían al
  servidor como `adminTune`/`adminTeleport` **solo** si el servidor los acepta (desarrollo o
  `ADMIN_TOOLS=1`). En producción el panel avisa de que es “solo cliente”.
- La apariencia del panel se aplica al mago local; el servidor sigue usando el aspecto del taller
  para el resto de jugadores.

---

## 12. Audio

`src/audio.js` no usa archivos de sonido. Crea un `AudioContext` al primer gesto, un compresor,
dos buses (música y efectos) y un buffer de ruido compartido.

- Música: secuencias de notas con osciladores y un modo menú/batalla.
- Efectos: pasos, salto, casteos por elemento, impactos, recogida por rareza, curación, muerte,
  victoria/derrota y salpicadura al entrar al agua.
- Tormenta: ruido filtrado en bucle cuya ganancia sube según la distancia al círculo.
- El volumen y el silencio se guardan en los ajustes.

---

## 13. Persistencia

### Navegador (`localStorage`)

| Clave | Contenido |
| --- | --- |
| `elementalRoyale.name` | Nombre del mago. |
| `elementalRoyale.look` | Aspecto. |
| `elementalRoyale.settings` | Volumen, silencio y calidad. |
| `elementalRoyale.admin.live` | Últimos valores del panel. |
| `elementalRoyale.admin.key.v2` | Tecla del panel. |
| `elementalRoyale.admin.config` | Configuración guardada del panel. |
| `elementalRoyale.admin.profiles` | Presets propios. |

### Servidor (opcional, Archil)

`server/history.js` usa la SDK `disk` para guardar hasta 100 partidas en
`historial/partidas.json` dentro de un disco Archil. Solo se activa si existe
`ARCHIL_API_KEY`; si Archil falla, `recordMatchSafely` lo registra en consola y la partida
termina igual. `npm run history` consulta el histórico; `-- --json` lo vuelca entero.

---

## 14. Pruebas y diagnóstico

```bash
npm run build                  # compilación de producción
PORT=8081 npm start            # servidor de pruebas (en otra terminal)
npm run test:match             # movimiento, botín, maná, recargas, proyectiles y combo
npm run test:end               # partida completa, ganador y reinicio de sala
npm run rig:audit              # pesos, suelo, ciclos y clips del GLB
```

Las pruebas de `scripts/` hablan WebSocket como un cliente normal: entran, esperan `start`,
envían `input`/`cast` y comprueban las instantáneas. No necesitan navegador.

Para depurar en el navegador:

- `window.__elemental` expone `gameView`, `hud`, `ui`, `net`, `audio`, `preview`, `admin` y el
  estado de la partida. Es una consola de desarrollo, no una API pública.
- El panel (Ñ) muestra huesos, cápsulas, colisionadores, FPS y triángulos, y permite congelar,
  teletransportar y cambiar la cámara.
- `tools/rig-test.html` sirve para ver clips y esqueleto del GLB sin entrar a una partida.

---

## 15. Cómo ampliar el proyecto

| Quiero… | Dónde tocar |
| --- | --- |
| Añadir un elemento o hechizo | `shared/constants.js` (metadatos, coste, recarga), `server/game.js` (`castAbility`), `src/three/effects.js` (visual), HUD si necesita color/icono. |
| Cambiar daño, velocidad o salto | `src/admin/config.js` y los valores sincronizados del servidor; para el valor por defecto, `shared/constants.js`. |
| Añadir un sombrero | Nuevo `case` en `wizard.js`, su geometría/material, y el id en `HATS`. El taller y el guardado lo recogen solos. |
| Añadir un bastón | `STAVES` + `case` en la construcción del bastón + su gema/engarce. |
| Añadir un prop o lugar | `generateProps`/`generateLandmarks` en `shared/worldgen.js` y la geometría en `WorldView`. |
| Añadir una pantalla o panel | `index.html`, `src/style.css`, `src/ui.js` y los callbacks de `main.js`. |
| Añadir una cinemática | Cámara y disparador en `GameView`, overlay en `index.html` + CSS, y escucha del evento en `main.js`. |
| Añadir un mensaje de red | `handleMessage`/`broadcastSnapshot` en `server/game.js`, `net.on` y el envío en `main.js`. |

Regla de oro: **si afecta al movimiento, a las colisiones o a una constante que el cliente
predice, va en `shared/` y se usa en ambos lados**. Si es una regla de juego (daño, recargas,
botín), vive en el servidor y el cliente solo la representa.

---

## 16. Convenciones y trampas conocidas

- **Coordenadas**: XZ es el plano de juego; +Y es arriba. El frente del mago es +Z y el yaw se
  calcula con `atan2(dx, dz)`. La cámara mira hacia el punto de apuntado.
- **Colisiones 2D**: son círculos contra terreno y props; no hay geometría 3D de colisión. La
  altura de cápsula del panel es solo visual.
- **Salto**: es un arco vertical; no esquiva proyectiles, que se resuelven en el plano XZ.
- **Autoridad**: el cliente predice, pero nunca fija vida, daño, maná, recogidas ni posición
  final. Cualquier atajo debe pasar por el servidor.
- **Apariencia**: el aspecto del panel de admin es local; el servidor usa el del taller. No es
  una vía para cambiar el mago de los demás.
- **Persistencia**: la partida vive en memoria. Reiniciar el servidor borra la sala y la partida;
  solo el historial de Archil sobrevive.
- **Red**: no hay cuentas, autenticación ni HTTPS incluidos. Para internet hace falta un túnel o
  un hosting con WebSocket y TLS.
- **Rendimiento**: el terreno es la pieza más cara de generar; por eso se construye de forma
  síncrona al empezar y la calidad baja sus segmentos. Las partículas tienen pool y los props son
  instanciados.
- **Nado**: no hay tecla; se activa por profundidad. La cinemática tiene *cooldown* y se puede
  saltar con Espacio. La cámara de agua y el anillo de superficie existen para no perder al mago
  bajo el agua.

---

## 17. Glosario

| Término | Significado |
| --- | --- |
| **Tick** | Paso de simulación del servidor (30 por segundo). |
| **Instantánea / snapshot** | Estado resumido que el servidor envía 20 veces por segundo. |
| **Predicción** | El cliente simula su movimiento antes de recibir la instantánea. |
| **Reconciliación** | Corrección de la predicción con la posición autoritativa. |
| **Autoritativo** | Que la decisión final la toma el servidor. |
| **Prop** | Objeto decorativo con colisión (árbol, roca, casa…). |
| **Zona** | Hechizo persistente con área y tiempo (muro, ola, tornado…). |
| **GLB** | Formato binario de glTF con la malla, el esqueleto y los clips del mago. |
| **Rig** | Esqueleto y pesos que permiten animar la malla. |
| **Tuning** | Valores de ajuste que el panel puede cambiar en vivo. |
| **Archil** | Servicio de disco persistente usado para el historial de partidas. |

---

Si algo de este documento deja de coincidir con el código, manda el código: los módulos citados
son la fuente de verdad.
