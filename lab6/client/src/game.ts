import { decodeServer, encodeInputs, encodePing } from "@dogfight/shared/codec/binary";
import { PROTOCOL_VERSION, STEP, TICK_RATE } from "@dogfight/shared/protocol/constants";
import { asSeq, type EntityId } from "@dogfight/shared/protocol/ids";
import type { NetsimSettings, RoomInfo, ShipRecord, Snapshot, WireEvent } from "@dogfight/shared/protocol/messages";
import type { Input, ShipCommand } from "@dogfight/shared/sim/shipmove";
import { assertNever } from "@dogfight/shared/util";
import type { LoadedAssets } from "./assets/loader.ts";
import type { Audio } from "./audio.ts";
import { createChatView } from "./chatView.ts";
import { createConnection } from "./connection.ts";
import { createGameBus } from "./events.ts";
import { createHud } from "./hud.ts";
import { createKeyboard } from "./input.ts";
import { createLoop, type LoopStats } from "./loop.ts";
import { createInterpolator, createPredictor } from "./net/netcode.ts";
import { drawNetgraph } from "./net/netgraph.ts";
import { drawWorld, toItem, type DrawItem, type Particle, type Sprites } from "./net/netdraw.ts";
import { createNetStats } from "./net/netstats.ts";
import type { View } from "./render/canvas.ts";
import { drawBackground, drawHud } from "./render/draw.ts";

const PRESETS = [
  // L cycles the latency injector (rtt ms, jitter ms, drop)
  { latency: 0, jitter: 0, drop: 0 },
  { latency: 50, jitter: 10, drop: 0 },
  { latency: 100, jitter: 30, drop: 0.02 },
  { latency: 200, jitter: 60, drop: 0.05 },
] satisfies readonly NetsimSettings[];

// "SHIELD 4s  RAPID 7s": remaining time of each active effect (steps / 30 = seconds)
function effectsLine(e: { shield: number; rapid: number; homing: number }): string {
  const parts: string[] = [];
  if (e.shield > 0) parts.push(`SHIELD ${Math.ceil(e.shield / TICK_RATE)}s`);
  if (e.rapid > 0) parts.push(`RAPID ${Math.ceil(e.rapid / TICK_RATE)}s`);
  if (e.homing > 0) parts.push(`HOMING ${Math.ceil(e.homing / TICK_RATE)}s`);
  return parts.join("  ");
}

export interface GameOptions {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: View;
  readonly room: RoomInfo;
  readonly name: string;
  readonly assets: LoadedAssets;
  readonly audio: Audio;
  readonly params: URLSearchParams;
}

export function startNetGame({ ctx, view, room, name, assets, audio, params }: GameOptions): void {
  const sheet = assets.images["sheet"];
  if (!sheet) throw new Error("the sprite sheet is missing from the loaded assets");
  const sprites: Sprites = { sheet, frames: assets.frames };

  const bus = createGameBus(); // server events -> audio and HUD: they listen, nobody imports them
  audio.attach(bus);
  const hud = createHud(bus);
  const keys = createKeyboard(window);
  const stats = createNetStats();
  const interp = createInterpolator();
  const predictor = createPredictor({ noise: Number(params.get("noise") ?? 0) }); // ?noise=1 breaks determinism on purpose

  let you: EntityId | null = null; // my ship's entity id (from "welcome")
  let seq = 0;
  let scores: [string, number][] = [];
  let showHud = true;
  let showNet = true;
  let preset = 0;
  let netStatus = "connecting";
  let lastInvuln = false;
  let myEffects = { shield: 0, rapid: 0, homing: 0 }; // steps left (1 step = 1/30 s), from my ship in the last snapshot
  const recent: Input[] = []; // the last few inputs, repeated in every packet (redundancy against dropped packets)
  const particles: Particle[] = [];

  // --- connection ---------------------------------------------------------------------------------------------
  const sim = ["lat", "jitter", "drop", "codec"]
    .filter((k) => params.has(k))
    .map((k) => `${k}=${params.get(k)}`)
    .join("&");
  const chat = createChatView({ onSend: (text) => conn.send({ v: PROTOCOL_VERSION, type: "chat", text }) });

  function handleSnapshot(s: Snapshot): void {
    const now = performance.now();
    stats.snapshot();
    interp.push(s, now);
    const mine = you === null ? undefined : s.entities.find((e): e is ShipRecord => e.kind === "ship" && e.id === you);
    if (mine) {
      lastInvuln = mine.invuln;
      myEffects = { shield: mine.shield, rapid: mine.rapid, homing: mine.homing };
      stats.correction(predictor.reconcile(mine, s.ack, STEP)); // server truth + replay of unacknowledged inputs
      predictor.dropAckedBullets(s.ack);
    } else predictor.clear(); // dead (or not spawned yet): stop predicting until a snapshot has me again
  }

  function handleEvent(ev: WireEvent): void {
    switch (ev.k) {
      case "fired":
        if (ev.shipId !== you) bus.emit("fired", { x: ev.x, y: ev.y }); // my own shot already played locally (prediction)
        return;
      case "hit":
        bus.emit("hit", { x: ev.x, y: ev.y });
        return;
      case "exploded":
        for (let i = 0; i < 24; i++) {
          // visual only: client-side randomness is fine
          const a = Math.random() * Math.PI * 2;
          const sp = 40 + Math.random() * 220;
          particles.push({
            x: ev.x,
            y: ev.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.4 + Math.random() * 0.5,
          });
        }
        bus.emit("exploded", { x: ev.x, y: ev.y, kind: ev.kind });
        return;
      case "pickup":
        if (ev.shipId === you) bus.emit("pickup", { type: ev.type, x: ev.x, y: ev.y }); // popups only for my pickups
        return;
      case "score":
        if (ev.owner === you) bus.emit("score", { delta: ev.delta, x: ev.x, y: ev.y }); // popups only for my points
        return;
      default:
        return assertNever(ev);
    }
  }

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
    onBinary: (buf) => {
      const r = decodeServer(buf);
      if (!r.ok) return;
      const frame = r.value;
      switch (frame.type) {
        case "pong":
          stats.rtt(performance.now() - frame.t);
          return;
        case "snapshot":
          handleSnapshot(frame.snapshot);
          return;
        default:
          return assertNever(frame);
      }
    },
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
    for (const ev of m.list) handleEvent(ev);
  });
  conn.on("snapshot", (m) => handleSnapshot(m)); // only when the JSON codec is selected (?codec=json)
  setInterval(() => conn.sendBinary(encodePing(performance.now())), 1000); // application-level RTT measurement

  // --- simulation: ONE step per input, 30 per second, exactly like a server tick -------------------------------
  function readCommand(): ShipCommand {
    const left = keys.isDown("ArrowLeft") || keys.isDown("KeyA");
    const right = keys.isDown("ArrowRight") || keys.isDown("KeyD");
    const turn = left === right ? 0 : right ? 1 : -1; // typed as -1 | 0 | 1, not just `number`
    return { turn, thrust: keys.isDown("ArrowUp") || keys.isDown("KeyW"), fire: keys.isDown("Space") };
  }

  function simulate(dt: number): void {
    if (keys.justPressed("KeyH")) showHud = !showHud;
    if (keys.justPressed("KeyN")) showNet = !showNet;
    if (keys.justPressed("BracketLeft")) interp.delayMs -= 10;
    if (keys.justPressed("BracketRight")) interp.delayMs += 10;
    if (keys.justPressed("KeyL")) {
      preset = (preset + 1) % PRESETS.length;
      const p = PRESETS[preset];
      if (p) conn.send({ v: PROTOCOL_VERSION, type: "netsim", ...p });
    }

    const cmd: Input = { seq: asSeq(++seq), ...readCommand() };
    recent.push(cmd);
    if (recent.length > 3) recent.shift();
    conn.sendBinary(encodeInputs(recent)); // inputs go up, never positions
    if (predictor.apply(cmd.seq, cmd, dt)) {
      const pose = predictor.renderPose(1);
      bus.emit("fired", { x: pose?.x ?? 0, y: pose?.y ?? 0 }); // instant local sound
    }
    predictor.stepBullets(dt);
    keys.endStep();
  }

  // --- rendering ----------------------------------------------------------------------------------------------
  function render(alpha: number, loopStats: LoopStats): void {
    const now = performance.now();
    const frameDt = loopStats.frameMs / 1000;
    stats.frame(now);
    predictor.decayError(frameDt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (!p) continue;
      p.x += p.vx * frameDt;
      p.y += p.vy * frameDt;
      p.life -= frameDt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    const items: DrawItem[] = interp
      .sample(now)
      .filter((r) => r.kind !== "ship" || r.id !== you) // my own ship comes from prediction, not from the snapshot
      .map((r) => toItem(r, you));
    for (const b of predictor.predictedBullets) items.push({ kind: "bullet", x: b.x, y: b.y, homing: false });
    const pose = predictor.renderPose(alpha);
    if (pose)
      items.push({
        kind: "ship",
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
