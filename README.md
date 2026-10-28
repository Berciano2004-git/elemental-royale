# ✦ Elemental Royale

Battle royale 3D de magia elemental para navegador. Diez pequeños magos caen en una isla
procedimental, recogen cristales de poder en lugar de armas, combinan elementos y luchan por
ser el último mago en pie mientras una tormenta arcana cierra el círculo.

- Motor: **Three.js** (WebGL) con estética low-poly; el mago es un modelo con esqueleto y
  animaciones y el resto del arte se genera por código.
- Servidor autoritativo en **Node.js + WebSocket**: movimiento, hechizos, daño, botín,
  tormenta y bots se simulan en el servidor a 30 Hz y se envían instantáneas a 20 Hz.
- Multijugador en línea real (misma red o servidor propio) y bots que completan la partida.
- Interfaz íntegramente en español, sin dependencias de arte externas.

---

## ▶ Cómo jugar

Requisitos: **Node.js 20 o superior** y un navegador moderno con WebGL.

```bash
npm install
npm run dev
```

Abre **http://localhost:8080**. La consola mostrará también una URL de **red LAN**
(`http://192.168.x.x:8080`): compártela con otras personas en la misma red y aparecerán en tu
sala. Cuando la primera persona entra, la cuenta atrás de 15 segundos empieza; el anfitrión
puede pulsar **«Empezar ahora»**. Los magos IA rellenan los huecos hasta 10.

Para servir la versión compilada:

```bash
npm run build
npm start          # http://localhost:8080
```

> En Windows, si `npm start` no abre el puerto, comprueba que no haya otra instancia usando el
> 8080 o define otro puerto: `PORT=8090 npm run dev`.
> Para jugar fuera de la LAN, el servidor debe estar accesible (por ejemplo, con un túnel o un
> hosting de Node con WebSocket). El proyecto no incluye HTTPS ni autenticación de cuentas.

---

## 🎮 Controles

| Entrada | Acción |
| --- | --- |
| **W A S D** / flechas | Mover al mago |
| **Ratón** | Apuntar (la cámara sigue al mago) |
| **Clic izquierdo** | Hechizo principal del poder activo |
| **Clic derecho** | Hechizo secundario del poder activo |
| **1 / 2** | Cambiar de poder equipado |
| **3** | Combinación elemental (con dos elementos distintos) |
| **Espacio** | Saltar |
| **Shift** | Correr, consume aguante |
| **Rueda** | Acercar / alejar la cámara |
| **Tab** | Menú rápido / grimorio de poderes |
| **Esc** | Pausa y ajustes |

La recogida es automática: basta con caminar sobre un cristal. Si ya llevas dos poderes, el
nuevo sustituye al activo y el anterior cae al suelo para que puedas recuperarlo.

---

## 🔥 Poderes y combinaciones

Cada poder encontrado es uno de los cuatro elementos, con una **rareza** que multiplica su daño
(común, poco común, raro, épico y legendario; más rareza = más potencia, pero ninguna es
invencible). Cada elemento aporta dos hechizos y un pasivo al llevarlo equipado.

| Elemento | Clic izquierdo | Clic derecho | Pasivo |
| --- | --- | --- | --- |
| 🔥 Fuego | Disparo de lava (explosión + charco ardiente) | Muro de llamas que quema al cruzar | +12 % de daño elemental |
| 💧 Agua | Chorro de agua perforante | Tsunami que daña y empuja | Regeneras 1 de vida por segundo |
| 🌀 Viento | Ráfaga de viento que empuja | Tornado que atrae y desgarra | +10 % de velocidad |
| 🪨 Tierra | Invocar rocas (tres proyectiles) | Terremoto que daña y ralentiza | +30 de escudo al recogerlo |

**Combinaciones (tecla 3)** al llevar dos elementos distintos:

| Combinación | Efecto |
| --- | --- |
| Fuego + Tierra | **Meteorito** — impacto enorme y cráter ardiente |
| Agua + Viento | **Tormenta** — descargas eléctricas en una gran zona |
| Agua + Tierra | **Pantano de barro** — ralentiza mucho |
| Fuego + Viento | **Torbellino ígneo** — quemadura en remolino |
| Agua + Fuego | **Nube de vapor** — ciega y ralentiza |
| Tierra + Viento | **Tormenta de arena** — daño y ralentización amplios |

La **energía mágica** (barra azul) limita el ritmo de lanzamiento; el **aguante** (barra verde)
limita correr. Todos los hechizos tienen recarga visible en el HUD.

---

## 🗺️ El mundo

Cada partida genera una isla distinta a partir de una semilla:

- **Bosque verde** con robles, pinos, arbustos y mucha cobertura.
- **Costas y mar** con olas animadas, playas y palmeras.
- **Montañas** rocosas infranqueables, nieve en las cumbres y laderas de piedra.
- **Desierto** con dunas, cactus y ruinas.
- **Lugares especiales**: Arena Antigua, Torre Arcana, Aldea Olvidada, Ruinas del Sol,
  Volcán Dormido y Santuario Verde. Los poderes que aparecen a su alrededor son de mayor
  rareza (raro, épico o legendario).
- **Tormenta arcana** en seis fases: daño creciente, círculo actual en morado y siguiente
  círculo marcado en el minimapa.

---

## 🧙 Personalización

En el **Taller arcano** puedes cambiar en tiempo real:

- Seis sombreros: archimago, caminante, casco de cuero, capucha de cuero con vuelta de pelo,
  capucha de paño y diadema rúnica. Comparten fieltro, cuero curtido, cinta, hebilla y
  pespuntes; cambia la silueta, no el estilo, y todos envuelven el cráneo hasta la frente.
- Seis bastones: madera, cristal, fuego, hielo, raíces y oscuro.
- Doce colores de túnica, diez de sombrero y ocho de bastón, además de detalles mágicos,
  cabello y piel. La túnica tiñe la ropa del modelo, el pelo tiñe el cabello completo
  (flequillo, patillas y nuca) y la piel tiñe cara, cuello, orejas y manos. Las tres zonas
  usan un atlas neutro para que el color elegido se note de verdad.
- Nombre del mago y botón de apariencia aleatoria.

La apariencia y el nombre se guardan en `localStorage` y se aplican en las siguientes partidas.
Es puramente cosmética: no cambia estadísticas.

---

## 🛠️ Consola del Archimago (panel de administrador)

Pulsa **Ñ** durante el juego (o en los menús) para abrir el panel. La tecla se puede cambiar
con el botón de la cabecera; la elección se guarda en `localStorage`. Mientras escribes en un
campo de texto, la Ñ se escribe con normalidad y no abre ni cierra el panel. El panel se arrastra
desde la cabecera, se redimensiona desde la esquina inferior derecha y se minimiza con **–**.

| Pestaña | Qué controla de verdad |
| --- | --- |
| **Personaje** | Velocidad, carrera, aceleración/frenado, giro, lateral/atrás, control aéreo, salto (`altura`, `duración`, `gravedad` derivada, caída y techo), escala global y por ejes, cabeza, torso, brazos, piernas, bastón y gorro. |
| **Animaciones** | Velocidad global y por clip (idle/walk/run/cast), transiciones, balanceo de brazos, torso, cabeza, túnica (a través de caderas/columna) y accesorios; reproductor con selección de clip, pausa, reinicio, fotograma a fotograma y línea de tiempo. |
| **Magia** | Potencia, recarga, alcance, duración, tamaño y velocidad de proyectil, coste y regeneración de maná y densidad de partículas. Son valores autoritativos del servidor. |
| **Cámara** | Distancia, altura, inclinación, FOV, sensibilidad del encuadre, seguimiento, suavidad, límites y evitación de suelo/props. |
| **Físicas** | Gravedad derivada, fuerza de salto, masa (resistencia al empuje), fricción, radio y altura de cápsula, anclaje al suelo, físicas activas y visualización de colisiones. |
| **Apariencia** | Túnica, gorro, bastón, detalles (cinturón/botas comparten material), piel, pelo y magia; material del GLB, emisión, brillo mágico, visibilidad de gorro/bastón/sombra y variantes de paleta. |
| **Debug** | Esqueleto, ejes de huesos, orientación, cápsula y colisionadores de props, velocidad, coordenadas, estado de animación, FPS, llamadas de dibujo y triángulos; congelar movimiento, desactivar físicas/suelo, teletransportar y restablecer posición. |
| **Presets** | Normal, Lento y pesado, Rápido y ágil, Mago flotante y Modo pruebas; perfiles propios, guardar/cargar, exportar/importar JSON y restablecer todo. |

Cada fila tiene su botón **↺** para volver al valor original; el pie tiene **Guardar**,
**Cargar**, **Exportar**, **Importar** y **Restablecer todo**. Los valores se validan contra
los mínimos y máximos del esquema: al importar un JSON se recortan los números fuera de rango
y se descartan colores o selectores inválidos, avisando de cuántos se ignoraron.

**Servidor autoritativo.** En desarrollo (`npm run dev`) el servidor acepta `adminTune` y
`adminTeleport` para el mago que los envía, de modo que velocidad, salto, radio de colisión,
daño, recargas, maná y teletransporte no producen tirones. En producción esos mensajes se
ignoran salvo que se arranque con `ADMIN_TOOLS=1`; el panel muestra **«Solo cliente»** y avisa
de que el servidor puede corregir la predicción. La herramienta no modifica archivos del
proyecto ni el GLB: todo vive en memoria y, si se guarda, en `localStorage`.

**Límites reales del proyecto:** el rig no tiene huesos de tela independientes (la intensidad
de túnica actúa sobre caderas/columna/brazos); no existe carga de hechizos ni casteo mantenido;
la altura de cápsula solo se usa para la visualización porque el juego resuelve colisiones en
2D; la apariencia del panel se aplica al mago local (el servidor sigue usando el aspecto
guardado en el taller); y el salto no esquiva proyectiles, que se resuelven en el plano XZ.

---

## 🦴 Modelo, esqueleto y animaciones

El mago que se ve en el juego es `public/models/mago.glb`: una malla de ~41 000 triángulos
con 27 huesos, pesos de piel calculados y ocho animaciones. Se genera con dos herramientas
desde el modelo original:

```bash
# 1. Suelda, reduce la malla y recomprime las texturas (necesita assets-source/model.glb)
npm run rig:optimize
# 2. Crea esqueleto, pesos, regiones teñibles y clips → public/models/mago.glb
npm run rig
```

`assets-source/mago-optimizado.glb` es la copia de trabajo que consume el segundo paso; se
puede ejecutar solo `npm run rig` para regenerar el modelo final.

**Esqueleto** (`tools/rig-wizard.mjs`): `Root → Hips → Spine → Chest → Neck → Head`, brazos
(`Shoulder → UpperArm → Forearm → Hand → Fingers`) y piernas (`UpperLeg → LowerLeg → Foot →
Toe`). Los pesos se calculan con una caída gaussiana respecto al segmento de cada hueso, con
un separador lateral en las piernas para que una pierna no arrastre a la otra al dar zancadas.
El hueso `Fingers` de cada mano recibe los vértices que pasan de la muñeca y cierra el puño
alrededor del bastón; sin él las manos quedaban siempre abiertas.

**Animaciones**: `idle` (respiración, reparto de peso y sigilo con la mano libre), `walk`
(marcha de 1,4 s con el bastón estable y la mano libre tejiendo), `run` (carrera inclinada con
vuelo), `start`/`stop` (entrada y frenada que empalman con el contacto del ciclo), `cast`
(el torso se enrosca, el bastón sube como foco y la palma empuja dando un paso), `hit` y
`death`. Se escriben como poses por hueso, se interpolan con Hermite y se hornean a 60 fps,
sin capturas externas. Todos los armónicos del `idle` cierran en una vuelta entera para que
el bucle no tenga saltos en la costura.

El horneado mide la planta de las botas en cada fotograma y ajusta `Root` en vertical para
que el pie de apoyo quede sobre el suelo: evita hundimientos y deja que la altura de la
cadera la dicte la pierna que carga. En `death` el ajuste se hace sobre todo el cuerpo.
`npm run rig:audit` comprueba alineación del GLB, pesos, contacto de pies, coherencia de
ciclos y desplazamiento implícito de cada clip.

**Teñido**: la malla se divide en cuatro primitivas —`Tunica`, `Piel`, `Pelo` y `Detalle`—
para que el taller pueda recolorear la ropa, la piel y el pelo sin tocar el pantalón ni las
botas. La tela se separa por el color pintado en el atlas (crema para la túnica, marrón para
el pantalón y las botas), no por altura: el corte anterior partía el pantalón por la cadera
y teñía su mitad superior. Las manos se detectan por componente (la palma queda dominada por
el antebrazo) y se asignan a `Piel`, no a la túnica. En la cabeza el reparto piel/pelo lo decide el color
pintado en el atlas —melocotón para piel, castaño y brillos fríos para pelo— votado en las
esquinas de cada triángulo, con una caja de protección para ojos, nariz y boca. Así el
flequillo y las patillas cambian con el pelo y el cuello se queda en piel. `Tunica`, `Piel`
y `Pelo` comparten una copia neutra del atlas: conserva el detalle y comprime el sombreado
horneado para que el color elegido mande; `Detalle` mantiene el atlas original. En el
cliente cada mago clona materiales y geometría de esqueleto con `SkeletonUtils.clone`.

**En el juego** (`src/three/wizard.js`): el gorro se cuelga del hueso `Head` y el bastón del
hueso `Hand_L`. La empuñadura se calcula una sola vez respecto a la pose de reposo, de modo
que el bastón se mueve con la muñeca (agarre real) con un dejarse mecer mínimo. Un
`AnimationMixer` hace fundidos entre clips según el estado (parado, andando, corriendo,
lanzando, recibiendo daño o muerto) y el paso de `walk` a `run` conserva la fase para que el
pie que apoya no salte de sitio.

Los **gorros** se generan con la misma familia de materiales: fieltro teñible con trama y
desgaste procedurales, cuero curtido con grano, cinta oscura, forro de tela, latón
envejecido, pelo y pespuntes. El borde apoya en la frente y la copa sube 0,35 para cubrir
la coronilla. Cada pieza se modela por revolución o por anillos y se retoca con pliegues
(`addFolds`) y hundimientos (`dentGeometry`); un sombreado horneado en los vértices oscurece
el interior de las alas y los dobladillos. Las piezas se fusionan por material
(`mergeGeometries`), así que un sombrero con ala, copa, cinta, hebilla y costuras sigue
siendo un puñado de mallas.

---

## 🧠 Arquitectura

```
index.html               estructura de menús y HUD
src/style.css            estilos
src/main.js              unión de red, entrada, partida y bucle de render
src/ui.js                pantallas, personalización, sala, colección y ajustes
src/hud.js               barras, poderes, minimapa, avisos y nombres flotantes
src/net.js               cliente WebSocket
src/audio.js             música y efectos procedurales (WebAudio)
src/preview.js           escaparate 3D del mago en los menús
src/admin/config.js      esquema, límites, perfiles y validación del panel
src/admin/panel.js       interfaz, pestañas, presets e import/export
src/admin/admin.css      estética del panel y overlay de depuración
src/three/wizard.js      mago animado (GLB) y cosméticos colgados de los huesos
src/three/world.js       terreno, agua, vegetación, botín y tormenta
src/three/effects.js     partículas, proyectiles y zonas de hechizo
src/three/gameview.js    cámara, predicción, instancias y render de partida
server/index.js          HTTP + Vite (desarrollo) o dist/ (producción) + WebSocket
server/game.js           sala, partida autoritativa, hechizos, tormenta y protocolo
server/bots.js           IA de los magos controlados por el servidor
server/history.js        historial de partidas en un disco Archil (persistente)
scripts/archil-history.mjs  CLI para consultar ese historial (`npm run history`)
shared/constants.js      elementos, combinaciones, rarezas y cosméticos
shared/worldgen.js       generación determinista del mapa (cliente y servidor)
shared/movement.js       colisión y movimiento compartidos
tools/optimize-wizard.mjs  reduce y recomprime el modelo original
tools/rig-wizard.mjs       esqueleto, pesos, regiones y animaciones del mago
tools/audit-wizard.mjs     diagnóstico del GLB (pesos, suelo, ciclos y velocidad)
assets-source/             modelo intermedio del mago (fuera de dist/)
```

La generación del mundo y las colisiones viven en `shared/`, por lo que cliente y servidor
calculan exactamente el mismo terreno. El cliente predice su propio movimiento y se reconcilia
con las instantáneas del servidor; el servidor valida distancias, recargas, maná, daño y
recogidas. Los bots se identifican como IA en la lista de jugadores.

### Protocolo (resumen)

- Cliente → servidor: `join`, `look`, `start`, `input`, `select`, `jump`, `cast`, `combo`,
  `adminTune` y `adminTeleport` (los dos últimos solo si el servidor habilita la consola).
- Servidor → cliente: `welcome` (incluye `admin`), `lobby`, `start`, `snap`, `end`, `error`,
  `admin` (confirmación de tuning) y `adminTeleport` (resultado del salto).
- Las instantáneas incluyen jugadores, proyectiles, zonas persistentes, tormenta, altura de
  salto (`j`) y eventos visuales. El servidor no envía apariencias en cada tick: solo al
  empezar la partida.

---

## ✅ Pruebas

Con un servidor de pruebas en el puerto 8081:

```bash
PORT=8081 node server/index.js --prod
npm run test:match     # conexión, inicio, movimiento, botín, hechizo y combinación
npm run test:end       # partida completa hasta el ganador y reinicio de sala (varios minutos)
```

`test:match` comprueba el movimiento autoritativo, la recogida de poderes, el gasto de maná,
la recarga, la creación de proyectiles y que una combinación genere su zona. `test:end` observa
una partida con bots hasta el final y verifica que la sala vuelve a estar disponible.

El modelo se regenera con `npm run rig`; `npm run rig:audit` imprime el diagnóstico del
esqueleto, los pesos y los clips. También se puede inspeccionar en
`http://localhost:8080/tools/rig-test.html` (poses de los clips y esqueleto; pulsa **S** para
ver u ocultar los huesos y añade `?tint` a la URL para colorear las regiones).

La compilación de producción se valida con `npm run build`.

---

## 🏆 Historial persistente (Archil)

Cada partida terminada se guarda en un **disco Archil** mediante la SDK de
TypeScript (`disk`), así que el historial sobrevive a los reinicios del servidor y a
cambiar de máquina. La integración vive en `server/history.js` y el servidor solo la
usa si hay clave configurada: sin ella el juego arranca y se juega exactamente igual.

Requisito: **Node.js 22.19 o superior** para la SDK (el resto del juego funciona con 20).

```bash
cp .env.example .env          # y pega tu clave en ARCHIL_API_KEY
npm run history               # últimas partidas guardadas en el disco
npm run history -- --json     # volcado completo en JSON
```

Variables (todas se leen de `.env` o del entorno): `ARCHIL_API_KEY` (obligatoria para
el historial), `ARCHIL_REGION` (`aws-us-east-1` por defecto) y `ARCHIL_DISK` (nombre
del disco, `elemental-royale` por defecto; se crea la primera vez).

`server/history.js` resuelve el disco por nombre con `listDisks` y lo crea si no
existe, y guarda hasta 100 partidas en `historial/partidas.json` dentro del disco con
`putObject`/`getObject`. Cada entrada registra semilla, magos, humanos, duración,
ganador, bajas y el podio. Al terminar una partida el servidor llama a
`recordMatchSafely`, que nunca interrumpe el final aunque Archil no responda.

---

## 🔧 Ajustes y rendimiento

- Menú **Ajustes**: volumen, silencio y calidad gráfica. La calidad ajusta la resolución de
  render y la densidad de la malla del terreno; el terreno nuevo se genera al empezar la
  siguiente partida.
- Los objetos del mundo usan `InstancedMesh`; las partículas viven en un único `Points` con
  pool reutilizado y límite de 760.
- El servidor limita el tamaño de los mensajes, valida entradas y aplica la regla de
  «sin entrada durante 0,7 s → el mago se detiene» para evitar clientes congelados que sigan
  corriendo.

## 📄 Recursos

El mago (malla y texturas) parte del modelo aportado por el proyecto y vive en
`public/models/mago.glb`; su modelo intermedio está en `assets-source/`. El resto del arte
—terreno, vegetación, agua, cielo, partículas, música y efectos— se genera por código con
Three.js, Canvas y WebAudio.
