import { Entity } from "./entity.js";

export class Bullet extends Entity {
  constructor({ pos, vel, owner, ttl = 1.4, damage = 10 }) {
    super({ x: pos.x, y: pos.y, vx: vel.x, vy: vel.y, angle: Math.atan2(vel.y, vel.x), radius: 3, kind: "bullet" });
    this.owner = owner; // id of the ship that fired it
    this.ttl = ttl; // time to live, seconds
    this.damage = damage;
  }
  update(dt, world) {
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
    super.update(dt, world);
  }
}
