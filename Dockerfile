# Imagen de producción de Elemental Royale: compila el cliente con Vite y deja
# solo lo necesario para servir el juego y su WebSocket en un único proceso.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# Solo dependencias de ejecución: el cliente ya está compilado.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
EXPOSE 8080
# El servidor escucha en 0.0.0.0 y el host termina el TLS (https/wss).
CMD ["node", "server/index.js", "--prod"]
