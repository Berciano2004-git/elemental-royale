// Cliente WebSocket del juego.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.closeHandlers = [];
    this.connected = false;
    this.manualClose = false;
  }

  on(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  onClose(handler) {
    this.closeHandlers.push(handler);
    return this;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    this.manualClose = false;
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket;
      try {
        socket = new WebSocket(`${protocol}//${location.host}/ws`);
      } catch (error) {
        reject(error);
        return;
      }
      this.ws = socket;
      const timeout = setTimeout(() => {
        if (!this.connected) {
          try {
            socket.close();
          } catch {
            /* ignorar */
          }
          reject(new Error('Tiempo de conexión agotado'));
        }
      }, 8000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      };
      socket.onerror = () => {
        if (!this.connected) {
          clearTimeout(timeout);
          reject(new Error('No se pudo conectar al servidor'));
        }
      };
      socket.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const handler = this.handlers.get(msg.t);
        if (handler) handler(msg);
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        for (const handler of this.closeHandlers) handler(this.manualClose, wasConnected);
      };
    });
  }

  send(type, data = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ t: type, ...data }));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.manualClose = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignorar */
      }
      this.ws = null;
    }
    this.connected = false;
  }
}
