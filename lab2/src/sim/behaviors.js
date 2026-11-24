import { Vector2 } from "./vector.js";
import { TAU } from "./math.js";

export function nearest(world, from, kinds, excludeId) {
  let best = null, bestD = Infinity;
  for (const e of world) {
    if (e === from || e.id === excludeId || !e.alive || !kinds.includes(e.kind)) continue;
    const d = (e.pos.x - from.pos.x) ** 2 + (e.pos.y - from.pos.y) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Composition: ONE behavior, attachable to a bullet OR an asteroid (or anything with pos/vel).
// Usage: entity.behaviors.push(homing({ kinds: ["ship"], turnRate: 0.5 }))
export function homing({ kinds, excludeId, turnRate }) {
  return (e, dt, world) => {
    const t = nearest(world, e, kinds, excludeId);
    const speed = e.vel.length();
    if (!t || speed === 0) return;
    const cur = Math.atan2(e.vel.y, e.vel.x);
    const want = Math.atan2(t.pos.y - e.pos.y, t.pos.x - e.pos.x);
    const diff = ((((want - cur + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
    e.vel = Vector2.fromAngle(cur + turn, speed);
    e.angle = cur + turn;
  };
}
