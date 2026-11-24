export const ARENA = { width: 1280, height: 720 };

export function wrapPos(p) {
  p.x = ((p.x % ARENA.width) + ARENA.width) % ARENA.width;
  p.y = ((p.y % ARENA.height) + ARENA.height) % ARENA.height;
}
