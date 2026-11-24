import path from "node:path";

// All configuration comes from the environment, validated and defaulted in ONE place.
function int(env, name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${name}: "${raw}" (integer ${min}..${max})`);
  return n;
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  return {
    port: int(env, "PORT", 3000, { max: 65535 }),
    host: env.HOST || "127.0.0.1",
    logDir: path.resolve(env.LOG_DIR || "./logs"),
    staticDir: path.resolve(env.STATIC_DIR || "../client/dist"),
    debugRoutes: env.DEBUG_ROUTES === "1",
    seedRooms: env.SEED_ROOMS !== "0",
    maxRooms: int(env, "MAX_ROOMS", 20, { min: 1 }),
    maxPlayersPerRoom: int(env, "MAX_PLAYERS", 4, { min: 1 }),
    msgPerSec: int(env, "MSG_PER_SEC", 10, { min: 1 }),
    msgBurst: int(env, "MSG_BURST", 20, { min: 1 }),
    maxPayload: int(env, "MAX_PAYLOAD", 2048, { min: 64 }),
    bufferLimit: int(env, "BUFFER_LIMIT", 64 * 1024, { min: 1024 }), // slow-client threshold (bytes)
    heartbeatMs: int(env, "HEARTBEAT_MS", 15000, { min: 50 }),
    joinTimeoutMs: int(env, "JOIN_TIMEOUT_MS", 5000, { min: 50 }),
  };
}
