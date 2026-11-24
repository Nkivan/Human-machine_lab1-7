import { Vector2 } from "./vector.js";
import { wrapPos } from "./arena.js";

// Base class. Subclasses extend it ONE level only; extra abilities come from `behaviors` (composition).
export class Entity {
  static #nextId = 1; // private static counter
  #id = Entity.#nextId++; // private per-instance id

  constructor({ x = 0, y = 0, vx = 0, vy = 0, angle = 0, radius = 10, kind = "entity" } = {}) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(vx, vy);
    this.prevPos = new Vector2(x, y); // for render interpolation (Lab 1, M3)
    this.prevAngle = angle;
    this.angle = angle;
    this.radius = radius;
    this.kind = kind;
    this.alive = true;
    this.behaviors = []; // composition: functions (entity, dt, world) => void
  }

  get id() {
    return this.#id;
  }

  savePrev() {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevAngle = this.angle;
  }

  update(dt, world) {
    for (const behave of this.behaviors) behave(this, dt, world);
    this.pos.addScaledInPlace(this.vel, dt);
    wrapPos(this.pos);
  }
}
