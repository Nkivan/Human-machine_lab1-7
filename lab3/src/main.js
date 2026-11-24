import { createLoop } from "./loop.js";
import { createInput } from "./input.js";
import { World } from "./sim/world.js";
import { Ship } from "./sim/ship.js";
import { ARENA } from "./sim/arena.js";
import { setupCanvas } from "./render/canvas.js";
import { drawBackground, drawEntities, drawHud } from "./render/draw.js";
import { fetchJson, loadAll, withRetry } from "./assets/loader.js";
import { loadWithScreen } from "./assets/loadingScreen.js";
import { applyTestMode } from "./assets/testmodes.js";
import { createAudio } from "./audio.js";
import { createHud } from "./hud.js";
import { Lobby } from "./lobby.js";
import { createLobbyView } from "./lobbyView.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const params = new URLSearchParams(location.search); // ?test=slow|flaky|404-sound|404-required|corrupt|timeout|abort  &seq=1
const audio = createAudio();
let abortedOnce = false;

async function load({ signal, onProgress, abort }) {
  const raw = await withRetry(() => fetchJson("/assets/manifest.json", { signal }), { signal });
  const manifest = applyTestMode(raw, params.get("test"));
  if (params.get("test") === "abort" && !abortedOnce) { abortedOnce = true; setTimeout(abort, 600); }
  const t0 = performance.now();
  const assets = await loadAll(manifest, { ctx: audio.ctx, signal, onProgress, sequential: params.has("seq") });
  console.log(`[loader] ${params.has("seq") ? "sequential" : "concurrent"}: ${(performance.now() - t0).toFixed(0)} ms`);
  return assets;
}

function enterLobby() {
  return new Promise((resolve) => { // an event that fires ONCE -> a promise
    const lobby = new Lobby();
    const lobbyView = createLobbyView(lobby);
    lobby.addEventListener("joined", (e) => { lobbyView.destroy(); resolve(e.detail); }, { once: true });
    lobby.start();
  });
}

function startGame({ room, name, assets }) {
  const world = new World(room.arena.seed, room.arena); // room's arena config
  audio.attach(world); // audio and HUD listen to the sim; the sim imports neither
  const hud = createHud(world);
  const input = createInput(window);
  const sprites = { sheet: assets.images.sheet, frames: assets.frames };

  const player = world.spawn(new Ship({ x: ARENA.width / 2, y: ARENA.height / 2 }));
  world.spawn(new Ship({ x: ARENA.width * 0.8, y: ARENA.height * 0.3, isDrone: true }));
  let showHud = true;

  function simulate(dt) {
    if (input.justPressed("KeyH")) showHud = !showHud;
    world.step(dt, new Map([[player.id, input]]));
    input.endStep();
  }

  function render(alpha, stats) {
    const now = performance.now();
    drawBackground(ctx, view);
    drawEntities(ctx, view, world, alpha, now, sprites);
    hud.draw(ctx, view, now);
    if (!showHud) return;
    const effects = [player.shield > 0 && "SHIELD", player.rapid > 0 && "RAPID", player.homingTime > 0 && "HOMING"].filter(Boolean);
    drawHud(ctx, stats, [
      `${name} @ ${room.name}`,
      `score: ${world.score}`,
      player.alive ? `hp: ${player.hp}` : "destroyed, respawning...",
      effects.join(" ") || "-",
    ]);
  }

  createLoop({ simulate, render }).start();
}

const assets = await loadWithScreen({ canvas, ctx, view, start: load });
audio.setBuffers(assets.sounds);
if (assets.failures.length) console.warn("optional assets missing:", assets.failures.map((f) => f.name));
const { room, name } = await enterLobby();
startGame({ room, name, assets });
