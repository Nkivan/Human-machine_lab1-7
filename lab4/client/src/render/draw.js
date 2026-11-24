import { ARENA } from "../sim/arena.js";
import { lerp, lerpAngle } from "../sim/math.js";

export function drawBackground(ctx, view) {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, view.cssW, view.cssH);
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  ctx.fillStyle = "#0a0f1c";
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  ctx.strokeStyle = "#16203a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ARENA.width; x += 80) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA.height);
  }
  for (let y = 0; y <= ARENA.height; y += 80) {
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA.width, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#2c3e6b";
  ctx.strokeRect(0, 0, ARENA.width, ARENA.height);
  ctx.restore();
}

function pose(e, alpha) {
  const wx = Math.abs(e.pos.x - e.prevPos.x) > ARENA.width / 2;
  const wy = Math.abs(e.pos.y - e.prevPos.y) > ARENA.height / 2;
  return {
    x: wx ? e.pos.x : lerp(e.prevPos.x, e.pos.x, alpha),
    y: wy ? e.pos.y : lerp(e.prevPos.y, e.pos.y, alpha),
    angle: lerpAngle(e.prevAngle, e.angle, alpha),
  };
}

// sprites = { sheet: ImageBitmap, frames: { name: [sx, sy, sw, sh] } }
function sprite(ctx, sprites, name, size) {
  const f = sprites.frames[name];
  if (f) ctx.drawImage(sprites.sheet, f[0], f[1], f[2], f[3], -size / 2, -size / 2, size, size);
}

export function drawEntities(ctx, view, world, alpha, time, sprites) {
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  for (const e of world) {
    if (e.kind === "explosion") {
      ctx.fillStyle = "#ff9d2e";
      for (const q of e.particles) {
        if (q.life <= 0) continue;
        ctx.globalAlpha = Math.min(1, q.life * 2);
        ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      continue;
    }
    const p = pose(e, alpha);
    if (e.kind === "ship" && e.invuln > 0 && Math.floor(time / 80) % 2 === 0) continue; // blink
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    if (e.kind === "ship") {
      if (e.thrust) {
        const len = 14 + Math.sin(time / 30) * 5;
        ctx.fillStyle = "#ff9d2e";
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(-10 - len, 0);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
      }
      sprite(ctx, sprites, e.isDrone ? "drone" : "ship", 46);
      if (e.shield > 0) {
        ctx.strokeStyle = "#4fd1ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (e.kind === "asteroid") {
      ctx.rotate(-p.angle + e.id); // asteroids tumble by id, not by heading
      sprite(ctx, sprites, "asteroid", e.radius * 2.2);
      if (e.seeker) {
        ctx.strokeStyle = "#ff6b6b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (e.kind === "bullet") {
      sprite(ctx, sprites, e.behaviors.length ? "bullet_homing" : "bullet", 14);
    } else if (e.kind === "pickup") {
      ctx.rotate(-p.angle);
      sprite(ctx, sprites, `pickup_${e.type}`, 30);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawHud(ctx, stats, extra = []) {
  ctx.save();
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = stats.frameMs > 16.7 * 1.5 ? "#ff6b6b" : "#9be28f";
  [
    `steps/s : ${stats.stepsPerSec.toFixed(1)}`,
    `frames/s: ${stats.fps.toFixed(1)}`,
    `frame ms: ${stats.frameMs.toFixed(1)}`,
  ].forEach((t, i) => ctx.fillText(t, 12, 22 + i * 18));
  ctx.fillStyle = "#e6edf7";
  extra.forEach((t, i) => ctx.fillText(t, 12, 82 + i * 18));
  ctx.restore();
}
