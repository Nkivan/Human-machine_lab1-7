import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeClient,
  decodeServer,
  encodeInputs,
  encodePing,
  encodePong,
  encodeSnapshot,
} from "../src/codec/binary.js";
import { snapshotWorld } from "../src/codec/snapshot.js";
import { Ship } from "../src/sim/ship.js";
import { World } from "../src/sim/world.js";

test("inputs round-trip exactly", () => {
  const inputs = [
    { seq: 7, turn: -1, thrust: true, fire: false },
    { seq: 4_000_000_000, turn: 1, thrust: false, fire: true },
  ];
  const res = decodeClient(encodeInputs(inputs));
  assert.equal(res.ok, true);
  assert.deepEqual(res.inputs, inputs);
});

test("client frames are validated (cheats and garbage are rejected)", () => {
  const buf = encodeInputs([{ seq: 1, turn: 0, thrust: false, fire: false }]);
  new DataView(buf).setInt8(6, 100); // a turn of 100
  assert.equal(decodeClient(buf).ok, false);
  assert.equal(decodeClient(new ArrayBuffer(0)).ok, false);
  assert.equal(decodeClient(new Uint8Array([1, 9, 0]).buffer).ok, false); // count 9 > 5
  assert.equal(decodeClient(new Uint8Array([99]).buffer).ok, false);
});

test("ping/pong round-trip", () => {
  assert.equal(decodeClient(encodePing(1234.5)).t, 1234.5);
  assert.deepEqual(decodeServer(encodePong(99.25, 42)), { type: "pong", t: 99.25, tick: 42 });
});

test("snapshot of a REAL world round-trips losslessly (the sim is float32/milliradian by design)", () => {
  const world = new World(3, { asteroids: 5 });
  const ship = world.spawn(new Ship({ x: 300, y: 300 }));
  for (let i = 0; i < 200; i++)
    world.step(1 / 30, new Map([[ship.id, [{ turn: 1, thrust: true, fire: i % 5 === 0 }]]]));
  const records = snapshotWorld(world);
  const buf = encodeSnapshot({ tick: 200, ack: 199, entities: records });
  assert.equal(buf.byteLength, 11 + 28 * records.length);
  const decoded = decodeServer(buf);
  assert.equal(decoded.tick, 200);
  assert.equal(decoded.ack, 199);
  decoded.entities.forEach((e, i) => {
    const r = records[i];
    for (const k of ["x", "y", "vx", "vy", "angle"]) {
      if (r.kind === 1)
        assert.equal(e[k], r[k], `ship ${k} must be bit-exact`); // ships: exact (this is what prediction needs)
      else assert.ok(Math.abs(e[k] - r[k]) < 0.01, `${r.kind} ${k}`);
    }
  });
});

test("malformed server frames never throw", () => {
  assert.equal(decodeServer(new Uint8Array([2, 0, 0]).buffer), null);
  assert.equal(decodeServer(new ArrayBuffer(0)), null);
});

test("pickups, ship effects and homing bullets survive the binary round trip", () => {
  const world = new World(5, { asteroids: 0, pickupEvery: 1 });
  const ship = world.spawn(new Ship({ x: 100, y: 100 }));
  ship.applyPickup("rapid");
  ship.applyPickup("shield");
  ship.applyPickup("homing");
  for (let i = 0; i < 40; i++)
    world.step(1 / 30, new Map([[ship.id, [{ turn: 0, thrust: false, fire: true }]]]));
  const records = snapshotWorld(world);
  assert.ok(records.some((r) => r.kind === 4), "a pickup has spawned (kind 4)");
  assert.ok(records.some((r) => r.kind === 2 && (r.flags & 8) !== 0), "bullets fired while homing carry the homing flag");

  const decoded = decodeServer(encodeSnapshot({ tick: 1, ack: 1, entities: records }));
  const before = records.find((r) => r.kind === 1);
  const after = decoded.entities.find((r) => r.kind === 1);
  for (const k of ["x", "y", "vx", "vy", "angle", "aux", "flags", "rapid", "shield", "homing"]) {
    assert.equal(after[k], before[k], `ship ${k} must be bit-exact`);
  }
  assert.ok(after.rapid > 0 && after.shield > 0 && after.homing > 0);
  assert.deepEqual(
    decoded.entities.filter((r) => r.kind === 4).map((r) => r.aux),
    records.filter((r) => r.kind === 4).map((r) => r.aux),
  );
});
