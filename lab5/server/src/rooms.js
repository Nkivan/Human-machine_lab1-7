import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { HttpError } from "./errors.js";
import { createMatchLog } from "./log/matchlog.js";
import { Match } from "./match.js";
import { serverMsg } from "./protocol.js";

// Room is an EventEmitter: join / leave / chat / empty. Listeners run synchronously, in registration order.
export class Room extends EventEmitter {
  constructor({ id, name, arena, max, persistent = false }) {
    super();
    this.id = id;
    this.name = name;
    this.arena = arena;
    this.max = max;
    this.persistent = persistent;
    this.players = new Map(); // playerId -> { id, name, send(msg, opts) }
  }

  get info() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      max: this.max,
      arena: this.arena,
    };
  }

  // Everything loggable goes through here; matchlog.js consumes the "event" stream.
  record(type, data = {}) {
    this.emit("event", { t: Date.now(), type, ...data });
  }

  join(player) {
    this.players.set(player.id, player);
    this.record("join", { name: player.name });
    player.send(serverMsg.system(`Welcome to ${this.name}`));
    this.broadcast(serverMsg.system(`${player.name} joined`), player.id);
    this.#sendRoster();
    this.emit("join", player);
  }

  leave(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.record("leave", { name: player.name });
    this.broadcast(serverMsg.system(`${player.name} left`));
    this.#sendRoster();
    this.emit("leave", player);
    if (this.players.size === 0) this.emit("empty", this);
  }

  chat(player, text) {
    this.record("chat", { name: player.name, text });
    this.broadcast(serverMsg.chat(player.name, text, Date.now()), null, { critical: false });
    this.emit("chat", player, text);
  }

  broadcast(msg, exceptId = null, opts) {
    for (const p of this.players.values()) if (p.id !== exceptId) p.send(msg, opts);
  }

  close() {
    this.record("closed");
  }

  #sendRoster() {
    this.broadcast(serverMsg.roster([...this.players.values()].map((p) => p.name)));
  }
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20) || "room";

export function normalizeArena(a = {}) {
  if (typeof a !== "object" || a === null) throw new HttpError(400, "arena must be an object");
  const asteroids = a.asteroids ?? 6;
  const pickupEvery = a.pickupEvery ?? 8;
  const seed = a.seed ?? Math.floor(Math.random() * 2 ** 31);
  const ok = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!ok(asteroids, 0, 30)) throw new HttpError(400, "arena.asteroids must be an integer 0..30");
  if (!ok(pickupEvery, 2, 60))
    throw new HttpError(400, "arena.pickupEvery must be an integer 2..60");
  if (!ok(seed, 0, 2 ** 31 - 1)) throw new HttpError(400, "arena.seed must be an integer");
  return { asteroids, pickupEvery, seed };
}

export class RoomManager {
  #rooms = new Map();
  #closing = new Set();
  #cfg;

  constructor({ maxRooms, maxPlayersPerRoom, logDir }) {
    this.#cfg = { maxRooms, maxPlayersPerRoom, logDir };
  }

  create({ id, name, arena, persistent = false }) {
    if (this.#rooms.size >= this.#cfg.maxRooms) throw new HttpError(409, "too many rooms");
    const roomId = id ?? `${slug(name)}-${randomBytes(2).toString("hex")}`;
    if (this.#rooms.has(roomId)) throw new HttpError(409, "room id already exists");
    const room = new Room({
      id: roomId,
      name,
      arena: normalizeArena(arena),
      max: this.#cfg.maxPlayersPerRoom,
      persistent,
    });
    room.on("error", (err) => console.error(`[room ${roomId}]`, err)); // an "error" event with no listener would crash the process
    const log = createMatchLog({ dir: this.#cfg.logDir, room });
    room.logFile = log.file;
    room.logDone = log.done;
    room.record("created", { name, arena: room.arena });
    room.match = new Match(room); // one authoritative simulation per room; ticks only while someone is inside
    room.on("join", (player) => room.match.addPlayer(player));
    room.on("leave", (player) => room.match.removePlayer(player.id));
    room.on("empty", () => {
      if (!room.persistent) this.delete(room.id);
    });
    this.#rooms.set(roomId, room);
    return room;
  }

  get(id) {
    return this.#rooms.get(id);
  }
  list() {
    return [...this.#rooms.values()].map((r) => r.info);
  }
  get size() {
    return this.#rooms.size;
  }
  matchStats() {
    return [...this.#rooms.values()].map((r) => r.match.info());
  }

  delete(id) {
    const room = this.#rooms.get(id);
    if (!room) return;
    this.#rooms.delete(id);
    room.match?.stop();
    room.close(); // emits "closed": the match log flushes and ends
    const p = room.logDone
      .catch((err) => console.error(`[room ${id}] match log failed`, err))
      .finally(() => this.#closing.delete(p));
    this.#closing.add(p);
  }

  async closeAll() {
    for (const id of [...this.#rooms.keys()]) this.delete(id);
    await Promise.allSettled([...this.#closing]);
  }
}
