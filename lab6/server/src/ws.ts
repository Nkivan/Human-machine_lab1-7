import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { decodeClient, encodePong } from "@dogfight/shared/codec/binary";
import { binaryCodec, jsonCodec } from "@dogfight/shared/codec/codec";
import { MSG } from "@dogfight/shared/protocol/constants";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
  type Snapshot,
} from "@dogfight/shared/protocol/messages";
import { assertNever } from "@dogfight/shared/util";
import type { Server } from "node:http";
import type { ServerConfig } from "./config.ts";
import { createNetsim, parseNetsim } from "./netsim.ts";
import { serverMsg } from "./protocol.ts";
import { createTokenBucket } from "./ratelimit.ts";
import type { Player, Room, RoomManager, SendOptions } from "./rooms.ts";

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
} as const;

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
const toArrayBuffer = (buf: Buffer): ArrayBuffer => Uint8Array.from(buf).buffer; // a copy, typed as a plain ArrayBuffer

export interface WsDeps {
  readonly server: Server;
  readonly manager: RoomManager;
  readonly config: ServerConfig;
}

export function attachWebSocket({ server, manager, config }: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxPayload }); // oversize frame -> close 1009
  const missed = new WeakMap<WebSocket, number>(); // missed heartbeats per socket (no ad-hoc property on the socket)

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const n = missed.get(socket) ?? 0;
      if (n >= 2) {
        socket.terminate();
        continue;
      } // two pongs missed: dead peer
      missed.set(socket, n + 1);
      socket.ping();
    }
  }, config.heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (socket, req) => {
    missed.set(socket, 0);
    socket.on("pong", () => missed.set(socket, 0));

    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const id = randomUUID();
    let room: Room | null = null;
    let player: Player | null = null;
    const jsonBucket = createTokenBucket({ ratePerSec: config.msgPerSec, burst: config.msgBurst });
    const binBucket = createTokenBucket({ ratePerSec: config.binPerSec, burst: config.binBurst });
    // Latency injector (debug only): ws://host/ws?lat=100&jitter=30&drop=0.02, or the "netsim" message at runtime.
    const net = createNetsim(config.debugRoutes ? parseNetsim(params) : {});
    const useJsonSnapshots = config.snapshotCodec === "json" || (config.debugRoutes && params.get("codec") === "json");

    // Everything leaves through here (so the injector and the slow-client policy see all traffic).
    // Slow-client policy: bufferedAmount grows when the peer is not reading. Drop what is droppable, kick the hopeless.
    function transmit(data: string | ArrayBuffer, { critical = true, droppable = false }: SendOptions = {}): void {
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
    const send = (msg: ServerMessage, opts?: SendOptions): void => transmit(JSON.stringify(msg), opts);
    const sendSnapshot = (s: Snapshot): void => {
      const wire = useJsonSnapshots ? jsonCodec.encode(s) : binaryCodec.encode(s);
      transmit(wire, { critical: false, droppable: true });
    };

    const joinTimer = setTimeout(() => socket.close(CLOSE.JOIN_TIMEOUT, "join timeout"), config.joinTimeoutMs);

    function handleJoin(msg: Extract<ClientMessage, { type: "join" }>): void {
      if (room) return socket.close(CLOSE.ALREADY_JOINED, "already joined");
      const target = manager.get(msg.room);
      if (!target) {
        send(serverMsg.error("no_such_room", "no such room"));
        return socket.close(CLOSE.NO_ROOM, "no such room");
      }
      if (target.players.size >= target.max) {
        send(serverMsg.error("room_full", "room is full"));
        return socket.close(CLOSE.ROOM_FULL, "room full");
      }
      clearTimeout(joinTimer);
      room = target;
      player = { id, name: msg.name, send, sendSnapshot };
      target.join(player);
    }

    function handleBinary(data: Buffer): void {
      if (!room) return socket.close(CLOSE.NOT_JOINED, "join first");
      const res = decodeClient(toArrayBuffer(data));
      if (!res.ok) return socket.close(CLOSE.BAD_MESSAGE, res.error);
      const frame = res.value;
      switch (frame.type) {
        case "inputs":
          return room.match.receiveInputs(id, frame.inputs);
        case "ping":
          return transmit(encodePong(frame.t, room.match.tickNo), { critical: true, droppable: false });
        default:
          return assertNever(frame);
      }
    }

    function handleText(data: Buffer): void {
      let raw: unknown; // untrusted input is `unknown` until the schema has validated it
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return socket.close(CLOSE.BAD_JSON, "bad json");
      }
      const res = parseClientMessage(raw);
      if (!res.ok) return socket.close(CLOSE.BAD_MESSAGE, res.error);
      const msg = res.value;
      switch (msg.type) {
        case "join":
          return handleJoin(msg);
        case "chat":
          if (!room || !player) return socket.close(CLOSE.NOT_JOINED, "join first");
          return room.chat(player, msg.text);
        case "netsim":
          if (!room) return socket.close(CLOSE.NOT_JOINED, "join first");
          if (!config.debugRoutes) return send(serverMsg.error("disabled", "netsim needs DEBUG_ROUTES=1"));
          net.set({ latency: msg.latency, jitter: msg.jitter, drop: msg.drop });
          return send(serverMsg.netsim(net.settings));
        default:
          return assertNever(msg);
      }
    }

    socket.on("message", (raw, isBinary) => {
      // Rate limits apply on ARRIVAL; the injector then delays processing (and may drop inputs).
      if (!(isBinary ? binBucket : jsonBucket).take()) return socket.close(CLOSE.RATE, "rate limit");
      const data = toBuffer(raw);
      const droppable = isBinary && ((data[0] ?? 0) & 15) === MSG.INPUT;
      net.in(() => (isBinary ? handleBinary(data) : handleText(data)), { droppable });
    });

    socket.on("close", () => {
      clearTimeout(joinTimer);
      room?.leave(id);
    });
    socket.on("error", (err) => console.error("[ws] socket error:", err.message)); // always: an unhandled "error" kills the process
  });

  return wss;
}
