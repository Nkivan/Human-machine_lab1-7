import { Entity } from "./entity.js";

// The order matters: the binary protocol sends the type as its index + 1 (see codec/binary.js).
export const PICKUP_TYPES = ["shield", "rapid", "homing"];

// Stationary + collidable, but NOT a ship: this is what a deep hierarchy would struggle with.
export class Pickup extends Entity {
  constructor({ x, y, type }) {
    super({ x, y, radius: 12, kind: "pickup" });
    this.type = type; // "shield" | "rapid" | "homing"
    this.ttl = 12; // seconds before it disappears
  }

  // pickups do not move
  update(dt) {
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}
