import { createLoop } from "./loop.js";
import { createInput } from "./input.js";
import { World } from "./sim/world.js";
import { Ship } from "./sim/ship.js";
import { ARENA } from "./sim/arena.js";
import { setupCanvas } from "./render/canvas.js";
import { drawBackground, drawEntities, drawHud } from "./render/draw.js";

const { ctx, view } = setupCanvas(document.getElementById("game"));
const input = createInput(window);

const world = new World(12345); // seeded: same seed -> same game
const player = world.spawn(new Ship({ x: ARENA.width / 2, y: ARENA.height / 2 }));
world.spawn(new Ship({ x: ARENA.width * 0.8, y: ARENA.height * 0.3, isDrone: true })); // target dummy
let showHud = true;

function simulate(dt) {
  if (input.justPressed("KeyH")) showHud = !showHud;
  world.step(dt, new Map([[player.id, input]])); // inputs: shipId -> input
  input.endStep();
}

function render(alpha, stats) {
  drawBackground(ctx, view);
  drawEntities(ctx, view, world, alpha, performance.now());
  if (!showHud) return;
  const effects = [player.shield > 0 && "SHIELD", player.rapid > 0 && "RAPID", player.homingTime > 0 && "HOMING"].filter(Boolean);
  drawHud(ctx, stats, [
    `score: ${world.score}`,
    player.alive ? `hp: ${player.hp}` : "destroyed, respawning...",
    effects.join(" ") || "-",
  ]);
}

createLoop({ simulate, render }).start();
