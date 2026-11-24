function strip(ctx, data, x, y, w, h, max, color) {
  ctx.strokeStyle = "#16203a";
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  const bw = w / 120;
  data.forEach((v, i) => {
    const bh = Math.min(1, v / max) * h;
    ctx.fillRect(x + i * bw, y + h - bh, Math.max(1, bw - 0.5), bh);
  });
}

// The instrument for the whole lab: RTT, snapshot age, bytes/s, pending inputs, correction magnitude.
export function drawNetgraph(ctx, view, { stats, ageMs, pending, interpDelay, status }) {
  const s = stats.data;
  const x = view.cssW - 300;
  ctx.save();
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillStyle = "rgba(5, 7, 13, 0.7)";
  ctx.fillRect(x - 8, 8, 304, 190);
  ctx.fillStyle = "#e6edf7";
  const sim = s.simSettings;
  [
    `net: ${status}`,
    `RTT ${s.rtt.toFixed(0)} ms (jitter ${s.rttJitter.toFixed(0)})`,
    `snapshot age ${ageMs.toFixed(0)} ms   interp delay ${interpDelay.toFixed(0)} ms`,
    `in ${(s.inRate / 1024).toFixed(1)} KB/s   out ${(s.outRate / 1024).toFixed(2)} KB/s`,
    `pending inputs ${pending}`,
    `correction ${s.corrLast.toFixed(3)} px   max/s ${s.corrMax.toFixed(2)} px`,
    `injector: rtt ${sim.latency} ms  jitter ${sim.jitter}  drop ${(sim.drop * 100).toFixed(0)}%`,
  ].forEach((t, i) => ctx.fillText(t, x, 26 + i * 16));
  ctx.fillStyle = "#7d88a8";
  ctx.fillText("RTT", x, 148);
  strip(ctx, s.rttHistory, x + 30, 138, 250, 20, 300, "#3b6cff");
  ctx.fillStyle = "#7d88a8";
  ctx.fillText("corr", x, 176);
  strip(ctx, s.corrHistory, x + 30, 164, 250, 20, 20, "#ff6b6b");
  ctx.fillStyle = "#7d88a8";
  ctx.fillText("L = injector  [ ] = interp delay  N = netgraph", x - 8, 214);
  ctx.restore();
}
