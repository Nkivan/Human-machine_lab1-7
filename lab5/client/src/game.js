import { decodeServer, encodeInputs, encodePing } from "@dogfight/shared/codec/binary";
import { KIND, PROTOCOL_VERSION, STEP, TICK_RATE } from "@dogfight/shared/protocol/constants";
import { createChatView } from "./chatView.js";
import { createConnection } from "./connection.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createInterpolator, createPredictor } from "./net/netcode.js";
import { drawNetgraph } from "./net/netgraph.js";
import { drawWorld, toItem } from "./net/netdraw.js";
import { createNetStats } from "./net/netstats.js";
import { drawBackground, drawHud } from "./render/draw.js";

// "SHIELD 4s  RAPID 7s": remaining time of each active effect (steps / 30 = seconds)
function effectsLine(e) {
  const parts = [];
  if (e.shield > 0) parts.push(`SHIELD ${Math.ceil(e.shield / TICK_RATE)}s`);
  if (e.rapid > 0) parts.push(`RAPID ${Math.ceil(e.rapid / TICK_RATE)}s`);
  if (e.homing > 0) parts.push(`HOMING ${Math.ceil(e.homing / TICK_RATE)}s`);
  return parts.join("  ");
}

const PRESETS = [
  // L cycles the latency injector (rtt ms, jitter ms, drop)
  { latency: 0, jitter: 0, drop: 0 },
  { latency: 50, jitter: 10, drop: 0 },
  { latency: 100, jitter: 30, drop: 0.02 },
  { latency: 200, jitter: 60, drop: 0.05 },
];

export function startNetGame({ ctx, view, room, name, assets, audio, params }) {
  const bus = new EventTarget(); // server events -> audio and HUD (same pattern as Lab 3: they listen, nobody imports them)
  audio.attach(bus);
  const hud = createHud(bus);
  const input = createInput(window);
  const stats = createNetStats();
  const interp = createInterpolator();
  const predictor = createPredictor({ noise: Number(params.get("noise") ?? 0) }); // ?noise=1 breaks determinism on purpose
  const sprites = { sheet: assets.images.sheet, frames: assets.frames };

  let you = null; // my ship's entity id (from "welcome")
  let seq = 0;
  let scores = [];
  let showHud = true;
  let showNet = true;
  let preset = 0;
  const recent = []; // the last few inputs, repeated in every packet (redundancy against dropped packets)
  const particles = [];
  let lastInvuln = false;
  let myEffects = { shield: 0, rapid: 0, homing: 0 }; // steps left (1 step = 1/30 s), from my ship in the last snapshot

  // --- connection ---------------------------------------------------------------------------------------------
  const sim = ["lat", "jitter", "drop"]
    .filter((k) => params.has(k))
    .map((k) => `${k}=${params.get(k)}`)
    .join("&");
  let netStatus = "connecting"; // MUST be declared before createConnection(): it calls onStatus synchronously
  const chat = createChatView({
    onSend: (text) => conn.send({ v: PROTOCOL_VERSION, type: "chat", text }),
  });
  const conn = createConnection({
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${sim ? `?${sim}` : ""}`,
    onOpen: () => {
      you = null;
      conn.send({ v: PROTOCOL_VERSION, type: "join", room: room.id, name });
    },
    onStatus: (s) => {
      chat.setStatus(s);
      netStatus = s;
    },
    onTraffic: (dir, n) => (dir === "in" ? stats.bytesIn(n) : stats.bytesOut(n)),
  });

  conn.on("welcome", (m) => {
    you = m.you;
  });
  conn.on("roster", (m) => chat.setRoster(m.players));
  conn.on("chat", (m) => chat.addLine(`${m.from}: ${m.text}`));
  conn.on("system", (m) => chat.addLine(m.text, "sys"));
  conn.on("error", (m) => chat.addLine(`error: ${m.message}`, "sys"));
  conn.on("scores", (m) => {
    scores = m.list;
  });
  conn.on("netsim", (m) => stats.setSim({ latency: m.latency, jitter: m.jitter, drop: m.drop }));
  conn.on("events", (m) => {
    for (const ev of m.list) {
      if (ev.k === "fired" && (ev.shipId & 0xffff) === you) continue; // my own shot already played locally (prediction)
      if (ev.k === "score" && (ev.owner & 0xffff) !== you) continue; // popups only for my points
      if (ev.k === "pickup" && (ev.shipId & 0xffff) !== you) continue; // popups only for my pickups
      if (ev.k === "exploded")
        for (let i = 0; i < 24; i++) {
          // visual only: client-side randomness is fine
          const a = Math.random() * Math.PI * 2,
            sp = 40 + Math.random() * 220;
          particles.push({
            x: ev.x,
            y: ev.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.4 + Math.random() * 0.5,
          });
        }
      bus.dispatchEvent(new CustomEvent(ev.k, { detail: ev }));
    }
  });

  conn.on("binary", (buf) => {
    const msg = decodeServer(buf);
    if (!msg) return;
    const now = performance.now();
    if (msg.type === "pong") return stats.rtt(now - msg.t);
    stats.snapshot();
    interp.push(msg, now);
    const mine =
      you === null ? null : msg.entities.find((e) => e.kind === KIND.SHIP && e.id === you);
    if (mine) {
      lastInvuln = (mine.flags & 2) !== 0;
      myEffects = { shield: mine.shield, rapid: mine.rapid, homing: mine.homing };
      stats.correction(predictor.reconcile(mine, msg.ack, STEP)); // server truth + replay of unacknowledged inputs
      predictor.dropAckedBullets(msg.ack);
    } else predictor.clear(); // dead (or not spawned yet): stop predicting until the next snapshot has me
  });
  setInterval(() => conn.sendBinary(encodePing(performance.now())), 1000); // application-level RTT measurement

  // --- simulation: ONE step per input, 30 per second, exactly like a server tick -------------------------------
  function readInput() {
    const left = input.isDown("ArrowLeft") || input.isDown("KeyA");
    const right = input.isDown("ArrowRight") || input.isDown("KeyD");
    return {
      turn: (right ? 1 : 0) - (left ? 1 : 0),
      thrust: input.isDown("ArrowUp") || input.isDown("KeyW"),
      fire: input.isDown("Space"),
    };
  }

  function simulate(dt) {
    if (input.justPressed("KeyH")) showHud = !showHud;
    if (input.justPressed("KeyN")) showNet = !showNet;
    if (input.justPressed("BracketLeft")) interp.delayMs -= 10;
    if (input.justPressed("BracketRight")) interp.delayMs += 10;
    if (input.justPressed("KeyL")) {
      preset = (preset + 1) % PRESETS.length;
      conn.send({ v: PROTOCOL_VERSION, type: "netsim", ...PRESETS[preset] });
    }

    const cmd = { seq: ++seq, ...readInput() };
    recent.push(cmd);
    if (recent.length > 3) recent.shift();
    conn.sendBinary(encodeInputs(recent)); // inputs go up, never positions
    if (predictor.apply(cmd.seq, cmd, dt))
      bus.dispatchEvent(new CustomEvent("fired", { detail: {} })); // instant local sound
    predictor.stepBullets(dt);
    input.endStep();
  }

  // --- rendering ----------------------------------------------------------------------------------------------
  function render(alpha, loopStats) {
    const now = performance.now();
    const frameDt = loopStats.frameMs / 1000;
    stats.frame(now);
    predictor.decayError(frameDt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * frameDt;
      p.y += p.vy * frameDt;
      p.life -= frameDt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    const items = interp
      .sample(now)
      .filter((r) => r.id !== you || r.kind !== KIND.SHIP)
      .map((r) => toItem(r, you));
    for (const b of predictor.predictedBullets)
      items.push({ kind: "bullet", id: -1, x: b.x, y: b.y, mine: true, homing: false });
    const pose = predictor.renderPose(alpha);
    if (pose)
      items.push({
        kind: "ship",
        id: you,
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        thrust: pose.thrust,
        invuln: lastInvuln,
        shield: myEffects.shield > 0,
        me: true,
      });

    drawBackground(ctx, view);
    drawWorld(ctx, view, items, particles, sprites, now);
    hud.draw(ctx, view, now);
    if (showHud) {
      drawHud(ctx, loopStats, [
        `${name} @ ${room.name}`,
        ...scores.map(([n, s]) => `${n}: ${s}`),
        predictor.ready ? effectsLine(myEffects) : "destroyed / waiting for spawn...",
      ]);
    }
    if (showNet)
      drawNetgraph(ctx, view, {
        stats,
        ageMs: interp.ageMs(now),
        pending: predictor.pendingCount,
        interpDelay: interp.delayMs,
        status: netStatus,
      });
  }

  createLoop({ step: STEP, simulate, render }).start();
}
