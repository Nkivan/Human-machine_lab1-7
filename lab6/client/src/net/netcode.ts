// Pure netcode logic (no DOM, no WebSocket): testable in Node, used by the browser game.
import { TICK_MS } from "@dogfight/shared/protocol/constants";
import type { EntityId, Seq } from "@dogfight/shared/protocol/ids";
import type { EntityRecord, ShipRecord, Snapshot } from "@dogfight/shared/protocol/messages";
import { ARENA } from "@dogfight/shared/sim/arena";
import { lerp, lerpAngle } from "@dogfight/shared/sim/math";
import {
  BULLET_TTL,
  SHIP_RADIUS,
  stepShip,
  TUNING,
  type ShipBody,
  type ShipCommand,
} from "@dogfight/shared/sim/shipmove";

const clone = (s: ShipBody): ShipBody => ({
  pos: { ...s.pos },
  vel: { ...s.vel },
  angle: s.angle,
  cooldown: s.cooldown, rapid: s.rapid,
  thrust: s.thrust,
});
const fromRecord = (r: ShipRecord): ShipBody => ({
  pos: { x: r.x, y: r.y },
  vel: { x: r.vx, y: r.vy },
  angle: r.angle,
  cooldown: r.cooldown, rapid: r.rapid,
  thrust: r.thrust,
});
// Shortest signed distance on a wrapping axis (the arena wraps around).
const wrapDelta = (d: number, size: number): number => (Math.abs(d) > size / 2 ? d - Math.sign(d) * size : d);
const wrapLerp = (a: number, b: number, t: number, size: number): number =>
  Math.abs(b - a) > size / 2 ? b : lerp(a, b, t);
const wrapInto = (v: number, size: number): number => ((v % size) + size) % size;

export interface PredictedBullet {
  readonly seq: Seq;
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  ttl: number;
}
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly thrust: boolean;
}
export interface PredictorOptions {
  readonly noise?: number; // > 0 deliberately BREAKS determinism (the README experiment): corrections then grow
}
export interface Predictor {
  readonly ready: boolean;
  readonly pendingCount: number;
  readonly predictedBullets: readonly PredictedBullet[];
  readonly errorMagnitude: number;
  clear(): void;
  apply(seq: Seq, input: ShipCommand, dt: number): boolean;
  reconcile(record: ShipRecord, ack: Seq, dt: number): number;
  stepBullets(dt: number): void;
  dropAckedBullets(ack: Seq): void;
  decayError(dtSec: number, tau?: number): void;
  renderPose(alpha: number): Pose | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Prediction + reconciliation for the LOCAL ship.
//  apply():     run the shared stepShip with my own input right now (the ship responds instantly) and remember the input.
//  reconcile(): a snapshot arrived for an OLD tick. Take the server's state, drop the inputs it already applied
//               (seq <= ack), then re-apply every remaining input. If the prediction was right nothing moves.
//  The difference between "where I was" and "where I am after replay" is the correction; it is hidden by decaying it.
// ---------------------------------------------------------------------------------------------------------------
export function createPredictor({ noise = 0 }: PredictorOptions = {}): Predictor {
  let state: ShipBody | null = null;
  let prev: ShipBody | null = null;
  let errX = 0;
  let errY = 0;
  const pending: { seq: Seq; input: ShipCommand }[] = []; // sent but not yet acknowledged
  const bullets: PredictedBullet[] = []; // predicted local bullets

  const step = (body: ShipBody, input: ShipCommand, dt: number): boolean => {
    const fired = stepShip(body, input, dt);
    if (noise) body.vel.x += (Math.random() - 0.5) * noise; // <- non-determinism, on purpose
    return fired;
  };

  return {
    get ready() {
      return state !== null;
    },
    get pendingCount() {
      return pending.length;
    },
    get predictedBullets() {
      return bullets;
    },
    get errorMagnitude() {
      return Math.hypot(errX, errY);
    },

    clear() {
      state = null;
      prev = null;
      pending.length = 0;
      bullets.length = 0;
      errX = errY = 0;
    },

    apply(seq, input, dt) {
      pending.push({ seq, input }); // ALWAYS remember it: before the first snapshot there is no state yet, but the
      if (pending.length > 120) pending.shift(); // replay after the first reconcile needs these inputs. (Bounded while dead.)
      if (!state) return false;
      prev = clone(state);
      const fired = step(state, input, dt);
      if (fired) {
        const c = Math.cos(state.angle);
        const s = Math.sin(state.angle);
        bullets.push({
          seq,
          x: state.pos.x + c * (SHIP_RADIUS + 4),
          y: state.pos.y + s * (SHIP_RADIUS + 4),
          vx: state.vel.x + c * TUNING.bulletSpeed,
          vy: state.vel.y + s * TUNING.bulletSpeed,
          ttl: BULLET_TTL,
        });
      }
      return fired;
    },

    // Returns the correction magnitude in pixels.
    reconcile(record, ack, dt) {
      const before = state ? { x: state.pos.x, y: state.pos.y } : null;
      const next = fromRecord(record);
      while (pending[0] && pending[0].seq <= ack) pending.shift();
      prev = clone(next);
      for (const p of pending) {
        prev = clone(next);
        step(next, p.input, dt);
      } // replay the unacknowledged inputs
      state = next;
      if (!before) return 0; // first snapshot (or respawn): nothing to compare with
      const dx = wrapDelta(before.x - next.pos.x, ARENA.width);
      const dy = wrapDelta(before.y - next.pos.y, ARENA.height);
      errX += dx; // smoothing: keep drawing where I WAS and let the error melt away
      errY += dy;
      return Math.hypot(dx, dy);
    },

    stepBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (!b) continue;
        b.x = wrapInto(b.x + b.vx * dt, ARENA.width);
        b.y = wrapInto(b.y + b.vy * dt, ARENA.height);
        b.ttl -= dt;
        if (b.ttl <= 0) bullets.splice(i, 1);
      }
    },
    // Predicted bullets are replaced by the server's authoritative ones once the server has processed that input.
    dropAckedBullets(ack) {
      for (let i = bullets.length - 1; i >= 0; i--) if ((bullets[i]?.seq ?? Infinity) <= ack) bullets.splice(i, 1);
    },

    decayError(dtSec, tau = 0.1) {
      const k = Math.exp(-dtSec / tau);
      errX *= k;
      errY *= k;
    },

    // Pose to DRAW: interpolate the last two predicted steps by alpha plus the decaying error.
    renderPose(alpha) {
      if (!state || !prev) return null;
      return {
        x: wrapLerp(prev.pos.x, state.pos.x, alpha, ARENA.width) + errX,
        y: wrapLerp(prev.pos.y, state.pos.y, alpha, ARENA.height) + errY,
        angle: lerpAngle(prev.angle, state.angle, alpha),
        thrust: state.thrust,
      };
    },
  };
}

export interface Interpolator {
  delayMs: number;
  readonly size: number;
  push(snapshot: Snapshot, nowMs: number): void;
  ageMs(nowMs: number): number;
  sample(nowMs: number): EntityRecord[];
}

function lerpRecord(ra: EntityRecord, rb: EntityRecord, f: number): EntityRecord {
  return {
    ...rb,
    x: wrapLerp(ra.x, rb.x, f, ARENA.width),
    y: wrapLerp(ra.y, rb.y, f, ARENA.height),
    angle: lerpAngle(ra.angle, rb.angle, f),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Entity interpolation for REMOTE entities: draw them `delayMs` in the past, between the two snapshots that bracket
// that moment. Time is SERVER time (tick * TICK_MS) so network jitter does not shake the clock.
// ---------------------------------------------------------------------------------------------------------------
export function createInterpolator({ delayMs: initialDelay = 2 * TICK_MS, maxSnapshots = 30 } = {}): Interpolator {
  const snaps: { t: number; entities: Map<EntityId, EntityRecord> }[] = [];
  let delay = initialDelay;
  let offset: number | null = null; // serverTimeMs - localTimeMs, smoothed
  let lastArrival = 0;

  return {
    get delayMs() {
      return delay;
    },
    set delayMs(v: number) {
      delay = Math.max(0, Math.min(500, v));
    },
    get size() {
      return snaps.length;
    },

    push(snapshot, nowMs) {
      const t = snapshot.tick * TICK_MS;
      const newest = snaps[snaps.length - 1];
      if (newest && t <= newest.t) {
        if (t < newest.t - 1000) {
          snaps.length = 0;
          offset = null;
        } // server restarted: forget the past
        else return; // duplicate / out of order
      }
      const sample = t - nowMs;
      offset = offset === null ? sample : offset + (sample - offset) * 0.05;
      lastArrival = nowMs;
      snaps.push({ t, entities: new Map(snapshot.entities.map((e) => [e.id, e])) });
      if (snaps.length > maxSnapshots) snaps.shift();
    },

    ageMs(nowMs) {
      return lastArrival ? nowMs - lastArrival : 0;
    },

    // Entities that vanished are skipped, new ones appear at once.
    sample(nowMs) {
      if (!snaps.length || offset === null) return [];
      const rt = nowMs + offset - delay;
      let i = snaps.length - 1;
      while (i > 0 && (snaps[i - 1]?.t ?? 0) > rt) i--; // snaps[i-1].t <= rt < snaps[i].t (when i > 0)
      const b = snaps[i];
      if (!b) return [];
      const a = i > 0 ? snaps[i - 1] : undefined;
      if (!a || rt >= b.t) return [...b.entities.values()]; // before the first / after the last snapshot: hold
      const f = (rt - a.t) / (b.t - a.t);
      const out: EntityRecord[] = [];
      for (const rb of b.entities.values()) {
        const ra = a.entities.get(rb.id);
        out.push(ra ? lerpRecord(ra, rb, f) : rb);
      }
      return out;
    },
  };
}
