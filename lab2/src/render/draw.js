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
  for (let x = 0; x <= ARENA.width; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.height); }
  for (let y = 0; y <= ARENA.height; y += 80) { ctx.moveTo(0, y); ctx.lineTo(ARENA.width, y); }
  ctx.stroke();
  ctx.strokeStyle = "#2c3e6b";
  ctx.strokeRect(0, 0, ARENA.width, ARENA.height);
  ctx.restore();
}

// Interpolate between previous and current state; skip across a wrap-around.
function pose(e, alpha) {
  const wx = Math.abs(e.pos.x - e.prevPos.x) > ARENA.width / 2;
  const wy = Math.abs(e.pos.y - e.prevPos.y) > ARENA.height / 2;
  return {
    x: wx ? e.pos.x : lerp(e.prevPos.x, e.pos.x, alpha),
    y: wy ? e.pos.y : lerp(e.prevPos.y, e.pos.y, alpha),
    angle: lerpAngle(e.prevAngle, e.angle, alpha),
  };
}

const PICKUP_COLOR = { shield: "#4fd1ff", rapid: "#ffd24f", homing: "#ff6bd5" };

function drawShip(ctx, e, p, time) {
  if (e.invuln > 0 && Math.floor(time / 80) % 2 === 0) return; // blink while invulnerable
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  if (e.thrust) {
    const len = 14 + Math.sin(time / 30) * 5;
    ctx.fillStyle = "#ff9d2e";
    ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-10 - len, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = e.isDrone ? "#ffb3b3" : "#cfe3ff";
  ctx.strokeStyle = e.isDrone ? "#ff6b6b" : "#6ea8ff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, -11); ctx.lineTo(-6, 0); ctx.lineTo(-12, 11); ctx.closePath();
  ctx.fill(); ctx.stroke();
  if (e.shield > 0) {
    ctx.strokeStyle = "#4fd1ff";
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawAsteroid(ctx, e, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = e.seeker ? "#ff6b6b" : "#8a93a8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = e.radius * (0.8 + 0.2 * Math.abs(Math.sin(e.id * 12.9898 + i * 78.233)));
    const a = (i / 10) * Math.PI * 2;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

export function drawEntities(ctx, view, world, alpha, time) {
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
    if (e.kind === "ship") drawShip(ctx, e, p, time);
    else if (e.kind === "asteroid") drawAsteroid(ctx, e, p);
    else if (e.kind === "bullet") {
      ctx.fillStyle = e.behaviors.length ? "#ff6bd5" : "#ffe27a";
      ctx.beginPath(); ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2); ctx.fill();
    } else if (e.kind === "pickup") {
      ctx.strokeStyle = ctx.fillStyle = PICKUP_COLOR[e.type];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(e.type[0].toUpperCase(), p.x, p.y + 1);
    }
  }
  ctx.restore();
}

export function drawHud(ctx, stats, extra = []) {
  ctx.save();
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = stats.frameMs > 16.7 * 1.5 ? "#ff6b6b" : "#9be28f";
  [`steps/s : ${stats.stepsPerSec.toFixed(1)}`, `frames/s: ${stats.fps.toFixed(1)}`, `frame ms: ${stats.frameMs.toFixed(1)}`]
    .forEach((t, i) => ctx.fillText(t, 12, 22 + i * 18));
  ctx.fillStyle = "#e6edf7";
  extra.forEach((t, i) => ctx.fillText(t, 12, 82 + i * 18));
  ctx.restore();
}
