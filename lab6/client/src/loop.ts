export interface LoopStats {
  stepsPerSec: number;
  fps: number;
  frameMs: number;
}
export interface LoopOptions {
  readonly step?: number;
  readonly maxFrame?: number;
  simulate(dt: number): void;
  render(alpha: number, stats: LoopStats): void; // alpha in [0, 1): how far we are between two simulation steps
}
export interface Loop {
  readonly stats: LoopStats;
  start(): void;
  stop(): void;
}

// Fixed-timestep loop (Fiedler, "Fix Your Timestep!") on top of requestAnimationFrame.
export function createLoop({ step = 1 / 60, maxFrame = 0.25, simulate, render }: LoopOptions): Loop {
  let acc = 0;
  let last = 0;
  let rafId = 0;
  let running = false;
  let windowStart = 0;
  let stepCount = 0;
  let frameCount = 0;
  const stats: LoopStats = { stepsPerSec: 0, fps: 0, frameMs: 0 };

  function frame(now: number): void {
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

    render(acc / step, stats);
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
