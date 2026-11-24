// Canvas loading screen. It keeps animating while assets load: proof the thread is NOT blocked.
function draw(ctx, view, title, progress, detail, isError) {
  const { cssW: w, cssH: h } = view;
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = isError ? "#ff6b6b" : "#e6edf7";
  ctx.fillText(title, w / 2, h / 2 - 28);
  if (!isError) {
    const bw = Math.min(420, w * 0.7),
      x = (w - bw) / 2,
      y = h / 2;
    ctx.strokeStyle = "#2c3e6b";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, 16);
    ctx.fillStyle = "#3b6cff";
    ctx.fillRect(x + 2, y + 2, (bw - 4) * progress, 12);
    ctx.fillStyle = "#7d88a8";
    ctx.fillText(`${Math.round(progress * 100)}%  ${detail}`, w / 2, y + 40);
  } else {
    ctx.fillStyle = "#9be28f";
    ctx.fillText("click to retry", w / 2, h / 2 + 8);
    ctx.fillStyle = "#7d88a8";
    ctx.fillText(detail.slice(0, 80), w / 2, h / 2 + 36);
  }
}

// start({ signal, onProgress, abort }) must return a promise. On failure: show the error, wait for a click, retry.
export async function loadWithScreen({ canvas, ctx, view, start }) {
  for (;;) {
    const ctrl = new AbortController();
    const state = { progress: 0, label: "manifest" };
    let raf = 0;
    const tick = () => {
      draw(ctx, view, "Loading...", state.progress, state.label, false);
      raf = requestAnimationFrame(tick);
    };
    tick();
    try {
      return await start({
        signal: ctrl.signal,
        abort: () => ctrl.abort(),
        onProgress: (p, label) => {
          state.progress = p;
          state.label = label;
        },
      });
    } catch (err) {
      cancelAnimationFrame(raf); // stop the progress animation BEFORE drawing the error
      const title = err.name === "AbortError" ? "Loading cancelled" : "Loading failed";
      draw(ctx, view, title, 0, `${err.name}: ${err.message}`, true);
      await new Promise((resolve) => canvas.addEventListener("click", resolve, { once: true })); // event -> promise
    } finally {
      cancelAnimationFrame(raf);
    }
  }
}
