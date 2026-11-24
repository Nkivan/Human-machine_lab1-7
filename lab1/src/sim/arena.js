export const ARENA = { width: 1280, height: 720 };

export function wrap(ship) {
  if (ship.x < 0) ship.x += ARENA.width;
  else if (ship.x >= ARENA.width) ship.x -= ARENA.width;
  if (ship.y < 0) ship.y += ARENA.height;
  else if (ship.y >= ARENA.height) ship.y -= ARENA.height;
}
