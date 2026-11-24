import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import http, { type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { WebSocketServer } from "ws";
import { z } from "zod";
import { ArenaConfig } from "@dogfight/shared/protocol/messages";
import { addBots, botCount, removeBots } from "./bot.ts";
import type { ServerConfig } from "./config.ts";
import { HttpError } from "./errors.ts";
import { RoomManager } from "./rooms.ts";
import { createStaticHandler } from "./static.ts";
import { createTraffic } from "./traffic.ts";
import { attachWebSocket } from "./ws.ts";

const BODY_LIMIT = 4096;

// The HTTP body is validated by a schema too (types are erased: the client can send anything).
const CreateRoomBody = z.object({ name: z.string().trim().min(1).max(24), arena: ArenaConfig.partial().optional() });
const AddBotsBody = z.object({ count: z.number().int().min(1).max(128) });
const BOTS_PATH = /^\/api\/rooms\/([\w-]{1,40})\/bots$/;

function badRequest(error: z.ZodError): HttpError {
  const issue = error.issues[0];
  return new HttpError(400, issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid body");
}

function json(res: ServerResponse, status: number, body: unknown, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// Collect the request body (a readable stream) with a hard size cap. The result is `unknown` until validated.
async function readJson(req: IncomingMessage, limit = BODY_LIMIT): Promise<unknown> {
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const raw: unknown = chunk; // a Readable yields `any`: narrow it instead of trusting it (type-checked lint, Lab 7)
    const buf = typeof raw === "string" ? Buffer.from(raw) : Buffer.isBuffer(raw) ? raw : null;
    if (!buf) throw new HttpError(400, "unexpected body chunk");
    size += buf.length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export interface App {
  readonly server: Server;
  readonly manager: RoomManager;
  readonly wss: WebSocketServer;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

export function createApp(config: ServerConfig): App {
  const manager = new RoomManager(config);
  if (config.seedRooms) {
    manager.create({
      id: "alpha",
      name: "Alpha (calm)",
      arena: { asteroids: 4, pickupEvery: 6, seed: 1 },
      persistent: true,
    });
    manager.create({
      id: "bravo",
      name: "Bravo (rocky)",
      arena: { asteroids: 10, pickupEvery: 8, seed: 2 },
      persistent: true,
    });
  }
  const serveStatic = createStaticHandler(config.staticDir);
  const traffic = createTraffic();

  // Event-loop utilization over the last second: the share of time the loop was busy (1.0 = saturated).
  // Sampled on our own timer so the value does not depend on how often /api/stats is polled.
  let eluPrev = performance.eventLoopUtilization();
  let elu = 0;
  const eluTimer = setInterval(() => {
    const now = performance.eventLoopUtilization();
    elu = performance.eventLoopUtilization(now, eluPrev).utilization;
    eluPrev = now;
  }, 1000);
  eluTimer.unref();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    if (pathname === "/health") return json(res, 200, { status: "ok", uptime: process.uptime() });

    if (pathname === "/api/stats") {
      const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
      return json(res, 200, {
        rss,
        heapUsed,
        heapTotal,
        external,
        arrayBuffers,
        elu: Math.round(elu * 1000) / 1000,
        traffic, // cumulative bytes/frames in and out: the load test turns the deltas into bytes per second
        uptime: process.uptime(),
        rooms: manager.size,
        connections: wss.clients.size,
        matches: manager.matchStats(), // tick p50/p95/p99, interval jitter, overruns per room
      });
    }

    if (pathname === "/api/rooms") {
      if (req.method === "GET") return json(res, 200, { rooms: manager.list() });
      if (req.method === "POST") {
        const body = CreateRoomBody.safeParse(await readJson(req));
        if (!body.success) throw badRequest(body.error);
        const room = manager.create({ name: body.data.name, ...(body.data.arena ? { arena: body.data.arena } : {}) });
        return json(res, 201, { room: room.info });
      }
      throw new HttpError(405, "method not allowed");
    }

    // POST /api/rooms/:id/bots {count}: add N server-side AI players. DELETE: remove them all.
    const botsRoute = BOTS_PATH.exec(pathname);
    if (botsRoute) {
      const room = manager.get(botsRoute[1] ?? "");
      if (!room) throw new HttpError(404, "no such room");
      if (req.method === "POST") {
        const body = AddBotsBody.safeParse(await readJson(req));
        if (!body.success) throw badRequest(body.error);
        const added = addBots(room, body.data.count, config.maxBotsPerRoom);
        if (added.length === 0) throw new HttpError(409, `bot limit reached (${config.maxBotsPerRoom} per room)`);
        return json(res, 201, { added: added.map((b) => b.name), bots: botCount(room), room: room.info });
      }
      if (req.method === "DELETE") return json(res, 200, { removed: removeBots(room), room: room.info });
      throw new HttpError(405, "method not allowed");
    }

    if (pathname === "/api/replays" && req.method === "GET") {
      const files = (await readdir(config.logDir).catch(() => [])).filter((f) => f.endsWith(".ndjson"));
      const replays = await Promise.all(
        files.map(async (id) => ({ id, size: (await stat(path.join(config.logDir, id))).size })),
      );
      return json(res, 200, { replays });
    }

    if (pathname.startsWith("/api/replays/") && req.method === "GET") {
      const id = pathname.slice("/api/replays/".length);
      if (!/^[\w.-]+\.ndjson$/.test(id) || id.includes("..")) throw new HttpError(400, "bad replay id");
      const file = path.join(config.logDir, id);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, "no such replay");
      res.writeHead(200, { "content-type": "application/x-ndjson", "content-length": info.size });
      // Streamed, never buffered: memory stays flat however big the file is (backpressure via pipeline).
      return pipeline(createReadStream(file), res).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ERR_STREAM_PREMATURE_CLOSE") throw err;
      });
    }

    if (config.debugRoutes) {
      // Demos. Dangerous on purpose: enabled only with DEBUG_ROUTES=1.
      if (pathname === "/api/slow") {
        const ms = Math.min(Number(url.searchParams.get("ms") ?? 300), 5000);
        const t = performance.now();
        while (performance.now() - t < ms) {
          /* synchronous busy-wait: blocks EVERY client */
        }
        return json(res, 200, { blockedMs: ms });
      }
      if (pathname === "/api/debug/error") {
        const emitter = new EventEmitter();
        if (url.searchParams.has("safe")) emitter.on("error", (err: Error) => console.error("handled:", err.message));
        setImmediate(() => emitter.emit("error", new Error("boom"))); // no listener -> uncaught -> process dies
        return json(res, 200, { scheduled: true, safe: url.searchParams.has("safe") });
      }
      if (pathname === "/api/debug/reject") {
        const p = Promise.reject(new Error("unhandled rejection demo"));
        if (url.searchParams.has("safe")) p.catch((err: Error) => console.error("handled:", err.message));
        return json(res, 200, { scheduled: true, safe: url.searchParams.has("safe") });
      }
    }

    if (pathname.startsWith("/api/")) throw new HttpError(404, "not found");
    return serveStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : undefined);
        return;
      }
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message }, err.status === 413 ? { connection: "close" } : {});
        return;
      }
      console.error(err);
      json(res, 500, { error: "internal error" });
    });
  });
  const wss = attachWebSocket({ server, manager, config, traffic });

  return {
    server,
    manager,
    wss,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("server is not listening on a TCP port");
      return address;
    },
    // Graceful: stop accepting, say goodbye to sockets, flush match logs, then let connections drain.
    async close() {
      clearInterval(eluTimer);
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of wss.clients) socket.close(1001, "server shutting down");
      wss.close();
      await manager.closeAll();
      server.closeIdleConnections();
      const force = setTimeout(() => server.closeAllConnections(), 1000);
      await closed;
      clearTimeout(force);
    },
  };
}
