import assert from "node:assert/strict";
import test from "node:test";
import { decodeServer, encodeSnapshot } from "@dogfight/shared/codec/binary";
import { snapshotWorld } from "@dogfight/shared/codec/snapshot";
import { KIND, STEP, TICK_MS } from "@dogfight/shared/protocol/constants";
import { Ship } from "@dogfight/shared/sim/ship";
import { World } from "@dogfight/shared/sim/world";
import { createInterpolator, createPredictor } from "../src/net/netcode.js";

// A scripted pilot: the same inputs every run.
const pilot = (i) => ({
  turn: i % 80 < 25 ? 1 : i % 80 < 40 ? 0 : -1,
  thrust: i % 50 < 35,
  fire: i % 13 === 0,
});

// Server and client in ONE process, with a network of `lag` steps each way (no sockets: pure logic + the real codec).
function simulateNetwork({ lag, steps = 400, noise = 0, drop = 0, rapid = false }) {
  const world = new World(9, { asteroids: 0 });
  const ship = world.spawn(new Ship({ x: 400, y: 300 }));
  if (rapid) ship.applyPickup("rapid"); // rapid fire changes the fire rate: the PREDICTION has to follow it too
  const predictor = createPredictor({ noise });
  const upstream = []; // { at, inputs }
  const downstream = []; // { at, buf }
  let lastSeq = 0,
    lastQueued = 0;
  const queue = [];
  const corrections = [];
  const recent = [];

  for (let step = 0; step < steps; step++) {
    // --- client: one input per step, predicted instantly, sent redundantly ---
    const cmd = { seq: step + 1, ...pilot(step), ...(rapid ? { fire: true } : {}) }; // while rapid: hold the trigger
    recent.push(cmd);
    if (recent.length > 3) recent.shift();
    if (step % 17 !== 3 || !drop) upstream.push({ at: step + lag, inputs: [...recent] }); // `drop` loses some packets
    predictor.apply(cmd.seq, cmd, STEP);

    // --- server: receives what has arrived, applies ONE tick ---
    for (const p of upstream.filter((u) => u.at <= step))
      for (const i of p.inputs)
        if (i.seq > lastQueued) {
          queue.push(i);
          lastQueued = i.seq;
        }
    upstream.splice(0, upstream.length, ...upstream.filter((u) => u.at > step));
    const taken = queue.splice(0, 4);
    if (taken.length) lastSeq = taken[taken.length - 1].seq;
    world.step(STEP, new Map([[ship.id, taken]]));
    downstream.push({
      at: step + lag,
      buf: encodeSnapshot({ tick: step + 1, ack: lastSeq, entities: snapshotWorld(world) }),
    });

    // --- client: receives snapshots that arrived, reconciles ---
    for (const d of downstream.filter((x) => x.at <= step)) {
      const snap = decodeServer(d.buf);
      const mine = snap.entities.find((e) => e.kind === KIND.SHIP);
      corrections.push(predictor.reconcile(mine, snap.ack, STEP));
    }
    downstream.splice(0, downstream.length, ...downstream.filter((x) => x.at > step));
  }
  return { corrections, predictor }; // ALL corrections, including the very first snapshots
}

test("prediction + reconciliation: corrections are EXACTLY zero when the sim is deterministic (3 steps of lag)", () => {
  const { corrections } = simulateNetwork({ lag: 3 });
  assert.ok(corrections.length > 300);
  assert.equal(Math.max(...corrections), 0, "no visible correction at all");
});

test("same at high latency (12 steps = 400 ms) and with lost packets (redundant inputs cover them)", () => {
  assert.equal(Math.max(...simulateNetwork({ lag: 12 }).corrections), 0);
  assert.equal(Math.max(...simulateNetwork({ lag: 6, drop: 1 }).corrections), 0);
});

test("breaking determinism on purpose (random noise in the prediction) makes corrections appear and grow", () => {
  const { corrections } = simulateNetwork({ lag: 6, noise: 4 });
  const mean = corrections.reduce((a, b) => a + b, 0) / corrections.length;
  assert.ok(mean > 0.05, `mean correction ${mean}`);
  assert.ok(Math.max(...corrections) > 0.5);
});

test("the pending-input buffer is bounded by the round trip and shrinks when acknowledged", () => {
  const { predictor } = simulateNetwork({ lag: 6 });
  assert.ok(
    predictor.pendingCount >= 6 && predictor.pendingCount <= 20,
    `pending ${predictor.pendingCount}`,
  );
});

test("predicted bullets are dropped once the server has processed that input", () => {
  const p = createPredictor();
  p.init({ x: 100, y: 100, vx: 0, vy: 0, angle: 0, aux: 0, flags: 0 });
  p.apply(1, { turn: 0, thrust: false, fire: true }, STEP);
  assert.equal(p.predictedBullets.length, 1);
  p.dropAckedBullets(1);
  assert.equal(p.predictedBullets.length, 0);
});

test("interpolator: renders between the two snapshots that bracket (now - delay)", () => {
  const interp = createInterpolator({ delayMs: 2 * TICK_MS });
  const rec = (id, x) => ({
    id,
    kind: KIND.SHIP,
    flags: 0,
    x,
    y: 50,
    vx: 0,
    vy: 0,
    angle: 0,
    aux: 0,
  });
  for (let tick = 1; tick <= 10; tick++)
    interp.push({ tick, ack: 0, entities: [rec(1, tick * 10)] }, tick * TICK_MS);
  // local time 10 ticks => render time = 10 - 2 = tick 8 -> x = 80; half a tick later -> 85
  assert.ok(Math.abs(interp.sample(10 * TICK_MS)[0].x - 80) < 1e-6);
  assert.ok(Math.abs(interp.sample(10.5 * TICK_MS)[0].x - 85) < 1e-6);
});

test("interpolator: entities appearing/disappearing between snapshots are handled", () => {
  const interp = createInterpolator({ delayMs: TICK_MS });
  const rec = (id, x) => ({
    id,
    kind: KIND.BULLET,
    flags: 0,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    aux: 0,
  });
  interp.push({ tick: 1, ack: 0, entities: [rec(1, 10)] }, 1 * TICK_MS);
  interp.push({ tick: 2, ack: 0, entities: [rec(1, 20), rec(2, 500)] }, 2 * TICK_MS); // 2 appears
  interp.push({ tick: 3, ack: 0, entities: [rec(2, 510)] }, 3 * TICK_MS); // 1 disappears
  const mid = interp.sample(2.5 * TICK_MS); // render time = 1.5 ticks: between snapshots 1 and 2
  assert.deepEqual(mid.map((r) => r.id).sort(), [1, 2]);
  assert.equal(mid.find((r) => r.id === 2).x, 500); // new entity appears at its first known position
  const late = interp.sample(3.5 * TICK_MS); // between 2 and 3: entity 1 is gone
  assert.deepEqual(
    late.map((r) => r.id),
    [2],
  );
});

test("interpolator: does not smear an entity across the arena when it wraps around", () => {
  const interp = createInterpolator({ delayMs: TICK_MS });
  const rec = (x) => ({
    id: 1,
    kind: KIND.SHIP,
    flags: 0,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    aux: 0,
  });
  interp.push({ tick: 1, ack: 0, entities: [rec(1270)] }, TICK_MS);
  interp.push({ tick: 2, ack: 0, entities: [rec(5)] }, 2 * TICK_MS);
  assert.equal(interp.sample(2.5 * TICK_MS)[0].x, 5);
});

test("rapid fire is part of the predicted rule: corrections stay EXACTLY zero while the effect is active", () => {
  const { corrections } = simulateNetwork({ lag: 6, rapid: true });
  assert.ok(corrections.length > 300);
  assert.equal(Math.max(...corrections), 0);
});
