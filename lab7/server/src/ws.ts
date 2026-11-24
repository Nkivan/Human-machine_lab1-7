import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { decodeClient, encodePong, encodeSnapshot, withAck } from "@dogfight/shared/codec/binary";
import { jsonCodec } from "@dogfight/shared/codec/codec";
import { MSG } from "@dogfight/shared/protocol/constants";
import {
  parseClientMessage,
  type ClientMessage,
  type EntityRecord,
  type ServerMessage,
  type Snapshot,
} from "@dogfight/shared/protocol/messages";
import { assertNever } from "@dogfight/shared/util";
import type { Server } from "node:http";
import type { ServerConfig } from "./config.ts";
import { createHeartbeat } from "./heartbeat.ts";
import { createNetsim, parseNetsim } from "./netsim.ts";
import { serverMsg } from "./protocol.ts";
import { createTokenBucket } from "./ratelimit.ts";
import type { Player, Room, RoomManager, SendOptions } from "./rooms.ts";
import type { Traffic } from "./traffic.ts";

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
// A copy of exactly this frame's bytes (a Buffer may be a view into a larger pooled ArrayBuffer).
// Lab 6 used Uint8Array.from(buf), which copies byte by byte through the iterator protocol.
const toArrayBuffer = (buf: Buffer): ArrayBuffer => {
  const out = new ArrayBuffer(buf.length);
  new Uint8Array(out).set(buf);
  return out;
};

// ---- once per tick / per broadcast, not once per client (Lab 7, measured under load) ----
// Every player of a room receives the SAME `entities` array and the SAME broadcast message object, so the
// array/object identity is a perfect cache key; a WeakMap entry disappears with the tick's data.
const encodedSnapshots = new WeakMap<readonly EntityRecord[], ArrayBuffer>();
const serialized = new WeakMap<ServerMessage, string>();

function encodeShared(s: Snapshot): ArrayBuffer {
  let encoded = encodedSnapshots.get(s.entities);
  if (!encoded) {
    encoded = encodeSnapshot(s);
    encodedSnapshots.set(s.entities, encoded);
    return encoded; // the first client can have the original (its ack is already in it)
  }
  return withAck(encoded, s.ack);
}

function stringifyShared(msg: ServerMessage): string {
  let text = serialized.get(msg);
  if (text === undefined) {
    text = JSON.stringify(msg);
    serialized.set(msg, text);
  }
  return text;
}

export interface WsDeps {
  readonly server: Server;
  readonly manager: RoomManager;
  readonly config: ServerConfig;
  readonly traffic: Traffic;
}

export function attachWebSocket({ server, manager, config, traffic }: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxPayload }); // oversize frame -> close 1009
  const heartbeat = createHeartbeat(() => wss.clients, config.heartbeatMs); // heartbeat.ts: unit-tested with fake timers
  wss.on("close", () => heartbeat.stop());

  wss.on("connection", (socket, req) => {
    heartbeat.track(socket);

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
          traffic.bytesOut += typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
          traffic.framesOut++;
        },
        { droppable },
      );
    }
    const send = (msg: ServerMessage, opts?: SendOptions): void => transmit(stringifyShared(msg), opts);
    const sendSnapshot = (s: Snapshot): void => {
      const wire = useJsonSnapshots ? jsonCodec.encode(s) : encodeShared(s);
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
      if (target.humans >= target.max) {
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
      traffic.bytesIn += data.length;
      traffic.framesIn++;
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
