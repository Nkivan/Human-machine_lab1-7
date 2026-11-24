import { ARENA } from "../sim/arena.js";

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

// Ship is drawn at the origin pointing right (+x); the transform stack places it.
export function drawShip(ctx, view, pose, thrusting, time) {
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);

  if (thrusting) {
    const len = 14 + Math.sin(time / 30) * 5;
    ctx.fillStyle = "#ff9d2e";
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(-10 - len, 0);
    ctx.lineTo(-10, 5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#cfe3ff";
  ctx.strokeStyle = "#6ea8ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -11);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawHud(ctx, stats) {
  ctx.save();
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = stats.frameMs > 16.7 * 1.5 ? "#ff6b6b" : "#9be28f";
  const lines = [
    `steps/s : ${stats.stepsPerSec.toFixed(1)}`,
    `frames/s: ${stats.fps.toFixed(1)}`,
    `frame ms: ${stats.frameMs.toFixed(1)}`,
  ];
  lines.forEach((t, i) => ctx.fillText(t, 12, 22 + i * 18));
  ctx.restore();
}
