import { ARENA } from "./arena.js";
import { mulberry32 } from "./random.js";
import { TAU } from "./math.js";
import { findCollisions } from "./collision.js";
import { Asteroid } from "./asteroid.js";
import { Pickup } from "./pickup.js";
import { Explosion } from "./explosion.js";
import { homing } from "./behaviors.js";

const TARGET_ASTEROIDS = 6;
const PICKUP_TYPES = ["shield", "rapid", "homing"];

export class World {
  #entities = new Map(); // id -> Entity
  #incoming = []; // spawned during a step: inserted at the end
  #stepping = false;
  #respawns = [];
  #pickupTimer = 4;
  score = 0;

  constructor(seed = 1) { this.rng = mulberry32(seed); }

  rand(min, max) { return min + (max - min) * this.rng(); }

  spawn(e) {
    if (this.#stepping) this.#incoming.push(e); // never grow the Map mid-iteration
    else this.#entities.set(e.id, e);
    return e;
  }
  despawn(id) { const e = this.#entities.get(id); if (e) e.alive = false; } // deferred: swept at end of step
  get(id) { return this.#entities.get(id); }
  *[Symbol.iterator]() { yield* this.#entities.values(); }
  *ofKind(kind) { for (const e of this) if (e.kind === kind) yield e; }

  step(dt, inputs = new Map()) {
    this.#stepping = true;
    for (const e of this) {
      e.savePrev();
      if (e.kind === "ship") e.input = inputs.get(e.id) ?? null;
      e.update(dt, this);
    }
    for (const [a, b] of findCollisions(this)) this.#collide(a, b);
    this.#sweep();
    this.#stepping = false;
    for (const e of this.#incoming) this.#entities.set(e.id, e);
    this.#incoming.length = 0;
    this.#maintain(dt);
  }

  #collide(a, b) {
    if (!a.alive || !b.alive) return;
    const pair = (x, y) => (a.kind === x && b.kind === y ? [a, b] : a.kind === y && b.kind === x ? [b, a] : null);
    let p;
    if ((p = pair("bullet", "ship"))) {
      const [bullet, ship] = p;
      if (bullet.owner === ship.id) return; // no friendly fire on yourself
      const wasAlive = ship.alive;
      ship.damage(bullet.damage);
      bullet.alive = false;
      if (wasAlive && !ship.alive && this.#isPlayer(bullet.owner)) this.score += 50;
    } else if ((p = pair("bullet", "asteroid"))) {
      const [bullet, ast] = p;
      ast.hp -= bullet.damage;
      bullet.alive = false;
      if (ast.hp <= 0) { ast.alive = false; if (this.#isPlayer(bullet.owner)) this.score += 10; }
    } else if ((p = pair("ship", "asteroid"))) {
      const [ship] = p;
      if (ship.damage(20)) ship.vel = ship.vel.scale(-0.5);
    } else if ((p = pair("ship", "pickup"))) {
      const [ship, pickup] = p;
      ship.applyPickup(pickup.type);
      pickup.alive = false;
    }
  }

  #isPlayer(shipId) { const s = this.#entities.get(shipId); return !!s && !s.isDrone; }

  #sweep() {
    for (const e of [...this.#entities.values()]) {
      if (e.alive) continue;
      if (e.kind === "ship") { this.spawn(new Explosion(e.pos.x, e.pos.y, this.rng)); this.#respawns.push({ ship: e, t: 2 }); }
      else if (e.kind === "asteroid") this.spawn(new Explosion(e.pos.x, e.pos.y, this.rng));
      this.#entities.delete(e.id);
    }
  }

  #maintain(dt) {
    this.#respawns = this.#respawns.filter((r) => {
      r.t -= dt;
      if (r.t > 0) return true;
      const { x, y } = this.#safeSpot();
      r.ship.reset(x, y);
      this.spawn(r.ship);
      return false;
    });

    let asteroids = 0, pickups = 0;
    for (const e of this) { if (e.kind === "asteroid") asteroids++; else if (e.kind === "pickup") pickups++; }
    for (; asteroids < TARGET_ASTEROIDS; asteroids++) this.#spawnAsteroid();

    this.#pickupTimer -= dt;
    if (this.#pickupTimer <= 0 && pickups < 2) {
      const type = PICKUP_TYPES[Math.floor(this.rng() * PICKUP_TYPES.length)];
      this.spawn(new Pickup({ x: this.rand(80, ARENA.width - 80), y: this.rand(80, ARENA.height - 80), type }));
      this.#pickupTimer = 8;
    }
  }

  #spawnAsteroid() {
    const onTop = this.rng() < 0.5;
    const speed = this.rand(30, 80), dir = this.rand(0, TAU);
    const a = new Asteroid({
      x: onTop ? this.rand(0, ARENA.width) : 0, y: onTop ? 0 : this.rand(0, ARENA.height),
      vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, radius: this.rand(18, 40),
    });
    if (this.rng() < 0.2) { a.behaviors.push(homing({ kinds: ["ship"], turnRate: 0.5 })); a.seeker = true; }
    this.spawn(a);
  }

  #safeSpot() {
    let spot = { x: 0, y: 0 };
    for (let i = 0; i < 10; i++) {
      spot = { x: this.rand(100, ARENA.width - 100), y: this.rand(100, ARENA.height - 100) };
      let safe = true;
      for (const a of this.ofKind("asteroid")) {
        if (Math.hypot(a.pos.x - spot.x, a.pos.y - spot.y) < 120 + a.radius) { safe = false; break; }
      }
      if (safe) break;
    }
    return spot;
  }
}
