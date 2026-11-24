import { ARENA } from "../sim/arena.js";

// DPR-aware canvas; world (ARENA) is scaled to fit the window, letterboxed.
export function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const view = { scale: 1, offsetX: 0, offsetY: 0, cssW: 0, cssH: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    view.cssW = window.innerWidth;
    view.cssH = window.innerHeight;
    canvas.width = Math.round(view.cssW * dpr);
    canvas.height = Math.round(view.cssH * dpr);
    view.scale = Math.min(view.cssW / ARENA.width, view.cssH / ARENA.height);
    view.offsetX = (view.cssW - ARENA.width * view.scale) / 2;
    view.offsetY = (view.cssH - ARENA.height * view.scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();
  return { ctx, view };
}
