import { ARENA } from "@dogfight/shared/sim/arena";
import { FLAG, KIND } from "@dogfight/shared/protocol/constants";
import { PICKUP_TYPES } from "@dogfight/shared/sim/pickup";

function sprite(ctx, sprites, name, size) {
  const f = sprites.frames[name];
  if (f) ctx.drawImage(sprites.sheet, f[0], f[1], f[2], f[3], -size / 2, -size / 2, size, size);
}

// items: [{ kind: "ship"|"bullet"|"asteroid", x, y, angle, ... }] built by game.js from snapshots + prediction.
export function drawWorld(ctx, view, items, particles, sprites, time) {
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  for (const it of items) {
    ctx.save();
    ctx.translate(it.x, it.y);
    if (it.kind === "asteroid") {
      ctx.rotate(it.id);
      sprite(ctx, sprites, "asteroid", it.radius * 2.2);
      if (it.seeker) {
        ctx.strokeStyle = "#ff6b6b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, it.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (it.kind === "bullet") {
      sprite(ctx, sprites, it.homing ? "bullet_homing" : "bullet", 14);
    } else if (it.kind === "pickup") {
      sprite(ctx, sprites, `pickup_${it.type}`, 30);
    } else if (it.kind === "ship") {
      if (it.invuln && Math.floor(time / 80) % 2 === 0) {
        ctx.restore();
        continue;
      } // blink while invulnerable
      ctx.rotate(it.angle);
      if (it.thrust) {
        const len = 14 + Math.sin(time / 30) * 5;
        ctx.fillStyle = "#ff9d2e";
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(-10 - len, 0);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
      }
      sprite(ctx, sprites, it.me ? "ship" : "drone", 46);
      if (it.shield) {
        ctx.strokeStyle = "#4fd1ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.fillStyle = "#ff9d2e";
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Snapshot record -> draw item
export function toItem(r, myId) {
  if (r.kind === KIND.SHIP)
    return {
      kind: "ship",
      id: r.id,
      x: r.x,
      y: r.y,
      angle: r.angle,
      thrust: (r.flags & FLAG.THRUST) !== 0,
      invuln: (r.flags & FLAG.INVULN) !== 0,
      shield: r.shield > 0,
      me: r.id === myId,
    };
  if (r.kind === KIND.BULLET)
    return { kind: "bullet", id: r.id, x: r.x, y: r.y, mine: r.aux === myId, homing: (r.flags & FLAG.HOMING) !== 0 };
  if (r.kind === KIND.PICKUP)
    return { kind: "pickup", id: r.id, x: r.x, y: r.y, type: PICKUP_TYPES[r.aux - 1] };
  return {
    kind: "asteroid",
    id: r.id,
    x: r.x,
    y: r.y,
    radius: r.aux / 10,
    seeker: (r.flags & FLAG.SEEKER) !== 0,
  };
}

export const ARENA_SIZE = ARENA;
