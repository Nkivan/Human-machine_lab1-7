import { Entity } from "./entity.js";

export class Asteroid extends Entity {
  constructor({ x, y, vx, vy, radius }) {
    super({ x, y, vx, vy, radius, kind: "asteroid" });
    this.hp = radius; // bigger = tougher
    this.seeker = false; // set true when a homing behavior is attached
  }
}
