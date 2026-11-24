import { createLoop } from "./loop.js";
import { createInput } from "./input.js";
import { createShip, cloneShip, integrate } from "./sim/ship.js";
import { ARENA } from "./sim/arena.js";
import { lerp, lerpAngle } from "./sim/math.js";
import { setupCanvas } from "./render/canvas.js";
import { drawBackground, drawShip, drawHud } from "./render/draw.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);

const ship = createShip();
let prev = cloneShip(ship);
let showHud = true;

function simulate(dt) {
  prev = cloneShip(ship); // keep the previous state for interpolation
  if (input.justPressed("KeyH")) showHud = !showHud; // edge-triggered example
  integrate(ship, input, dt);
  input.endStep();
}

function render(alpha, stats) {
  // If the ship wrapped around this step, don't interpolate across the whole arena.
  const wrappedX = Math.abs(ship.x - prev.x) > ARENA.width / 2;
  const wrappedY = Math.abs(ship.y - prev.y) > ARENA.height / 2;
  const pose = {
    x: wrappedX ? ship.x : lerp(prev.x, ship.x, alpha),
    y: wrappedY ? ship.y : lerp(prev.y, ship.y, alpha),
    angle: lerpAngle(prev.angle, ship.angle, alpha),
  };
  drawBackground(ctx, view);
  drawShip(ctx, view, pose, ship.thrust, performance.now());
  if (showHud) drawHud(ctx, stats);
}

createLoop({ simulate, render }).start();
