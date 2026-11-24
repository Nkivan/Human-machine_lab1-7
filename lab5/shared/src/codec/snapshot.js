import { FLAG, KIND } from "../protocol/constants.js";
import { PICKUP_TYPES } from "../sim/pickup.js";

const u8 = (n) => Math.min(255, Math.max(0, n));

// World -> plain records (what the codec encodes). Ships, bullets, asteroids and pickups travel in snapshots;
// explosions, sounds and score popups are events (and the client invents its own particles).
export function snapshotWorld(world) {
  const out = [];
  for (const e of world) {
    if (e.kind === "ship") {
      out.push({
        id: e.id,
        kind: KIND.SHIP,
        flags: (e.thrust ? FLAG.THRUST : 0) | (e.invuln > 0 ? FLAG.INVULN : 0),
        x: e.pos.x,
        y: e.pos.y,
        vx: e.vel.x,
        vy: e.vel.y,
        angle: e.angle,
        aux: e.hp | (e.cooldown << 8),
        rapid: u8(e.rapid),
        shield: u8(e.shieldSteps),
        homing: u8(e.homingSteps),
      });
    } else if (e.kind === "bullet") {
      out.push({
        id: e.id,
        kind: KIND.BULLET,
        flags: e.homing ? FLAG.HOMING : 0,
        x: e.pos.x,
        y: e.pos.y,
        vx: e.vel.x,
        vy: e.vel.y,
        angle: Math.atan2(e.vel.y, e.vel.x),
        aux: e.owner & 0xffff,
      });
    } else if (e.kind === "asteroid") {
      out.push({
        id: e.id,
        kind: KIND.ASTEROID,
        flags: e.seeker ? FLAG.SEEKER : 0,
        x: e.pos.x,
        y: e.pos.y,
        vx: e.vel.x,
        vy: e.vel.y,
        angle: 0,
        aux: Math.min(65535, Math.round(e.radius * 10)),
      });
    } else if (e.kind === "pickup") {
      out.push({
        id: e.id,
        kind: KIND.PICKUP,
        flags: 0,
        x: e.pos.x,
        y: e.pos.y,
        vx: 0,
        vy: 0,
        angle: 0,
        aux: PICKUP_TYPES.indexOf(e.type) + 1,
      });
    }
  }
  return out;
}
