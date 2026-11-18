# Despliegue público

Cómo publicar Elemental Royale en internet con **TLS** (`https` y `wss`) y una URL
que puedas compartir. El juego es un único proceso Node: sirve el cliente compilado y
atiende el WebSocket en `/ws`. No necesita base de datos (el historial de Archil es
opcional) y las salas viven en memoria del proceso.

## Qué hay ya en el repositorio

| Archivo | Para qué |
| --- | --- |
| `Dockerfile` | Compila `dist/` y deja una imagen de producción con solo dependencias de ejecución. |
| `.dockerignore` | Deja fuera `node_modules`, `dist`, `.env`, capturas y carpetas de trabajo. |
| `fly.toml` | Configuración lista para Fly.io: TLS, puerto 8080 y máquina siempre encendida. |
| `render.yaml` | Blueprint de Render: un clic y el servicio queda con Docker, salud y una instancia. |
| `/healthz` | Sonda que devuelve `{ ok, uptime, rooms, players }` para el host y para ti. |

El cliente no tiene URLs escritas a mano: usa `location.host` y cambia solo a `wss://`
cuando la página es `https://`. Por eso funciona igual en local, en LAN y en el host
público, y el botón **«Copiar enlace»** del lobby copia ya la URL real con el código
de sala.

## Requisitos

- El repositorio público en GitHub (`Berciano2004-git/elemental-royale`).
- Una cuenta en el host elegido y, en la mayoría, una tarjeta aunque el plan sea barato.
- **Una sola instancia**: las partidas y las salas están en memoria, así que no se puede
  repartir entre varias réplicas ni dejar que el host apague la máquina por inactividad.

## Opción A — Fly.io (recomendada)

Es la que encaja sin cambios: contenedor propio, WebSocket de larga duración, TLS con
dominio `*.fly.dev` y región en Madrid.

```bash
# 1. Instala la CLI (Windows PowerShell):
#    iwr https://fly.io/install.ps1 -useb | iex
fly auth login

# 2. Crea la app con la configuración del repositorio (no despliega aún).
#    Si `elemental-royale` está ocupado, cambia `app` en fly.toml.
fly launch --copy-config --no-deploy

# 3. Publica.
fly deploy

# 4. Comprueba que responde y abre el juego.
curl https://TU-APP.fly.dev/healthz
fly open
```

La URL pública será `https://TU-APP.fly.dev`. El WebSocket queda en
`wss://TU-APP.fly.dev/ws` sin configurar nada más.

## Opción B — Render (blueprint incluido)

El repositorio trae `render.yaml`, así que no hay que configurar nada a mano:

1. En el panel de Render: **New → Blueprint** y elige el repositorio
   `Berciano2004-git/elemental-royale`.
2. Render crea el servicio leyendo `render.yaml`: Docker, puerto 8080, salud en
   `/healthz`, **una sola instancia** y `NODE_ENV=production`.
3. **Apply** y espera al primer despliegue. La URL será del estilo
   `https://elemental-royale-xxxx.onrender.com`.

> El plan gratuito de Render **duerme** el servicio por inactividad y con él se pierden las
> salas. Para un enlace permanente, un plan siempre encendido; si no, sirve para probar.

## Opción C — Railway

Railway detecta el `Dockerfile` solo:

1. **New Project → Deploy from GitHub repo** y elige el repositorio.
2. En **Settings → Networking**, pulsa **Generate Domain** para tener la URL pública.
3. Comprueba que la variable `PORT` la aporta Railway (el servidor la lee y escucha en
   `0.0.0.0`).
4. Deja **una réplica** y sin *sleep* por inactividad. Salud: `/healthz`.

La URL la asigna el host y sirve igual: el cliente usa el mismo origen para la página y
para el WebSocket.

## Variables de entorno

| Variable | Valor | Nota |
| --- | --- | --- |
| `PORT` | `8080` | La fija el host; el servidor la lee. |
| `NODE_ENV` | `production` | Ya viene en el `Dockerfile` y en `fly.toml`. |
| `ADMIN_TOOLS` | **sin definir** | En producción la consola del Archimago no acepta cambios de servidor salvo que valga `1`. No la definas en público. |
| `RECONNECT_GRACE` | `40` (por defecto) | Segundos que un mago desconectado sigue en pie. |
| `ARCHIL_API_KEY` | opcional | Activa el historial persistente de partidas. Sin ella el juego funciona igual. |
| `ARCHIL_REGION`, `ARCHIL_DISK` | opcional | Solo con la clave anterior. |
| `MAX_CONNECTIONS_PER_IP` | `10` | Conexiones simultáneas desde una misma dirección. |
| `MAX_MESSAGES_PER_SECOND` | `40` | Ritmo por conexión; el cliente manda entrada a 20 Hz. |
| `MAX_MESSAGE_BURST` | `80` | Ráfaga tolerada antes de descartar mensajes. |
| `MAX_MESSAGE_STRIKES` | `200` | Descartes seguidos que cierran la conexión. |
| `MAX_ROOMS` | `32` | Salas simultáneas en el proceso. |
| `TRUST_PROXY` | activo en producción | Ponlo a `0` si expones el servidor sin proxy delante. |

Los secretos van en el panel del host (`fly secrets set ARCHIL_API_KEY=...`), nunca en el
repositorio ni en la imagen: `.dockerignore` excluye `.env` y `.env.local`.

## Comprobación después de publicar

1. `https://TU-APP.fly.dev/healthz` devuelve `ok: true` y el número de salas.
2. La página carga con candado y la consola del navegador no muestra
   *mixed content*: el WebSocket debe ser `wss://`.
3. Dos pestañas en `https://TU-APP.fly.dev/?sala=PRUEBA`: se ven en el lobby, una pulsa
   **«Jugar ya»** y ambas entran en la misma isla.
4. Verificación completa de la URL publicada, con un solo comando:

   ```bash
   npm run verify:public -- https://TU-APP.fly.dev
   ```

   Comprueba `/healthz`, que el HTML y su bundle lleguen bien, que el WebSocket sea
   `wss`, que dos magos entren en la misma sala, que la partida arranque desde el segundo,
   que un corte deje al mago en pie y que vuelva el mismo. Termina con «Comparte:
   …/?sala=XXXX» o con un `✗` que dice qué falló.

5. Prueba de protocolo detallada, la misma que en local:

   ```bash
   URL=wss://TU-APP.fly.dev/ws npm run test:rooms
   ```

   (El plazo real de reconexión es de 40 s; para una pasada corta, despliega con
   `RECONNECT_GRACE=3` y vuelve a subirlo).

## Túnel temporal desde tu PC (sin cuenta de host)

Para jugar hoy mismo, con HTTPS y WebSocket, sin dar de alta nada. **Dura mientras el proceso
siga vivo** y la URL cambia en cada arranque; no es un enlace permanente.

El script `scripts/tunel.ps1` lo hace todo: compila siempre (para no servir un `dist/` viejo a
quien entre por el túnel), arranca el servidor en modo producción, abre el túnel y espera a
que el enlace responda **por internet** antes de imprimir la URL con el código de sala.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\tunel.ps1 -Sala AMIGOS
```

Parámetros: `-Sala` (código de sala; se limpia a `A-Z0-9` y 6 caracteres), `-Puerto` (8093 por
defecto) y `-SoloProbar` (levanta, comprueba y cierra, sin quedarse esperando: sirve para
verificar el propio script). Si ya hay un servidor respondiendo en ese puerto, lo reutiliza en
vez de abrir otro. Al cerrar, para también el túnel y el servidor que arrancó; los logs quedan
en `tmp-tunnel/`. `-ExecutionPolicy Bypass` evita el bloqueo de scripts sin tocar la política
del sistema.

El **530** de los primeros segundos es propagación del nombre nuevo en Cloudflare, no un
fallo de red: en cuanto el nombre se enruta, la misma URL responde. El registro también puede
quejarse una o dos veces con `Unauthorized: Tunnel not found` antes de conectar, y lo hace
igual con `--protocol http2`: es el tiempo de alta, no QUIC bloqueado. Por eso el script
reintenta la sonda antes de darte el enlace.

A mano, si prefieres dos terminales, desde la carpeta del proyecto:

```powershell
npm run build
$env:PORT="8093"; node server/index.js --prod
```

En otra terminal, la misma carpeta:

```powershell
.\tmp-tunnel\cloudflared.exe tunnel --url http://127.0.0.1:8093
```

La segunda imprime `https://algo-algo-algo.trycloudflare.com`: ese es el enlace, y con código
de sala queda `https://…/?sala=CODIGO`. `cloudflared` no se versiona: el script lo descarga una
sola vez en `tmp-tunnel/` (ignorado por git) desde
`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe`.

Y se comprueba con el mismo verificador de siempre:

```bash
npm run verify:public -- https://algo-algo-algo.trycloudflare.com
```

El túnel se cae si cierras la terminal, si el PC entra en suspensión o si cambia la red. Al
volver a arrancarlo la URL es distinta, así que hay que repartir la nueva. Cloudflare no
garantiza disponibilidad en los túneles sin cuenta.

## Blindaje

Cada conexión lleva un cubo de fichas y cada dirección un cupo, así que un script no puede
hundir la partida de los demás:

| Tope | Valor por defecto | Qué ocurre al pasarse |
| --- | --- | --- |
| Conexiones por IP | 10 | Se avisa del motivo y se cierra el socket; la plaza se libera al cerrar. |
| Mensajes por conexión | 40/s, ráfaga de 80 | Los mensajes sobrantes se descartan; a los 200 descartes se cierra con aviso. |
| Salas | 32 | La sala nueva no se abre y el cliente recibe el motivo. |

Una partida normal gasta la mitad del cupo de mensajes (20 Hz de entrada, más casteos). Los
topes se prueban con un servidor de límites pequeños y una prueba que intenta pasarse:

```bash
PORT=8083 MAX_CONNECTIONS_PER_IP=3 MAX_ROOMS=2 MAX_MESSAGES_PER_SECOND=10 \
  MAX_MESSAGE_BURST=12 MAX_MESSAGE_STRIKES=80 node server/index.js --prod
URL=ws://localhost:8083/ws MAX_CONNECTIONS_PER_IP=3 MAX_ROOMS=2 \
  MAX_MESSAGES_PER_SECOND=10 MAX_MESSAGE_BURST=12 MAX_MESSAGE_STRIKES=80 npm run test:limits
```

Detrás del host, la IP real llega en `X-Forwarded-For`; por eso en producción se confía en
esa cabecera al contar conexiones. Si expones el servidor sin proxy, arranca con
`TRUST_PROXY=0` para que nadie pueda falsear la dirección.

## Límites y cuidados

- **Reiniciar el host termina las partidas** en curso: no hay estado persistente de
  partida. Un despliegue nuevo arranca salas limpias.
- Cada sala admite 10 magos humanos; los bots rellenan hasta 10.
- El plano gratuito de algunos hosts duerme el servicio por inactividad: con el juego
  abierto hay WebSocket, pero entre partidas el proceso puede dormirse y cortar salas.
  Para un enlace permanente, máquina siempre encendida.
- El tráfico de un battle royale con 10 magos es pequeño (instantáneas a 20 Hz), así que
  la máquina más pequeña del host suele bastar; revisa el precio actual del host antes
  de elegir el tamaño.
