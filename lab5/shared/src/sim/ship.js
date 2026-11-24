import { homing } from "./behaviors.js";
import { Bullet } from "./bullet.js";
import { Entity } from "./entity.js";
import { quantizeAngle, SHIP_RADIUS, stepShip, TUNING } from "./shipmove.js";
import { Vector2 } from "./vector.js";

// Effect durations in STEPS (1 step = 1/30 s): integers, so they travel in one byte and stay exact on both sides.
const EFFECT_STEPS = { shield: 180, rapid: 240, homing: 240 }; // 6 s, 8 s, 8 s

// One level of inheritance. Movement is NOT here: it is stepShip() so the client can run the very same code.
export class Ship extends Entity {
  #hp = 100;

  constructor({ x = 0, y = 0 } = {}) {
    super({ x, y, radius: SHIP_RADIUS, angle: quantizeAngle(-Math.PI / 2), kind: "ship" });
    this.cooldown = 0;
    this.thrust = false;
    this.invuln = 0;
    this.rapid = 0; // rapid fire: part of the predicted rule (see shipmove.js)
    this.shieldSteps = 0; // server-side effect: blocks damage
    this.homingSteps = 0; // server-side effect: bullets seek targets
    this.removed = false; // true = the player left: never respawn
  }

  get hp() {
    return this.#hp;
  }

  damage(n) {
    if (this.invuln > 0 || this.shieldSteps > 0) return false;
    this.#hp = Math.max(0, this.#hp - n);
    this.invuln = 0.3;
    if (this.#hp === 0) this.alive = false;
    return true;
  }

  applyPickup(type) {
    if (type === "shield") this.shieldSteps = EFFECT_STEPS.shield;
    else if (type === "rapid") this.rapid = EFFECT_STEPS.rapid;
    else if (type === "homing") this.homingSteps = EFFECT_STEPS.homing;
  }

  reset(x, y) {
    this.#hp = 100;
    this.alive = true;
    this.removed = false;
    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = 0;
    this.vel.y = 0;
    this.angle = quantizeAngle(-Math.PI / 2);
    this.cooldown = 0;
    this.rapid = 0;
    this.shieldSteps = 0;
    this.homingSteps = 0;
    this.invuln = 2;
    this.savePrev();
  }

  // One input == one simulation step (the server applies every input it received since the last tick).
  applyInput(input, dt, world) {
    if (!stepShip(this, input, dt)) return;
    const dir = Vector2.fromAngle(this.angle);
    world.dispatchEvent(
      new CustomEvent("fired", { detail: { shipId: this.id, x: this.pos.x, y: this.pos.y } }),
    );
    const bullet = new Bullet({
      pos: this.pos.add(dir.scale(SHIP_RADIUS + 4)),
      vel: this.vel.add(dir.scale(TUNING.bulletSpeed)), // inherits ship velocity
      owner: this.id,
    });
    if (this.homingSteps > 0) {
      bullet.homing = true;
      bullet.behaviors.push(homing({ kinds: ["asteroid", "ship"], excludeId: this.id, turnRate: 3 }));
    }
    world.spawn(bullet);
  }

  // ships move only via applyInput; here only the server-side timers tick
  update(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.shieldSteps > 0) this.shieldSteps--;
    if (this.homingSteps > 0) this.homingSteps--;
  }

  settle() {
    // collision knockback produces doubles: snap back to float32 so snapshots stay lossless
    this.pos.x = Math.fround(this.pos.x);
    this.pos.y = Math.fround(this.pos.y);
    this.vel.x = Math.fround(this.vel.x);
    this.vel.y = Math.fround(this.vel.y);
  }
}
