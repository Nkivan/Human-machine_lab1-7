import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { decodeClient, encodePong } from "@dogfight/shared/codec/binary";
import { MSG } from "@dogfight/shared/protocol/constants";
import { createNetsim, parseNetsim } from "./netsim.js";
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

const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

export function attachWebSocket({ server, manager, config }) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxPayload }); // oversize frame -> close 1009

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.missed >= 2) {
        socket.terminate();
        continue;
      } // two pongs missed: dead peer
      socket.missed++;
      socket.ping();
    }
  }, config.heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (socket, req) => {
    socket.missed = 0;
    socket.on("pong", () => {
      socket.missed = 0;
    });

    const state = { id: randomUUID(), room: null, player: null };
    const jsonBucket = createTokenBucket({ ratePerSec: config.msgPerSec, burst: config.msgBurst });
    const binBucket = createTokenBucket({ ratePerSec: config.binPerSec, burst: config.binBurst });
    // Latency injector (debug only): ws://host/ws?lat=100&jitter=30&drop=0.02, or the "netsim" message at runtime.
    const net = createNetsim(
      config.debugRoutes ? parseNetsim(new URL(req.url, "http://localhost").searchParams) : {},
    );

    // Everything leaves through here (so the injector and the slow-client policy see all traffic).
    // Slow-client policy: bufferedAmount grows when the peer is not reading. Drop what is droppable, kick the hopeless.
    function transmit(data, { critical = true, droppable = false } = {}) {
      net.out(
        () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (socket.bufferedAmount > config.bufferLimit) {
            if (!critical) return;
            if (socket.bufferedAmount > config.bufferLimit * 4) {
              socket.close(1013, "too slow");
              return;
            }
          }
          socket.send(data);
        },
        { droppable },
      );
    }
    const send = (msg, opts) => transmit(JSON.stringify(msg), opts);
    const sendBinary = (buf, { critical = false, droppable = true } = {}) =>
      transmit(buf, { critical, droppable });

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
      state.player = { id: state.id, name: msg.name, send, sendBinary };
      room.join(state.player);
    }

    function handleBinary(data) {
      if (!state.room) return socket.close(CLOSE.NOT_JOINED, "join first");
      const res = decodeClient(toArrayBuffer(data));
      if (!res.ok) return socket.close(CLOSE.BAD_MESSAGE, res.reason);
      if (res.type === "inputs") state.room.match.receiveInputs(state.id, res.inputs);
      else if (res.type === "ping")
        sendBinary(encodePong(res.t, state.room.match.tickNo), {
          critical: true,
          droppable: false,
        });
    }

    function handleText(data) {
      let raw;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return socket.close(CLOSE.BAD_JSON, "bad json");
      }
      const res = validate(raw);
      if (!res.ok) return socket.close(CLOSE.BAD_MESSAGE, res.reason);
      const msg = res.msg;
      if (msg.type === "join") return handleJoin(msg);
      if (!state.room) return socket.close(CLOSE.NOT_JOINED, "join first");
      if (msg.type === "chat") return state.room.chat(state.player, msg.text);
      if (msg.type === "netsim") {
        if (!config.debugRoutes)
          return send(serverMsg.error("disabled", "netsim needs DEBUG_ROUTES=1"));
        net.set({ latency: msg.latency, jitter: msg.jitter, drop: msg.drop });
        send(serverMsg.netsim(net.settings));
      }
    }

    socket.on("message", (data, isBinary) => {
      // Rate limits apply on ARRIVAL; the injector then delays processing (and may drop inputs).
      if (!(isBinary ? binBucket : jsonBucket).take())
        return socket.close(CLOSE.RATE, "rate limit");
      const droppable = isBinary && data[0] === MSG.INPUT;
      net.in(() => (isBinary ? handleBinary(data) : handleText(data)), { droppable });
    });

    socket.on("close", () => {
      clearTimeout(joinTimer);
      state.room?.leave(state.id);
    });
    socket.on("error", (err) => console.error("[ws] socket error:", err.message)); // always: an unhandled "error" kills the process
  });

  return wss;
}
