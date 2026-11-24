import { Asteroid } from "./asteroid.js";
import { ARENA } from "./arena.js";
import { homing } from "./behaviors.js";
import { findCollisions } from "./collision.js";
import { TAU } from "./math.js";
import { Pickup, PICKUP_TYPES } from "./pickup.js";
import { mulberry32 } from "./random.js";

// Pure, seeded, DOM-free. inputs: Map<shipId, Input[]>: every input is applied as ONE step of dt.
export class World extends EventTarget {
  #entities = new Map();
  #incoming = [];
  #stepping = false;
  #respawns = [];
  scores = new Map(); // shipId -> points
  #pickupTimer = 0;

  // pickupEvery: seconds between pickups; 0 (the default) = no pickups
  constructor(seed = 1, { asteroids = 6, pickupEvery = 0 } = {}) {
    super();
    this.rng = mulberry32(seed);
    this.targetAsteroids = asteroids;
    this.pickupEvery = pickupEvery;
    this.#pickupTimer = pickupEvery;
  }

  rand(min, max) {
    return min + (max - min) * this.rng();
  }

  spawn(e) {
    if (this.#stepping)
      this.#incoming.push(e); // never grow the Map mid-iteration
    else this.#entities.set(e.id, e);
    return e;
  }
  despawn(id) {
    const e = this.#entities.get(id);
    if (e) e.alive = false;
  }
  removeShip(ship) {
    ship.removed = true;
    ship.alive = false;
  } // the player left
  get(id) {
    return this.#entities.get(id);
  }
  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }
  *ofKind(kind) {
    for (const e of this) if (e.kind === kind) yield e;
  }

  step(dt, inputs = new Map()) {
    this.#stepping = true;
    for (const e of this) {
      e.savePrev();
      if (e.kind === "ship")
        for (const input of inputs.get(e.id) ?? []) e.applyInput(input, dt, this);
      e.update(dt, this);
    }
    for (const [a, b] of findCollisions(this)) this.#collide(a, b);
    this.#sweep();
    this.#stepping = false;
    for (const e of this.#incoming) this.#entities.set(e.id, e);
    this.#incoming.length = 0;
    this.#maintain(dt);
    for (const ship of this.ofKind("ship")) ship.settle();
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #addScore(ownerId, delta, pos) {
    const total = (this.scores.get(ownerId) ?? 0) + delta;
    this.scores.set(ownerId, total);
    this.#emit("score", { owner: ownerId, delta, total, x: pos.x, y: pos.y });
  }

  #collide(a, b) {
    if (!a.alive || !b.alive) return;
    const pair = (x, y) =>
      a.kind === x && b.kind === y ? [a, b] : a.kind === y && b.kind === x ? [b, a] : null;
    let p;
    if ((p = pair("bullet", "ship"))) {
      const [bullet, ship] = p;
      if (bullet.owner === ship.id) return; // no self-hits
      const wasAlive = ship.alive;
      if (ship.damage(bullet.damage)) this.#emit("hit", { x: ship.pos.x, y: ship.pos.y });
      bullet.alive = false;
      if (wasAlive && !ship.alive) this.#addScore(bullet.owner, 50, ship.pos);
    } else if ((p = pair("bullet", "asteroid"))) {
      const [bullet, ast] = p;
      ast.hp -= bullet.damage;
      bullet.alive = false;
      this.#emit("hit", { x: ast.pos.x, y: ast.pos.y });
      if (ast.hp <= 0) {
        ast.alive = false;
        this.#addScore(bullet.owner, 10, ast.pos);
      }
    } else if ((p = pair("ship", "asteroid"))) {
      const [ship] = p;
      if (ship.damage(20)) {
        ship.vel.x *= -0.5;
        ship.vel.y *= -0.5;
      }
    } else if ((p = pair("ship", "pickup"))) {
      const [ship, pickup] = p;
      ship.applyPickup(pickup.type);
      pickup.alive = false;
      this.#emit("pickup", { shipId: ship.id, type: pickup.type, x: pickup.pos.x, y: pickup.pos.y });
    }
  }

  #sweep() {
    for (const e of [...this.#entities.values()]) {
      if (e.alive) continue;
      if (e.kind === "ship") {
        if (!e.removed) {
          this.#emit("exploded", { x: e.pos.x, y: e.pos.y, kind: "ship" });
          this.#respawns.push({ ship: e, t: 2 });
        }
      } else if (e.kind === "asteroid")
        this.#emit("exploded", { x: e.pos.x, y: e.pos.y, kind: "asteroid" });
      this.#entities.delete(e.id);
    }
  }

  #maintain(dt) {
    this.#respawns = this.#respawns.filter((r) => {
      if (r.ship.removed) return false;
      r.t -= dt;
      if (r.t > 0) return true;
      const { x, y } = this.safeSpot();
      r.ship.reset(x, y);
      this.spawn(r.ship); // same entity id: clients keep recognizing the ship
      return false;
    });
    let asteroids = 0;
    let pickups = 0;
    for (const e of this) {
      if (e.kind === "asteroid") asteroids++;
      else if (e.kind === "pickup") pickups++;
    }
    for (; asteroids < this.targetAsteroids; asteroids++) this.#spawnAsteroid();

    if (this.pickupEvery > 0) {
      this.#pickupTimer -= dt;
      if (this.#pickupTimer <= 0 && pickups < 2) {
        const type = PICKUP_TYPES[Math.floor(this.rng() * PICKUP_TYPES.length)];
        this.spawn(new Pickup({ x: this.rand(80, ARENA.width - 80), y: this.rand(80, ARENA.height - 80), type }));
        this.#pickupTimer = this.pickupEvery;
      }
    }
  }

  #spawnAsteroid() {
    const onTop = this.rng() < 0.5;
    const speed = this.rand(30, 80),
      dir = this.rand(0, TAU);
    const a = new Asteroid({
      x: onTop ? this.rand(0, ARENA.width) : 0,
      y: onTop ? 0 : this.rand(0, ARENA.height),
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      radius: this.rand(18, 40),
    });
    if (this.rng() < 0.2) {
      a.behaviors.push(homing({ kinds: ["ship"], turnRate: 0.5 }));
      a.seeker = true;
    }
    this.spawn(a);
  }

  safeSpot() {
    let spot = { x: 0, y: 0 };
    for (let i = 0; i < 10; i++) {
      spot = {
        x: Math.fround(this.rand(100, ARENA.width - 100)),
        y: Math.fround(this.rand(100, ARENA.height - 100)),
      };
      let safe = true;
      for (const a of this.ofKind("asteroid")) {
        if (Math.hypot(a.pos.x - spot.x, a.pos.y - spot.y) < 120 + a.radius) {
          safe = false;
          break;
        }
      }
      if (safe) break;
    }
    return spot;
  }
}
