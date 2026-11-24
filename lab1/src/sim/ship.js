// Pure simulation: no DOM, no canvas, no time source. Same inputs -> same result.
import { ARENA, wrap } from "./arena.js";
import { TAU } from "./math.js";

export const TUNING = {
  turnSpeed: 3.6, // rad/s
  thrustAccel: 380, // px/s^2
  drag: 0.6, // 1/s, exponential damping
  maxSpeed: 520, // px/s
};

export function createShip() {
  return { x: ARENA.width / 2, y: ARENA.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: false };
}

export const cloneShip = (s) => ({ ...s });

export function integrate(ship, input, dt) {
  const left = input.isDown("ArrowLeft") || input.isDown("KeyA");
  const right = input.isDown("ArrowRight") || input.isDown("KeyD");
  ship.thrust = input.isDown("ArrowUp") || input.isDown("KeyW");

  ship.angle += ((right ? 1 : 0) - (left ? 1 : 0)) * TUNING.turnSpeed * dt;
  ship.angle = ((ship.angle % TAU) + TAU) % TAU;

  if (ship.thrust) {
    ship.vx += Math.cos(ship.angle) * TUNING.thrustAccel * dt;
    ship.vy += Math.sin(ship.angle) * TUNING.thrustAccel * dt;
  }

  const damp = Math.exp(-TUNING.drag * dt);
  ship.vx *= damp;
  ship.vy *= damp;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > TUNING.maxSpeed) {
    const k = TUNING.maxSpeed / speed;
    ship.vx *= k;
    ship.vy *= k;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrap(ship);
}
