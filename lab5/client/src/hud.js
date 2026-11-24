// Floating "+10" popups. Subscribes to the world's "score" event; the sim never imports this.
export function createHud(world) {
  let popups = [];
  world.addEventListener("score", (e) => {
    const { delta, x, y } = e.detail;
    popups.push({ text: `+${delta}`, x, y, born: performance.now() });
  });
  world.addEventListener("pickup", (e) => {
    const { type, x, y } = e.detail;
    popups.push({ text: type.toUpperCase(), x, y, born: performance.now() }); // "SHIELD", "RAPID", "HOMING"
  });
  return {
    draw(ctx, view, now) {
      popups = popups.filter((p) => now - p.born < 900);
      ctx.save();
      ctx.translate(view.offsetX, view.offsetY);
      ctx.scale(view.scale, view.scale);
      ctx.font = "bold 18px ui-monospace, monospace";
      ctx.textAlign = "center";
      for (const p of popups) {
        const t = (now - p.born) / 900;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "#ffe27a";
        ctx.fillText(p.text, p.x, p.y - 20 - t * 30);
      }
      ctx.restore();
    },
  };
}
