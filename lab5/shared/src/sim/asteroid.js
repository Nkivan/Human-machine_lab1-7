import { Entity } from "./entity.js";

export class Asteroid extends Entity {
  constructor({ x, y, vx, vy, radius }) {
    super({ x, y, vx, vy, radius, kind: "asteroid" });
    this.hp = radius;
    this.seeker = false;
  }
}
