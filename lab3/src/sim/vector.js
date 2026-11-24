// Immutable-style 2D vector: methods return NEW vectors (a.add(b) never mutates a).
// addScaledInPlace is the one hot-path exception.
export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  clone() { return new Vector2(this.x, this.y); }
  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  scale(k) { return new Vector2(this.x * k, this.y * k); }
  length() { return Math.hypot(this.x, this.y); }
  normalize() { const l = this.length(); return l === 0 ? new Vector2() : this.scale(1 / l); }
  rotate(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  dot(v) { return this.x * v.x + this.y * v.y; }
  static fromAngle(a, len = 1) { return new Vector2(Math.cos(a) * len, Math.sin(a) * len); }
  addScaledInPlace(v, k) { this.x += v.x * k; this.y += v.y * k; return this; }
}
