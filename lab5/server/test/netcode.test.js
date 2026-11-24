import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { decodeServer, encodeInputs, encodePing } from "@dogfight/shared/codec/binary";
import { KIND, PROTOCOL_VERSION, STEP } from "@dogfight/shared/protocol/constants";
import { createPredictor } from "../../client/src/net/netcode.js"; // the SAME module the browser runs
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

async function start() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dogfight-net-"));
  const app = createApp(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      LOG_DIR: dir,
      STATIC_DIR: dir,
      DEBUG_ROUTES: "1",
      SEED_ROOMS: "0",
    }),
  );
  const { port } = await app.listen();
  const base = `127.0.0.1:${port}`;
  const res = await fetch(`http://${base}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "quiet", arena: { asteroids: 0, seed: 7 } }),
  });
  const { room } = await res.json();
  return { app, dir, base, roomId: room.id };
}

function connect(base, query = "") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws${query}`);
    ws.binaryType = "arraybuffer";
    ws.json = [];
    ws.bin = [];
    ws.closed = new Promise((r) => ws.once("close", (code) => r(code)));
    ws.on("message", (d, isBinary) => {
      if (isBinary) {
        const m = decodeServer(
          d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength),
        );
        if (m) {
          ws.bin.push(m);
          ws.emit("bin", m);
        }
      } else {
        const m = JSON.parse(d.toString());
        ws.json.push(m);
        ws.emit("json", m);
      }
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}
const waitJson = (ws, type, ms = 3000) =>
  new Promise((resolve, reject) => {
    const found = ws.json.find((m) => m.type === type);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    ws.on("json", function on(m) {
      if (m.type === type) {
        clearTimeout(t);
        ws.off("json", on);
        resolve(m);
      }
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const join = (ws, room, name = "Pilot") =>
  ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "join", room, name }));

// Run the real client netcode against the real server for `steps` fixed steps (30/s); returns the measurements.
async function fly(ws, steps, { noise = 0 } = {}) {
  const welcome = await waitJson(ws, "welcome");
  const predictor = createPredictor({ noise });
  const corrections = [];
  const rtts = [];
  let seq = 0,
    lastAck = 0,
    snapshots = 0;
  const recent = [];
  ws.on("bin", (m) => {
    if (m.type === "pong") return rtts.push(performance.now() - m.t);
    snapshots++;
    lastAck = Math.max(lastAck, m.ack);
    const mine = m.entities.find((e) => e.kind === KIND.SHIP && e.id === welcome.you);
    if (mine) corrections.push(predictor.reconcile(mine, m.ack, STEP));
  });
  ws.send(encodePing(performance.now()));
  for (let i = 0; i < steps; i++) {
    const cmd = {
      seq: ++seq,
      turn: i % 60 < 20 ? 1 : i % 60 < 40 ? -1 : 0,
      thrust: i % 45 < 30,
      fire: false,
    };
    recent.push(cmd);
    if (recent.length > 3) recent.shift();
    ws.send(encodeInputs(recent));
    predictor.apply(cmd.seq, cmd, STEP);
    if (i === 20) ws.send(encodePing(performance.now()));
    await sleep(1000 * STEP);
  }
  await sleep(400);
  return { corrections, rtts, snapshots, lastAck, seq, predictor };
}

test("end to end, 100 ms RTT + jitter + 2% loss: prediction matches the server exactly", async () => {
  const { app, dir, base, roomId } = await start();
  try {
    const ws = await connect(base, "?lat=100&jitter=20&drop=0.02");
    join(ws, roomId);
    const r = await fly(ws, 120);
    assert.ok(r.snapshots > 80, `snapshots ${r.snapshots}`);
    assert.ok(r.lastAck > 100, `server applied inputs up to ${r.lastAck}`);
    assert.equal(Math.max(...r.corrections), 0, "corrections must read 0 in open space");
    assert.ok(
      Math.min(...r.rtts) >= 80,
      `RTT should reflect the injector, got ${r.rtts.map((x) => x.toFixed(0))}`,
    );
    ws.close();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("end to end: with random noise in the prediction the corrections appear (the determinism experiment)", async () => {
  const { app, dir, base, roomId } = await start();
  try {
    const ws = await connect(base, "?lat=60");
    join(ws, roomId);
    const r = await fly(ws, 90, { noise: 4 });
    assert.ok(Math.max(...r.corrections) > 0.05, `max correction ${Math.max(...r.corrections)}`); // noise 4 => visible, and growing with the noise
    ws.close();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the tick loop keeps its cadence: /api/stats reports duration and jitter", async () => {
  const { app, dir, base, roomId } = await start();
  try {
    const ws = await connect(base);
    join(ws, roomId);
    await waitJson(ws, "welcome");
    const match = app.manager.get(roomId).match;
    await sleep(1500);
    const stats = await (await fetch(`http://${base}/api/stats`)).json();
    const m = stats.matches.find((x) => x.room === roomId);
    assert.equal(m.running, true);
    assert.ok(m.ticks > 30, `ticks ${m.ticks}`);
    assert.ok(
      Math.abs(m.intervalMs - 1000 / 30) < 3,
      `interval ${m.intervalMs} ms (absolute-target scheduling)`,
    );
    assert.ok(m.avgMs < 5 && m.jitterMs < 10, `avg ${m.avgMs} ms, jitter ${m.jitterMs} ms`);
    ws.close();
    await sleep(200);
    assert.equal(
      match.running,
      false,
      "no players: the loop stops (and the empty room is deleted)",
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("server validates binary frames: cheats, garbage, early frames and floods are rejected", async () => {
  const { app, dir, base, roomId } = await start();
  try {
    const early = await connect(base);
    early.send(encodeInputs([{ seq: 1, turn: 0, thrust: false, fire: false }]));
    assert.equal(await early.closed, 4004, "inputs before join");

    const keeper = await connect(base); // keeps the room alive: an EMPTY room is deleted (Lab 4)
    join(keeper, roomId, "Keeper");
    await waitJson(keeper, "welcome");

    const cheat = await connect(base);
    join(cheat, roomId);
    await waitJson(cheat, "welcome");
    const buf = encodeInputs([{ seq: 1, turn: 0, thrust: false, fire: false }]);
    new DataView(buf).setInt8(6, 100); // a turn of 100
    cheat.send(buf);
    assert.equal(await cheat.closed, 4003, "a turn of 100 is a cheat");

    const flood = await connect(base);
    join(flood, roomId);
    await waitJson(flood, "welcome");
    for (let i = 0; i < 400; i++) flood.send(encodePing(i));
    assert.equal(await flood.closed, 4008, "binary rate limit");
    keeper.close();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime netsim message changes the injector and is confirmed", async () => {
  const { app, dir, base, roomId } = await start();
  try {
    const ws = await connect(base);
    join(ws, roomId);
    await waitJson(ws, "welcome");
    ws.send(
      JSON.stringify({ v: PROTOCOL_VERSION, type: "netsim", latency: 120, jitter: 10, drop: 0.01 }),
    );
    const m = await waitJson(ws, "netsim");
    assert.deepEqual([m.latency, m.jitter, m.drop], [120, 10, 0.01]);
    ws.close();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
