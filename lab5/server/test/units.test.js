import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "../src/protocol.js";
import { createTokenBucket } from "../src/ratelimit.js";
import { Room, RoomManager } from "../src/rooms.js";

test("protocol: accepts valid join/chat and trims", () => {
  assert.deepEqual(validate({ v: 2, type: "join", room: "alpha", name: "  Ann " }), {
    ok: true,
    msg: { type: "join", room: "alpha", name: "Ann" },
  });
  assert.equal(validate({ v: 2, type: "chat", text: " hi " }).msg.text, "hi");
});

test("protocol: rejects bad shapes", () => {
  for (const bad of [
    null,
    [],
    "x",
    { v: 99, type: "chat", text: "a" },
    { v: 2, type: "nope" },
    { v: 2, type: "chat", text: "" },
    { v: 2, type: "chat", text: "a".repeat(201) },
    { v: 2, type: "join", room: "../x", name: "A" },
    { v: 2, type: "join", room: "a", name: "bad\nname" },
  ]) {
    assert.equal(validate(bad).ok, false, JSON.stringify(bad));
  }
});

test("token bucket: burst, then refill over time", () => {
  let now = 0;
  const bucket = createTokenBucket({ ratePerSec: 2, burst: 3, now: () => now });
  assert.deepEqual(
    [bucket.take(), bucket.take(), bucket.take(), bucket.take()],
    [true, true, true, false],
  );
  now += 500; // +1 token
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
});

test("Room is an EventEmitter: join/leave/empty events", () => {
  const room = new Room({ id: "r", name: "R", arena: {}, max: 2 });
  const seen = [];
  for (const type of ["join", "leave", "empty"]) room.on(type, () => seen.push(type));
  const sent = [];
  room.join({ id: "1", name: "Ann", send: (m) => sent.push(m.type) });
  room.leave("1");
  assert.deepEqual(seen, ["join", "leave", "empty"]);
  assert.ok(sent.includes("roster"));
});

test("RoomManager: caps rooms, deletes empty non-persistent rooms", async () => {
  const manager = new RoomManager({
    maxRooms: 2,
    maxPlayersPerRoom: 2,
    logDir: "/tmp/dogfight-test-units",
  });
  const a = manager.create({ name: "A" });
  manager.create({ name: "B", persistent: true });
  assert.throws(() => manager.create({ name: "C" }), /too many rooms/);
  a.join({ id: "1", name: "x", send() {} });
  a.leave("1"); // empty -> deleted
  assert.equal(manager.size, 1);
  await manager.closeAll();
  assert.equal(manager.size, 0);
});
