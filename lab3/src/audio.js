// Owns the AudioContext. The sim never imports this: audio SUBSCRIBES to world events.
export function createAudio() {
  const ctx = new AudioContext(); // starts "suspended" until a user gesture
  const buffers = new Map();
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  const unlock = () => { if (ctx.state === "suspended") ctx.resume(); };
  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, unlock);

  function play(name) {
    const buffer = buffers.get(name);
    if (!buffer || ctx.state !== "running") return;
    const src = ctx.createBufferSource(); // one-shot node per playback (cheap, allows overlap)
    src.buffer = buffer;
    src.connect(master);
    src.start();
  }

  return {
    ctx,
    play,
    setBuffers(map) { for (const [name, buffer] of Object.entries(map)) if (buffer) buffers.set(name, buffer); },
    attach(world) {
      world.addEventListener("fired", () => play("shoot"));
      world.addEventListener("hit", () => play("hit"));
      world.addEventListener("exploded", () => play("explosion"));
    },
  };
}
