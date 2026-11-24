// Latency injector. On localhost everything feels perfect, so we make the network worse ON PURPOSE.
//   latency = target ROUND-TRIP time (ms): each direction gets half of it
//   jitter  = random extra delay per message (ms, per direction)
//   drop    = probability of losing a droppable message (inputs and snapshots; control messages are never dropped)
// Delivery stays IN ORDER (like TCP): a message is never delivered before the one sent earlier.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

export function parseNetsim(params) {
  return {
    latency: clamp(Number(params.get("lat")), 0, 1000),
    jitter: clamp(Number(params.get("jitter")), 0, 500),
    drop: clamp(Number(params.get("drop")), 0, 0.5),
  };
}

export function createNetsim(initial = {}, random = Math.random) {
  const settings = { latency: 0, jitter: 0, drop: 0, ...initial };
  const lane = () => {
    let lastAt = 0;
    return (fn, { droppable = false } = {}) => {
      if (droppable && random() < settings.drop) return;
      const now = performance.now();
      const at = Math.max(lastAt, now + settings.latency / 2 + random() * settings.jitter);
      lastAt = at;
      if (at - now < 1) fn();
      else setTimeout(fn, at - now);
    };
  };
  return {
    settings,
    set(next) {
      Object.assign(settings, next);
    },
    in: lane(), // client -> server
    out: lane(), // server -> client
  };
}
