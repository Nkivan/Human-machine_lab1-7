// Pure netcode logic (no DOM, no WebSocket): testable in Node, used by the browser game.
import { FLAG, TICK_MS } from "@dogfight/shared/protocol/constants";
import { ARENA } from "@dogfight/shared/sim/arena";
import { lerp, lerpAngle } from "@dogfight/shared/sim/math";
import { BULLET_TTL, SHIP_RADIUS, stepShip, TUNING } from "@dogfight/shared/sim/shipmove";

const clone = (s) => ({
  pos: { ...s.pos },
  vel: { ...s.vel },
  angle: s.angle,
  cooldown: s.cooldown,
  rapid: s.rapid,
  thrust: s.thrust,
});
const fromRecord = (r) => ({
  pos: { x: r.x, y: r.y },
  vel: { x: r.vx, y: r.vy },
  angle: r.angle,
  cooldown: r.aux >> 8,
  rapid: r.rapid ?? 0, // the rapid-fire effect changes the fire rate, so the prediction replays it too
  thrust: (r.flags & FLAG.THRUST) !== 0,
});
// Shortest signed distance on a wrapping axis (the arena wraps around).
const wrapDelta = (d, size) => (Math.abs(d) > size / 2 ? d - Math.sign(d) * size : d);
const wrapLerp = (a, b, t, size) => (Math.abs(b - a) > size / 2 ? b : lerp(a, b, t));

// ---------------------------------------------------------------------------------------------------------------
// Prediction + reconciliation for the LOCAL ship.
//  apply():     run the shared stepShip with my own input right now (the ship responds instantly) and remember the input.
//  reconcile(): a snapshot arrived for an OLD tick. Take the server's state, drop the inputs it already applied
//               (seq <= ack), then re-apply every remaining input. If the prediction was right nothing moves.
//  The difference between "where I was" and "where I am after replay" is the correction; it is hidden by decaying it.
// `noise` > 0 deliberately BREAKS determinism (the README experiment): corrections then grow.
// ---------------------------------------------------------------------------------------------------------------
export function createPredictor({ noise = 0 } = {}) {
  let state = null;
  let prev = null;
  let errX = 0;
  let errY = 0;
  const pending = []; // { seq, input }: sent but not yet acknowledged
  const bullets = []; // predicted local bullets: { seq, x, y, vx, vy, ttl }

  const step = (input, dt) => {
    const fired = stepShip(state, input, dt);
    if (noise) state.vel.x += (Math.random() - 0.5) * noise; // <- non-determinism, on purpose
    return fired;
  };

  return {
    get ready() {
      return state !== null;
    },
    get pendingCount() {
      return pending.length;
    },
    get state() {
      return state;
    },
    get predictedBullets() {
      return bullets;
    },

    init(record) {
      state = fromRecord(record);
      prev = clone(state);
      pending.length = 0;
      bullets.length = 0;
      errX = errY = 0;
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
      const fired = step(input, dt);
      if (fired) {
        const c = Math.cos(state.angle),
          s = Math.sin(state.angle);
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
      state = fromRecord(record);
      while (pending.length && pending[0].seq <= ack) pending.shift();
      prev = clone(state);
      for (const p of pending) {
        prev = clone(state);
        step(p.input, dt);
      } // replay the unacknowledged inputs
      if (!before) return 0; // first snapshot (or respawn): nothing to compare with
      const dx = wrapDelta(before.x - state.pos.x, ARENA.width);
      const dy = wrapDelta(before.y - state.pos.y, ARENA.height);
      errX += dx; // smoothing: keep drawing where I WAS and let the error melt away
      errY += dy;
      return Math.hypot(dx, dy);
    },

    // Predicted bullets are replaced by the server's authoritative ones once the server has processed that input.
    stepBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x = (((b.x + b.vx * dt) % ARENA.width) + ARENA.width) % ARENA.width;
        b.y = (((b.y + b.vy * dt) % ARENA.height) + ARENA.height) % ARENA.height;
        b.ttl -= dt;
        if (b.ttl <= 0) bullets.splice(i, 1);
      }
    },
    dropAckedBullets(ack) {
      for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].seq <= ack) bullets.splice(i, 1);
    },

    decayError(dtSec, tau = 0.1) {
      const k = Math.exp(-dtSec / tau);
      errX *= k;
      errY *= k;
    },
    get errorMagnitude() {
      return Math.hypot(errX, errY);
    },

    // Pose to DRAW: interpolate the last two predicted steps by alpha (as in Lab 1) plus the decaying error.
    renderPose(alpha) {
      if (!state) return null;
      return {
        x: wrapLerp(prev.pos.x, state.pos.x, alpha, ARENA.width) + errX,
        y: wrapLerp(prev.pos.y, state.pos.y, alpha, ARENA.height) + errY,
        angle: lerpAngle(prev.angle, state.angle, alpha),
        thrust: state.thrust,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Entity interpolation for REMOTE entities: draw them `delayMs` in the past, between the two snapshots that bracket
// that moment. Time is SERVER time (tick * TICK_MS) so network jitter does not shake the clock.
// ---------------------------------------------------------------------------------------------------------------
export function createInterpolator({ delayMs = 2 * TICK_MS, maxSnapshots = 30 } = {}) {
  const snaps = []; // { t, entities: Map<id, record> }
  let offset = null; // serverTimeMs - localTimeMs, smoothed
  let lastArrival = 0;

  return {
    get delayMs() {
      return delayMs;
    },
    set delayMs(v) {
      delayMs = Math.max(0, Math.min(500, v));
    },
    get size() {
      return snaps.length;
    },

    push(snapshot, nowMs) {
      const t = snapshot.tick * TICK_MS;
      if (snaps.length && t <= snaps[snaps.length - 1].t) {
        if (t < snaps[snaps.length - 1].t - 1000) {
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

    // -> array of records (x, y, angle interpolated); entities that vanished are skipped, new ones appear at once.
    sample(nowMs) {
      if (!snaps.length) return [];
      const rt = nowMs + offset - delayMs;
      let i = snaps.length - 1;
      while (i > 0 && snaps[i - 1].t > rt) i--; // snaps[i-1].t <= rt < snaps[i].t (when i > 0)
      const b = snaps[i];
      const a = i > 0 ? snaps[i - 1] : null;
      if (!a || rt >= b.t) return [...b.entities.values()]; // before the first / after the last snapshot: hold
      const f = (rt - a.t) / (b.t - a.t);
      const out = [];
      for (const rb of b.entities.values()) {
        const ra = a.entities.get(rb.id);
        out.push(
          ra
            ? {
                ...rb,
                x: wrapLerp(ra.x, rb.x, f, ARENA.width),
                y: wrapLerp(ra.y, rb.y, f, ARENA.height),
                angle: lerpAngle(ra.angle, rb.angle, f),
              }
            : rb,
        );
      }
      return out;
    },
  };
}
