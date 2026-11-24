import { wrapPos } from "./arena.js";
import { TAU } from "./math.js";

export const SHIP_RADIUS = 14;
export const BULLET_TTL = 1.4;
export const TUNING = {
  turnSpeed: 3.6,
  thrustAccel: 380,
  drag: 0.6,
  maxSpeed: 520,
  bulletSpeed: 520,
  fireDelaySteps: 9, // cooldown counted in STEPS (an integer), not seconds: exact on both sides, 1 byte on the wire
  rapidDelaySteps: 3, // the same, while the rapid-fire effect is active
};

// The angle is part of the simulation state AND quantized to 1/1000 rad: the Int16 on the wire is then lossless.
export function quantizeAngle(a) {
  return Math.round((((a % TAU) + TAU) % TAU) * 1000) / 1000;
}

const f32 = Math.fround; // positions/velocities live as float32: the Float32 on the wire is then lossless too

// Works on any { pos:{x,y}, vel:{x,y}, angle, cooldown, rapid, thrust }: the server's Ship AND the client's predicted ship.
// `rapid` (steps left of the rapid-fire effect) is part of the shared rule because it changes the fire rate: the prediction must know it.
// Deterministic: no Math.random, no Date.now, no DOM. Returns true when the ship fires this step.
export function stepShip(s, input, dt) {
  if (s.cooldown > 0) s.cooldown--;
  if (s.rapid > 0) s.rapid--;
  const turn = Math.max(-1, Math.min(1, input.turn));
  s.angle = quantizeAngle(s.angle + turn * TUNING.turnSpeed * dt);
  s.thrust = !!input.thrust;
  if (s.thrust) {
    s.vel.x += Math.cos(s.angle) * TUNING.thrustAccel * dt;
    s.vel.y += Math.sin(s.angle) * TUNING.thrustAccel * dt;
  }
  const damp = Math.exp(-TUNING.drag * dt);
  s.vel.x *= damp;
  s.vel.y *= damp;
  const speed = Math.hypot(s.vel.x, s.vel.y);
  if (speed > TUNING.maxSpeed) {
    const k = TUNING.maxSpeed / speed;
    s.vel.x *= k;
    s.vel.y *= k;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  wrapPos(s.pos);
  s.pos.x = f32(s.pos.x);
  s.pos.y = f32(s.pos.y);
  s.vel.x = f32(s.vel.x);
  s.vel.y = f32(s.vel.y);
  if (input.fire && s.cooldown === 0) {
    s.cooldown = s.rapid > 0 ? TUNING.rapidDelaySteps : TUNING.fireDelaySteps;
    return true;
  }
  return false;
}
