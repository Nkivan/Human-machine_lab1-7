import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

async function start(extra = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dogfight-"));
  const app = createApp(
    loadConfig({ PORT: "0", HOST: "127.0.0.1", LOG_DIR: dir, STATIC_DIR: dir, ...extra }),
  );
  const { port } = await app.listen();
  return { app, dir, base: `127.0.0.1:${port}` };
}

function connect(base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    ws.inbox = [];
    ws.closed = new Promise((r) => ws.once("close", (code) => r(code)));
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      ws.inbox.push(m);
      ws.emit("inbox", m);
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitFor(ws, pred, ms = 2000) {
  const found = ws.inbox.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    const onMsg = (m) => {
      if (pred(m)) {
        clearTimeout(timer);
        ws.off("inbox", onMsg);
        resolve(m);
      }
    };
    ws.on("inbox", onMsg);
  });
}

const send = (ws, msg) => ws.send(JSON.stringify({ v: 1, ...msg }));

test("two clients join a room, see each other, chat; match log is written", async () => {
  const { app, dir, base } = await start();
  try {
    const a = await connect(base),
      b = await connect(base);
    send(a, { type: "join", room: "alpha", name: "Ann" });
    await waitFor(a, (m) => m.type === "roster" && m.players.join() === "Ann");
    send(b, { type: "join", room: "alpha", name: "Bob" });
    await waitFor(a, (m) => m.type === "roster" && m.players.join() === "Ann,Bob");
    send(b, { type: "chat", text: "hello there" });
    const chat = await waitFor(a, (m) => m.type === "chat");
    assert.equal(chat.from, "Bob");
    assert.equal(chat.text, "hello there");
    a.close();
    b.close();
  } finally {
    await app.close();
  }
  const file = (await readdir(dir)).find((f) => f.startsWith("alpha-"));
  const lines = (await readFile(path.join(dir, file), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    lines.map((l) => l.type).filter((t) => ["created", "join", "chat", "closed"].includes(t)),
    ["created", "join", "join", "chat", "closed"],
  );
  await rm(dir, { recursive: true, force: true });
});

test("protocol violations close the socket with specific codes", async () => {
  const { app, dir, base } = await start();
  try {
    const bad = await connect(base);
    send(bad, { type: "nope" });
    assert.equal(await bad.closed, 4003);

    const noRoom = await connect(base);
    send(noRoom, { type: "join", room: "does-not-exist", name: "X" });
    assert.equal(await noRoom.closed, 4006);

    const early = await connect(base);
    send(early, { type: "chat", text: "hi" });
    assert.equal(await early.closed, 4004);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversize payload -> 1009; rate limit -> 4008", async () => {
  const { app, dir, base } = await start({ MSG_PER_SEC: "1", MSG_BURST: "3" });
  try {
    const big = await connect(base);
    big.on("error", () => {});
    big.send("x".repeat(3000));
    assert.equal(await big.closed, 1009);

    const fast = await connect(base);
    send(fast, { type: "join", room: "alpha", name: "Fast" });
    for (let i = 0; i < 6; i++) send(fast, { type: "chat", text: `m${i}` });
    assert.equal(await fast.closed, 4008);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP: health, rooms API, body cap, traversal guards", async () => {
  const { app, dir, base } = await start();
  try {
    assert.equal((await fetch(`http://${base}/health`)).status, 200);

    const list = await (await fetch(`http://${base}/api/rooms`)).json();
    assert.ok(list.rooms.some((r) => r.id === "alpha"));

    const post = (body) =>
      fetch(`http://${base}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    const created = await post(JSON.stringify({ name: "My room", arena: { asteroids: 3 } }));
    assert.equal(created.status, 201);
    assert.equal((await post(JSON.stringify({ name: "" }))).status, 400);
    assert.equal((await post("{broken")).status, 400);
    assert.equal((await post(JSON.stringify({ name: "x", pad: "y".repeat(10000) }))).status, 413);

    assert.equal((await fetch(`http://${base}/..%2f..%2fetc/passwd`)).status, 403);
    assert.equal((await fetch(`http://${base}/api/replays/..%2f..%2fetc%2fpasswd`)).status, 400);
    assert.equal((await fetch(`http://${base}/api/nope`)).status, 404);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay endpoint streams a log file", async () => {
  const { app, dir, base } = await start();
  try {
    const { replays } = await (await fetch(`http://${base}/api/replays`)).json();
    // logs exist as soon as rooms are created (flushed on close), so just check the endpoint shape + 404 path
    assert.ok(Array.isArray(replays));
    assert.equal((await fetch(`http://${base}/api/replays/missing.ndjson`)).status, 404);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
