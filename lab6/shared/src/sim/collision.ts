import type { AnyEntity, World } from "./world.ts";

// A separate SYSTEM: takes the world, returns pairs. Swap for a spatial hash later without touching anything else.
export function findCollisions(world: World): [AnyEntity, AnyEntity][] {
  const list: AnyEntity[] = [];
  for (const e of world) if (e.alive) list.push(e);
  const pairs: [AnyEntity, AnyEntity][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      // naive O(n^2) for now
      const a = list[i];
      const b = list[j];
      if (!a || !b) continue; // noUncheckedIndexedAccess: indexing can be undefined, even inside a loop
      const r = a.radius + b.radius;
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      if (dx * dx + dy * dy <= r * r) pairs.push([a, b]);
    }
  }
  return pairs;
}
