import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { serverMsg, validate } from "./protocol.js";
import { createTokenBucket } from "./ratelimit.js";

// Close codes (4000+ are application-defined; the client does not retry them).
const CLOSE = {
  JOIN_TIMEOUT: 4001,
  BAD_JSON: 4002,
  BAD_MESSAGE: 4003,
  NOT_JOINED: 4004,
  ALREADY_JOINED: 4005,
  NO_ROOM: 4006,
  ROOM_FULL: 4007,
  RATE: 4008,
};

export function attachWebSocket({ server, manager, config }) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxPayload }); // oversize frame -> close 1009

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.missed >= 2) {
        socket.terminate();
        continue;
      } // two pongs missed: dead peer (NAT, sleeping laptop)
      socket.missed++;
      socket.ping();
    }
  }, config.heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (socket) => {
    socket.missed = 0;
    socket.on("pong", () => {
      socket.missed = 0;
    });

    const state = { id: randomUUID(), room: null, player: null };
    const bucket = createTokenBucket({ ratePerSec: config.msgPerSec, burst: config.msgBurst });

    // Slow-client policy: if the peer is not reading, bufferedAmount grows. Drop non-critical messages, kick hopeless clients.
    function send(msg, { critical = true } = {}) {
      if (socket.readyState !== WebSocket.OPEN) return false;
      if (socket.bufferedAmount > config.bufferLimit) {
        if (!critical) return false;
        if (socket.bufferedAmount > config.bufferLimit * 4) {
          socket.close(1013, "too slow");
          return false;
        }
      }
      socket.send(JSON.stringify(msg));
      return true;
    }

    const joinTimer = setTimeout(
      () => socket.close(CLOSE.JOIN_TIMEOUT, "join timeout"),
      config.joinTimeoutMs,
    );

    function handleJoin(msg) {
      if (state.room) return socket.close(CLOSE.ALREADY_JOINED, "already joined");
      const room = manager.get(msg.room);
      if (!room) {
        send(serverMsg.error("no_such_room", "no such room"));
        return socket.close(CLOSE.NO_ROOM, "no such room");
      }
      if (room.players.size >= room.max) {
        send(serverMsg.error("room_full", "room is full"));
        return socket.close(CLOSE.ROOM_FULL, "room full");
      }
      clearTimeout(joinTimer);
      state.room = room;
      state.player = { id: state.id, name: msg.name, send };
      room.join(state.player);
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) return socket.close(1003, "text only");
      if (!bucket.take()) return socket.close(CLOSE.RATE, "rate limit");
      let raw;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return socket.close(CLOSE.BAD_JSON, "bad json");
      }
      const res = validate(raw);
      if (!res.ok) return socket.close(CLOSE.BAD_MESSAGE, res.reason); // close reasons are limited to 123 bytes: ours are short
      if (res.msg.type === "join") return handleJoin(res.msg);
      if (!state.room) return socket.close(CLOSE.NOT_JOINED, "join first");
      if (res.msg.type === "chat") state.room.chat(state.player, res.msg.text);
    });

    socket.on("close", () => {
      clearTimeout(joinTimer);
      state.room?.leave(state.id);
    });
    socket.on("error", (err) => console.error("[ws] socket error:", err.message)); // always: an unhandled "error" kills the process
  });

  return wss;
}
