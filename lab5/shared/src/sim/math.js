export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest-path angle interpolation (fixes the 359° -> 1° spin bug).
export function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * t;
}
