// A separate SYSTEM: takes the world, returns pairs. Swap for a spatial hash in Lab 7 without touching anything else.
const SOLID = new Set(["ship", "bullet", "asteroid", "pickup"]);

export function findCollisions(world) {
  const list = [];
  for (const e of world) if (e.alive && SOLID.has(e.kind)) list.push(e);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      // naive O(n^2) for now
      const a = list[i],
        b = list[j];
      const r = a.radius + b.radius;
      const dx = a.pos.x - b.pos.x,
        dy = a.pos.y - b.pos.y;
      if (dx * dx + dy * dy <= r * r) pairs.push([a, b]);
    }
  }
  return pairs;
}
