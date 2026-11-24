import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";
import { Bullet } from "./bullet.js";
import { homing } from "./behaviors.js";
import { TAU } from "./math.js";

export const TUNING = {
  turnSpeed: 3.6, thrustAccel: 380, drag: 0.6, maxSpeed: 520,
  bulletSpeed: 520, fireDelay: 0.3, rapidDelay: 0.1,
};

export class Ship extends Entity {
  #hp = 100; // private: only damage()/reset() can change it

  constructor(opts = {}) {
    super({ ...opts, radius: 14, angle: opts.angle ?? -Math.PI / 2, kind: "ship" });
    this.isDrone = opts.isDrone ?? false; // a target dummy with no input
    this.input = null; // set by World.step each tick
    this.thrust = false;
    this.cooldown = 0; this.invuln = 0;
    this.shield = 0; this.rapid = 0; this.homingTime = 0; // pickup effect timers
  }

  get hp() { return this.#hp; }

  damage(n) {
    if (this.shield > 0 || this.invuln > 0) return false;
    this.#hp = Math.max(0, this.#hp - n);
    this.invuln = 0.3;
    if (this.#hp === 0) this.alive = false;
    return true;
  }

  reset(x, y) {
    this.#hp = 100; this.alive = true;
    this.pos.x = x; this.pos.y = y;
    this.prevPos.x = x; this.prevPos.y = y;
    this.vel.x = 0; this.vel.y = 0;
    this.angle = this.prevAngle = -Math.PI / 2;
    this.invuln = 2; this.shield = this.rapid = this.homingTime = 0;
  }

  applyPickup(type) {
    if (type === "shield") this.shield = 6;
    else if (type === "rapid") this.rapid = 8;
    else if (type === "homing") this.homingTime = 8;
  }

  // NOTE: uses `this`. Passing `ship.fire` as a callback loses it (see this-demo.js).
  fire(world) {
    if (this.cooldown > 0) return null;
    this.cooldown = this.rapid > 0 ? TUNING.rapidDelay : TUNING.fireDelay;
    const dir = Vector2.fromAngle(this.angle);
    const bullet = new Bullet({
      pos: this.pos.add(dir.scale(this.radius + 4)),
      vel: this.vel.add(dir.scale(TUNING.bulletSpeed)), // inherits ship velocity
      owner: this.id,
    });
    if (this.homingTime > 0) {
      bullet.behaviors.push(homing({ kinds: ["asteroid", "ship"], excludeId: this.id, turnRate: 3 }));
    }
    return world.spawn(bullet);
  }

  update(dt, world) {
    for (const k of ["cooldown", "invuln", "shield", "rapid", "homingTime"]) this[k] = Math.max(0, this[k] - dt);

    const i = this.input; // null for drones
    const left = i?.isDown("ArrowLeft") || i?.isDown("KeyA");
    const right = i?.isDown("ArrowRight") || i?.isDown("KeyD");
    this.thrust = !!(i?.isDown("ArrowUp") || i?.isDown("KeyW"));

    this.angle += ((right ? 1 : 0) - (left ? 1 : 0)) * TUNING.turnSpeed * dt;
    this.angle = ((this.angle % TAU) + TAU) % TAU;
    if (this.thrust) this.vel.addScaledInPlace(Vector2.fromAngle(this.angle), TUNING.thrustAccel * dt);

    const damp = Math.exp(-TUNING.drag * dt);
    this.vel.x *= damp; this.vel.y *= damp;
    const speed = this.vel.length();
    if (speed > TUNING.maxSpeed) this.vel = this.vel.scale(TUNING.maxSpeed / speed);

    if (i?.isDown("Space")) this.fire(world);
    super.update(dt, world);
  }
}
