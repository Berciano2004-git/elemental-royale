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

## Opción B — Render, Railway o Koyeb

Los tres aceptan el mismo `Dockerfile`:

1. **New → Web Service** desde el repositorio de GitHub.
2. Entorno **Docker** (no hay que definir *build command* ni *start command*).
3. Puerto interno **8080** (`PORT` lo inyecta el host; el servidor ya lo respeta).
4. **Una instancia** y *auto-sleep / scale to zero* **desactivados**.
5. Salud: ruta `/healthz`.

La URL la asigna el host (`https://algo.onrender.com`, etc.) y sirve igual: el cliente
usa el mismo origen para la página y para el WebSocket.

## Variables de entorno

| Variable | Valor | Nota |
| --- | --- | --- |
| `PORT` | `8080` | La fija el host; el servidor la lee. |
| `NODE_ENV` | `production` | Ya viene en el `Dockerfile` y en `fly.toml`. |
| `ADMIN_TOOLS` | **sin definir** | En producción la consola del Archimago no acepta cambios de servidor salvo que valga `1`. No la definas en público. |
| `RECONNECT_GRACE` | `40` (por defecto) | Segundos que un mago desconectado sigue en pie. |
| `ARCHIL_API_KEY` | opcional | Activa el historial persistente de partidas. Sin ella el juego funciona igual. |
| `ARCHIL_REGION`, `ARCHIL_DISK` | opcional | Solo con la clave anterior. |

Los secretos van en el panel del host (`fly secrets set ARCHIL_API_KEY=...`), nunca en el
repositorio ni en la imagen: `.dockerignore` excluye `.env` y `.env.local`.

## Comprobación después de publicar

1. `https://TU-APP.fly.dev/healthz` devuelve `ok: true` y el número de salas.
2. La página carga con candado y la consola del navegador no muestra
   *mixed content*: el WebSocket debe ser `wss://`.
3. Dos pestañas en `https://TU-APP.fly.dev/?sala=PRUEBA`: se ven en el lobby, una pulsa
   **«Jugar ya»** y ambas entran en la misma isla.
4. Prueba de protocolo contra el host, con el mismo script que en local:

   ```bash
   URL=wss://TU-APP.fly.dev/ws npm run test:rooms
   ```

   Comprueba salas separadas, arranque desde el segundo mago, corte de red y vuelta del
   mismo mago (el plazo real es de 40 s; para una pasada corta, despliega con
   `RECONNECT_GRACE=3` y vuelve a subirlo).

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
