// WebSocket wrapper: dispatch by message type, send queue while connecting, reconnect with backoff + jitter.
export function createConnection({ url, onOpen = () => {}, onStatus = () => {}, maxQueue = 50 }) {
  const handlers = new Map();
  const queue = [];
  let ws = null;
  let attempt = 0;
  let timer = 0;
  let closedByUser = false;

  const emit = (type, msg) => {
    for (const fn of handlers.get(type) ?? []) fn(msg);
  };

  function open() {
    onStatus("connecting");
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      attempt = 0;
      onStatus("connected");
      onOpen(); // e.g. (re)send "join" FIRST, before any queued messages
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    });
    ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      } // never trust the wire
      emit(msg.type, msg);
    });
    ws.addEventListener("close", (e) => {
      if (closedByUser) return onStatus("closed");
      if (e.code >= 4000 && e.code < 5000) return onStatus(`rejected: ${e.reason || e.code}`); // the server said no: do not retry
      onStatus("reconnecting...");
      const wait = Math.min(10_000, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2); // exponential backoff + jitter
      timer = setTimeout(open, wait);
    });
  }
  open();

  return {
    on(type, fn) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else if (queue.length < maxQueue) queue.push(msg);
    },
    close() {
      closedByUser = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
