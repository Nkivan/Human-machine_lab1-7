import { encodeSnapshot } from "@dogfight/shared/codec/binary";
import { snapshotWorld } from "@dogfight/shared/codec/snapshot";
import { STEP, TICK_MS, TICK_RATE } from "@dogfight/shared/protocol/constants";
import { Ship } from "@dogfight/shared/sim/ship";
import { World } from "@dogfight/shared/sim/world";
import { serverMsg } from "./protocol.js";

const MAX_INPUTS_PER_TICK = 4; // a client cannot "speed-hack" by sending 100 inputs at once
const MAX_QUEUE = 30;
const SCORE_EVERY_TICKS = TICK_RATE;

// Rolling tick statistics: how long a tick takes and how steady the cadence is (this is what /api/stats serves).
export function createTickStats(window = 300) {
  const durations = [],
    gaps = [];
  let lastStart = 0,
    overruns = 0,
    ticks = 0;
  const push = (arr, x) => {
    arr.push(x);
    if (arr.length > window) arr.shift();
  };
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    record(start, duration) {
      ticks++;
      push(durations, duration);
      if (lastStart) push(gaps, start - lastStart);
      lastStart = start;
      if (duration > TICK_MS) overruns++; // CPU-bound: the tick took longer than its budget (the Lab 7 problem)
    },
    reset() {
      lastStart = 0;
    },
    snapshot() {
      const m = mean(gaps);
      return {
        ticks,
        overruns,
        avgMs: +mean(durations).toFixed(3),
        maxMs: +Math.max(0, ...durations).toFixed(3),
        intervalMs: +m.toFixed(3),
        jitterMs: +Math.sqrt(mean(gaps.map((g) => (g - m) ** 2))).toFixed(3), // std-dev of the tick interval
      };
    },
  };
}

// One authoritative simulation per room: applies inputs, steps the shared world, broadcasts snapshots.
export class Match {
  #timer = 0;
  #next = 0;
  #running = false;

  constructor(room) {
    this.room = room;
    this.world = new World(room.arena.seed, {
      asteroids: room.arena.asteroids,
      pickupEvery: room.arena.pickupEvery,
    });
    this.players = new Map(); // playerId -> { player, ship, queue, lastQueued, lastSeq, dropped }
    this.tickNo = 0;
    this.stats = createTickStats();
    this.pendingEvents = [];
    for (const kind of ["fired", "hit", "exploded", "score", "pickup"]) {
      this.world.addEventListener(kind, (e) => this.pendingEvents.push({ k: kind, ...e.detail }));
    }
  }

  get running() {
    return this.#running;
  }

  addPlayer(player) {
    const { x, y } = this.world.safeSpot();
    const ship = this.world.spawn(new Ship({ x, y }));
    ship.invuln = 2;
    this.players.set(player.id, { player, ship, queue: [], lastQueued: 0, lastSeq: 0, dropped: 0 });
    player.send(
      serverMsg.welcome({
        you: ship.id & 0xffff,
        tick: this.tickNo,
        tickRate: TICK_RATE,
        seed: this.room.arena.seed,
      }),
    );
    this.start();
  }

  removePlayer(id) {
    const st = this.players.get(id);
    if (!st) return;
    this.world.removeShip(st.ship);
    this.players.delete(id);
    if (this.players.size === 0) this.stop();
  }

  // Inputs arrive redundantly (each packet repeats the last few): keep only the ones we have not seen.
  receiveInputs(id, inputs) {
    const st = this.players.get(id);
    if (!st) return;
    for (const input of inputs) {
      if (input.seq <= st.lastQueued) continue;
      if (st.queue.length >= MAX_QUEUE) {
        st.dropped++;
        continue;
      }
      st.queue.push(input);
      st.lastQueued = input.seq;
    }
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.stats.reset();
    this.#next = performance.now() + TICK_MS;
    this.#schedule();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#timer);
  }

  // setInterval(tick, 33) drifts and coalesces. Instead each tick is scheduled against an ABSOLUTE target time.
  #schedule() {
    this.#timer = setTimeout(() => this.#onTimer(), Math.max(0, this.#next - performance.now()));
  }

  #onTimer() {
    if (!this.#running) return;
    const start = performance.now();
    this.tick();
    this.stats.record(start, performance.now() - start);
    this.#next += TICK_MS;
    const now = performance.now();
    if (this.#next < now - 5 * TICK_MS) this.#next = now + TICK_MS; // hopelessly behind: skip ticks instead of spiralling
    this.#schedule();
  }

  tick() {
    const inputs = new Map();
    for (const st of this.players.values()) {
      const taken = st.queue.splice(0, MAX_INPUTS_PER_TICK);
      if (!taken.length) continue;
      st.lastSeq = taken[taken.length - 1].seq; // ack even if the ship is dead (inputs are simply discarded)
      if (st.ship.alive) inputs.set(st.ship.id, taken);
    }
    this.world.step(STEP, inputs);
    this.tickNo++;

    const entities = snapshotWorld(this.world);
    for (const st of this.players.values()) {
      st.player.sendBinary(encodeSnapshot({ tick: this.tickNo, ack: st.lastSeq, entities }));
    }
    if (this.pendingEvents.length) {
      this.room.broadcast(serverMsg.events(this.pendingEvents), null, { critical: false });
      this.pendingEvents = [];
    }
    if (this.tickNo % SCORE_EVERY_TICKS === 0 && this.players.size) {
      const list = [...this.players.values()].map((st) => [
        st.player.name,
        this.world.scores.get(st.ship.id) ?? 0,
      ]);
      this.room.broadcast(serverMsg.scores(list), null, { critical: false });
    }
  }

  info() {
    return {
      room: this.room.id,
      players: this.players.size,
      running: this.#running,
      tick: this.tickNo,
      ...this.stats.snapshot(),
    };
  }
}
