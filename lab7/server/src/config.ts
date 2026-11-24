import path from "node:path";
import { z } from "zod";

// ALL configuration comes from the environment, parsed ONCE by this schema (types inferred, defaults in one place).
const flag = z.enum(["0", "1"]).transform((v) => v === "1");
const int = (min: number, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max);

const Env = z.object({
  PORT: int(0, 65535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_DIR: z.string().min(1).default("./logs"),
  STATIC_DIR: z.string().min(1).default("../client/dist"),
  DEBUG_ROUTES: flag.default(false),
  SEED_ROOMS: flag.default(true),
  SNAPSHOT_CODEC: z.enum(["binary", "json"]).default("binary"),
  MAX_ROOMS: int(1).default(20),
  MAX_PLAYERS: int(1).default(4),
  MAX_BOTS: int(0, 128).default(16),
  TICK_STATS_WINDOW: int(30, 100_000).default(300), // ticks kept for the p50/p95/p99 in /api/stats (300 = 10 s) // per room (Lab 7); bots do not count against MAX_PLAYERS
  MSG_PER_SEC: int(1).default(10),
  MSG_BURST: int(1).default(20),
  BIN_PER_SEC: int(1).default(60), // binary frames: 30 inputs/s + pings
  BIN_BURST: int(1).default(120),
  MAX_PAYLOAD: int(64).default(2048),
  BUFFER_LIMIT: int(1024).default(64 * 1024), // slow-client threshold (bytes)
  HEARTBEAT_MS: int(50).default(15000),
  JOIN_TIMEOUT_MS: int(50).default(5000),
});

export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly logDir: string;
  readonly staticDir: string;
  readonly debugRoutes: boolean;
  readonly seedRooms: boolean;
  readonly snapshotCodec: "binary" | "json";
  readonly maxRooms: number;
  readonly maxPlayersPerRoom: number;
  readonly maxBotsPerRoom: number;
  readonly tickStatsWindow: number;
  readonly msgPerSec: number;
  readonly msgBurst: number;
  readonly binPerSec: number;
  readonly binBurst: number;
  readonly maxPayload: number;
  readonly bufferLimit: number;
  readonly heartbeatMs: number;
  readonly joinTimeoutMs: number;
}

export type EnvVars = Readonly<Record<string, string | undefined>>;

export function loadConfig(overrides: EnvVars = {}): ServerConfig {
  const merged = { ...process.env, ...overrides };
  // an empty variable means "not set"
  const env = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`); // fail fast at startup, never run half-configured
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    logDir: path.resolve(e.LOG_DIR),
    staticDir: path.resolve(e.STATIC_DIR),
    debugRoutes: e.DEBUG_ROUTES,
    seedRooms: e.SEED_ROOMS,
    snapshotCodec: e.SNAPSHOT_CODEC,
    maxRooms: e.MAX_ROOMS,
    maxPlayersPerRoom: e.MAX_PLAYERS,
    maxBotsPerRoom: e.MAX_BOTS,
    tickStatsWindow: e.TICK_STATS_WINDOW,
    msgPerSec: e.MSG_PER_SEC,
    msgBurst: e.MSG_BURST,
    binPerSec: e.BIN_PER_SEC,
    binBurst: e.BIN_BURST,
    maxPayload: e.MAX_PAYLOAD,
    bufferLimit: e.BUFFER_LIMIT,
    heartbeatMs: e.HEARTBEAT_MS,
    joinTimeoutMs: e.JOIN_TIMEOUT_MS,
  };
}
