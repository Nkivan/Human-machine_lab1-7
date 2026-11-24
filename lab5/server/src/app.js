import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./errors.js";
import { RoomManager } from "./rooms.js";
import { createStaticHandler } from "./static.js";
import { attachWebSocket } from "./ws.js";

const BODY_LIMIT = 4096;

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// Collect the request body (a readable stream) with a hard size cap.
async function readJson(req, limit = BODY_LIMIT) {
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "body too large");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export function createApp(config) {
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
  let wss;

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    if (pathname === "/health") return json(res, 200, { status: "ok", uptime: process.uptime() });

    if (pathname === "/api/stats") {
      const { rss, heapUsed } = process.memoryUsage();
      return json(res, 200, {
        rss,
        heapUsed,
        uptime: process.uptime(),
        rooms: manager.size,
        connections: wss.clients.size,
        matches: manager.matchStats(), // tick duration, interval jitter, overruns per room
      });
    }

    if (pathname === "/api/rooms") {
      if (req.method === "GET") return json(res, 200, { rooms: manager.list() });
      if (req.method === "POST") {
        const body = await readJson(req);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (name.length < 1 || name.length > 24)
          throw new HttpError(400, "name must be 1..24 characters");
        const room = manager.create({ name, arena: body.arena });
        return json(res, 201, { room: room.info });
      }
      throw new HttpError(405, "method not allowed");
    }

    if (pathname === "/api/replays" && req.method === "GET") {
      const files = (await readdir(config.logDir).catch(() => [])).filter((f) =>
        f.endsWith(".ndjson"),
      );
      const replays = await Promise.all(
        files.map(async (id) => ({ id, size: (await stat(path.join(config.logDir, id))).size })),
      );
      return json(res, 200, { replays });
    }

    if (pathname.startsWith("/api/replays/") && req.method === "GET") {
      const id = pathname.slice("/api/replays/".length);
      if (!/^[\w.-]+\.ndjson$/.test(id) || id.includes(".."))
        throw new HttpError(400, "bad replay id");
      const file = path.join(config.logDir, id);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, "no such replay");
      res.writeHead(200, { "content-type": "application/x-ndjson", "content-length": info.size });
      // Streamed, never buffered: memory stays flat however big the file is (backpressure via pipeline).
      return pipeline(createReadStream(file), res).catch((err) => {
        if (err.code !== "ERR_STREAM_PREMATURE_CLOSE") throw err;
      });
    }

    if (config.debugRoutes) {
      // M4 demos. Dangerous on purpose: enabled only with DEBUG_ROUTES=1.
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
        if (url.searchParams.has("safe"))
          emitter.on("error", (err) => console.error("handled:", err.message));
        setImmediate(() => emitter.emit("error", new Error("boom"))); // no listener -> uncaught -> process dies
        return json(res, 200, { scheduled: true, safe: url.searchParams.has("safe") });
      }
      if (pathname === "/api/debug/reject") {
        const p = Promise.reject(new Error("unhandled rejection demo"));
        if (url.searchParams.has("safe")) p.catch((err) => console.error("handled:", err.message));
        return json(res, 200, { scheduled: true, safe: url.searchParams.has("safe") });
      }
    }

    if (pathname.startsWith("/api/")) throw new HttpError(404, "not found");
    return serveStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy(err);
      if (err instanceof HttpError) {
        return json(
          res,
          err.status,
          { error: err.message },
          err.status === 413 ? { connection: "close" } : {},
        );
      }
      console.error(err);
      json(res, 500, { error: "internal error" });
    });
  });
  wss = attachWebSocket({ server, manager, config });

  return {
    server,
    manager,
    wss,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
      });
      return server.address();
    },
    // Graceful: stop accepting, say goodbye to sockets, flush match logs, then let connections drain.
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
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
