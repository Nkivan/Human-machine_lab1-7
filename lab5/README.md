# Dogfight — Lab 05: Real-Time Networking

Two (or four) browsers, one authoritative server, 30 Hz, binary protocol, client-side prediction + reconciliation, entity interpolation.

![two players](two-players.gif) <!-- TODO: your 20-second side-by-side GIF at 100 ms +- 30 ms jitter / 2% drop -->

## Run

```bash
npm install            # installs all three workspaces (shared, client, server) + vite/eslint/prettier
npm run dev:server        # terminal 1  -> http://127.0.0.1:3000   (DEBUG_ROUTES=1 in server/.env enables the latency injector)
npm run dev:client        # terminal 2  -> http://localhost:5173   (open it in TWO windows, join the same room)
npm test                  # 32 tests: shared (codec, determinism), client (prediction, interpolation), server (end to end)
npm run bench             # JSON vs binary table
npm run hash -w shared    # determinism hash (compare with the browser: http://localhost:5173/?hash=1 -> console)
```

Controls: arrows/WASD, Space = fire, **L** = cycle the latency injector (0 / 50 / 100 / 200 ms RTT), **[ ]** = interpolation delay -/+10 ms, **N** = netgraph, H = HUD, Enter = chat.
URL flags: `?lat=100&jitter=30&drop=0.02` (injector from the start), `?noise=4` (**breaks determinism on purpose**), `?hash=1`.

## Layout

- `shared/` — imported by BOTH client and server: `sim/` (pure, seeded, deterministic; `shipmove.js` is the one movement rule), `protocol/constants.js`, `codec/` (binary spec in `binary.js`, JSON baseline, world->records)
- `server/src/match.js` — one authoritative `Match` per room: 30 Hz tick scheduled against an ABSOLUTE target time; applies every queued input (max 4/tick), `world.step`, snapshots with `lastProcessedSeq`; tick stats in `/api/stats`
- `server/src/ws.js` — binary + JSON frames, rate limits, heartbeat, latency injector (`netsim.js`)
- `client/src/net/netcode.js` — `createPredictor` (prediction, reconciliation, error smoothing, local bullets) and `createInterpolator`; `netgraph.js`; `game.js` wires it all

## Design decisions worth defending

- **One input = one simulation step** on both sides (`STEP = 1/30`). The server applies inputs in order; if none arrived this tick, that ship does not move (a late input is applied when it arrives, never twice). Max 4 inputs per client per tick: a client cannot speed-hack by flooding.
- **Redundant inputs**: every packet repeats the last 3 inputs, so a lost packet costs nothing.
- **Lossless state on the wire**: the sim keeps x/y/vx/vy as float32 (`Math.fround`) and the angle in whole milliradians, cooldown in integer steps. Encode->decode returns exactly what the sim holds, so prediction matches the server _bit for bit_ (the tests assert corrections are exactly 0).
- **Server owns bullets**: my shot is predicted locally and dropped when the server has processed that input (`ack >= seq`), then the authoritative bullet is drawn through interpolation.
- Known limits: entity ids are 16 bit; `Math.sin/cos/exp` are deterministic across Node and Chrome (both V8) but may differ in the last bit in other engines (that is what the hash check is for); the injector is in-order (TCP-like), `drop` simulates UDP-like loss.

## M1 — baseline: no prediction (record the netgraph)

At 100 ms RTT without prediction the ship answers a full round trip late. (Fill in: screenshot of the netgraph, how it felt.)

## M2 — determinism experiment

1. `?lat=100` -> correction reads `0.000 px` in open space and spikes only on collisions.
2. `?lat=100&noise=4` (random noise inside the prediction == `Math.random()` in `integrate`) -> corrections grow. Screenshot: ______
3. Remove `noise` -> back to 0. What I learned: ______

## M3 — interpolation delay trade-off

Default 2 snapshot intervals (66.7 ms). I tried ___ ms ... and chose ___ ms because ______ (too small: stutter when a snapshot is late; too large: others are drawn too far in the past).

## M4 — measurements (30 Hz, 4 players)

`npm run bench` on my machine (replace with yours):

| Codec             | Bytes/snapshot | KB/s per client (down) | KB/s per client (up) | Encode+decode us |
| ----------------- | -------------- | ---------------------- | -------------------- | ---------------- |
| JSON              | 3179           | 93.1                   | 4.1                  | 40.5             |
| Binary (DataView) | 515            | 15.1                   | 0.6                  | 1.6              |

Live check (4 clients, 6 asteroids): ~16.5 KB/s binary + ~1.3 KB/s JSON events per client; tick avg 0.6 ms, interval 33.3 ms, jitter 0.6 ms, 0 overruns (`/api/stats`).
Angle quantization: Int16 in 1/1000 rad = 0.057 degrees; at the ship's size (46 px) that is 0.02 px at the nose, invisible. Because the sim itself uses quantized angles there is no error at all.

## Netcode write-up (<= 1 page, fill in)

**Three problems.** Latency (prediction + interpolation), consistency (one authoritative simulation, snapshots), cheating (clients send inputs only; server validates, rate-limits, caps inputs per tick).
**What the netgraph showed before/after prediction:** ______
**The determinism bug I hit:** ______
**Interpolation delay trade-off I chose and why:** ______

## Stretch ideas

Delta snapshots (bitmask per entity, fall back to full when the ack is old); lag compensation for bullets (ring buffer of recent world states); a Node script with 4 headless clients at 150 ms / 5% drop asserting mean correction < threshold (see `server/test/netcode.test.js`: it is already the first one).

## Pickups (power-ups)
Three pickups spawn in rooms that set `pickupEvery` (seconds; the seeded rooms `alpha` and `bravo` do; `0` = none). At most two exist at once and each disappears after 12 s. Fly into one to get its effect:

| Pickup | Sprite | Effect | Where it lives |
|---|---|---|---|
| shield | S (blue) | no damage for 6 s | server only (`Ship.damage`) |
| rapid | R (yellow) | fire cooldown 9 -> 3 steps for 8 s | **shared `stepShip`**: the prediction must know it, or the client would compute the fire rate differently from the server |
| homing | H (pink) | bullets seek the nearest target for 8 s | server only: the `homing` behavior is attached to the bullet |

Active effects are shown in the HUD (`SHIELD 4s  RAPID 7s`); a shield draws a ring around the ship and homing bullets are pink.

Protocol change: the entity kind `PICKUP` (4) and the ship effect counters (`rapid`, `shield`, `homing`, one byte each) were added, so an entity on the wire grew from 24 to **28 bytes**: a snapshot is `11 + 28 * count` bytes. **The numbers in the JSON-vs-binary table were measured before this change: re-run `npm run bench` and update them.**
