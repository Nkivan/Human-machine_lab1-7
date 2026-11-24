# Dogfight — Lab 04: Node.js server

## Run (development)
```bash
npm install
npm install -D vite eslint @eslint/js globals prettier
npm run dev:server        # terminal 1: http://127.0.0.1:3000 (API + WebSocket)
npm run dev:client        # terminal 2: http://localhost:5173 (Vite proxies /api and /ws to the server)
```
Open two browser windows on :5173, pick the same room, press **Enter** to chat.

## Run (production-like)
```bash
npm run build && npm start      # Node serves client/dist on :3000
npm test                        # node:test — protocol, rate limit, rooms, WebSocket integration, HTTP guards
```

## Layout
- `server/src/app.js` — node:http server: static files (MIME + path-traversal guard), `GET /health`, `GET/POST /api/rooms`, `GET /api/stats`, `GET /api/replays[/:id]`, debug routes
- `server/src/rooms.js` — `Room extends EventEmitter` (join/leave/chat/empty), `RoomManager`
- `server/src/protocol.js` — protocol v1 + `validate()`; `ws.js` — lifecycle, heartbeat, rate limit, slow-client policy
- `server/src/log/matchlog.js` — `events.on(room)` → Readable → NDJSON Transform → file via `pipeline`; `replay.js` — async generator
- `client/src/connection.js` — reconnect with backoff, send queue; `chatView.js`, `lobby.js` (now real API)
- Close codes: 4001 join timeout, 4002 bad JSON, 4003 bad message, 4004 not joined, 4005 already joined, 4006 no such room, 4007 room full, 4008 rate limit, 1009 payload too big, 1013 too slow

## M3 — backpressure proof
```bash
cd server && node tools/gen-log.js 200 logs/big.ndjson          # 200 MB synthetic log
node tools/rss-sampler.js 60 > rss.csv                           # terminal 2: sample rss every 500 ms
# browser DevTools -> Network -> throttle (Slow 4G), then open http://localhost:5173/api/replays/big.ndjson
```
Chart `rss.csv` (spreadsheet): the line should be flat while the 200 MB file downloads.
My result: rss before ___ MB, during download ___ MB (flat / grew by ___). Graph: ![rss](rss.png)

## M4 — one-page write-up (fill in)

### 1. Event loop under load
Phases: timers → pending → poll (I/O) → check (setImmediate) → close; nextTick and promise microtasks drain between phases.
Demo: with DEBUG_ROUTES=1, run `curl "localhost:3000/api/slow?ms=300"` and chat from another window at the same time.
What I observed (chat latency during the block, numbers): ...
Why: one thread runs ALL handlers; a synchronous 300 ms loop stalls every connected client, heartbeats and timers included.

### 2. Backpressure
Where it showed up in M3: ...
`write()` returns false above highWaterMark → stop producing until `drain`; `pipeline` does that for us. Without it: ...

### 3. Unhandled "error" / rejection kills the server
```bash
curl "localhost:3000/api/debug/error"      # process dies, exit code 1
curl "localhost:3000/api/debug/error?safe=1"   # listener attached: survives
```
Log excerpt: ...
Why it is deliberate: an unhandled error means the process is in an unknown state; crashing (and restarting under a supervisor) is safer than limping on. Fix: `emitter.on("error", ...)` / `.catch()`.

## Other numbers to record
Rate limit (token bucket, 10 msg/s, burst 20), `maxPayload` 2 KB, 4 players/room, 20 rooms, slow client threshold 64 KB.
