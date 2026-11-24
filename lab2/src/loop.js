// Fixed-timestep loop (Fiedler, "Fix Your Timestep!") on top of requestAnimationFrame.
export function createLoop({ step = 1 / 60, maxFrame = 0.25, simulate, render }) {
  let acc = 0;
  let last = 0;
  let rafId = 0;
  let running = false;

  // stats window (1 s)
  let windowStart = 0;
  let stepCount = 0;
  let frameCount = 0;
  const stats = { stepsPerSec: 0, fps: 0, frameMs: 0 };

  function frame(now) {
    if (!running) return;
    const dtMs = Math.max(0, now - last);
    last = now;
    stats.frameMs = dtMs;

    acc += Math.min(dtMs / 1000, maxFrame); // clamp: no spiral of death after a hitch
    while (acc >= step) {
      simulate(step);
      acc -= step;
      stepCount++;
    }
    frameCount++;

    if (now - windowStart >= 1000) {
      const elapsed = (now - windowStart) / 1000;
      stats.stepsPerSec = stepCount / elapsed;
      stats.fps = frameCount / elapsed;
      stepCount = 0;
      frameCount = 0;
      windowStart = now;
    }

    render(acc / step, stats); // alpha in [0, 1)
    rafId = requestAnimationFrame(frame);
  }

  return {
    stats,
    start() {
      if (running) return;
      running = true;
      last = windowStart = performance.now();
      acc = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
