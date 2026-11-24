import { Entity } from "./entity.js";

// Stationary + collidable, but NOT a ship: this is exactly what a deep hierarchy would struggle with.
export class Pickup extends Entity {
  constructor({ x, y, type }) {
    super({ x, y, radius: 12, kind: "pickup" });
    this.type = type; // "shield" | "rapid" | "homing"
    this.ttl = 12;
  }
  update(dt) {
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}
