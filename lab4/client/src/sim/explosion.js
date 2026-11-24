import { Entity } from "./entity.js";

// Many short-lived particles (remember this for Lab 7 profiling).
export class Explosion extends Entity {
  constructor(x, y, rng) {
    super({ x, y, radius: 0, kind: "explosion" });
    this.particles = Array.from({ length: 24 }, () => {
      const a = rng() * Math.PI * 2,
        s = 40 + rng() * 220;
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + rng() * 0.5 };
    });
  }
  update(dt) {
    let any = false;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      any = true;
    }
    if (!any) this.alive = false;
  }
}
