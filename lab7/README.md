# Dogfight — Lab 07: engines, memory and tests

![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg) <!-- replace OWNER/REPO with your repository -->

Lab 7 adds a real test suite (Vitest + fast-check + Playwright), type-checked linting and CI, server-side bots,
performance instrumentation, and **measured** fixes on both the client and the server. The simulation is unchanged:
the determinism hash is still `e34f5d00`, now with a spatial hash doing the collisions.

## Run

```bash
npm install
npm run dev:server / npm run dev:client      # as before
npm test                                      # Vitest: shared + client + server (97 tests)
npm run test:coverage                         # fails if shared/ coverage < 85 %
npm run test:e2e                              # Playwright: two browsers, one room (builds + starts the server)
npm run typecheck && npm run lint && npm run format:check
```

Playwright needs a Chromium: `npx playwright install chromium`, or use an installed Chrome with
`PW_CHROMIUM_EXECUTABLE=/path/to/chrome`.

Measurement tools (all start their own server in a child process, results go to `perf/`, summaries in `docs/perf/`):

| command                                                                     | what it does                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run perf:client -- --label X [--bots 8] [--throttle 4] [--seconds 30]` | Chrome via Playwright, 8 bots, autopilot with the trigger held; pass 1: frame p50/p95/p99 + spans + every GC pause (trace); pass 2: CPU profile + allocation sampling. Writes `.cpuprofile` / `.heapprofile` / trace files that open in DevTools |
| `npm run profile:match -w server -- --label X --bots 8 --seconds 60`        | `node --cpu-prof` of a whole match with bots: tick p50/p95/p99, ELU, RSS, top self time                                                                                                                                                          |
| `npm run loadtest -w server -- --label X [--ramp 8,32,...] [--cpu-prof]`    | N headless WebSocket clients in one room, 30 inputs/s each; capacity N                                                                                                                                                                           |
| `npx tsx tools/chart.ts`                                                    | `docs/capacity.svg` from the two load-test runs                                                                                                                                                                                                  |

In the game: `?perf=30` records 30 s and prints the table (also `window.__dogfight.perfReport()`); **P** toggles a live
p50/p95/p99 panel; `?autopilot=1` flies and shoots by itself; `?room=alpha&name=Ann` skips the lobby;
`?particles=worker` runs the worker experiment. Bots: `POST /api/rooms/:id/bots {"count": 8}`, `DELETE` removes them.

## M1, the test suite

97 tests (Lab 6 had 47), all in Vitest; `npm test` at the root runs the three packages as Vitest _projects_.
The Lab 6 `node:test` files only changed their import line (`node:assert` still works inside Vitest).

| file                             | what it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/test/properties.test.ts` | **9 fast-check properties**: codec round-trip within quantization (f32 positions exact, angle within 0.5 mrad, radius within 0.05); encoded length = `11 + 28n` and `2 + 6n`; 2000 garbage buffers (plus valid header + garbage) never throw; a ship stays in the arena, finite, under max speed for 1000 random inputs; speed never grows without thrust (drag); determinism by replay; spatial hash == naive pairs in the same order; `parseClientMessage` accepts every generated valid message and rejects every generated mutation |
| `shared/test/units.test.ts`      | `Vector2`; one integration step checked against the formula; angle quantization and wrap; collisions: touching, overlapping, missing, **tunneling**; stats; `withAck`                                                                                                                                                                                                                                                                                                                                                                   |
| `client/test/lab7.test.ts`       | the fixed-timestep loop driven by **fake timers** (30 steps per simulated second, alpha, clamping a 2 s hitch to 7 steps); **reconciliation as a pure function** `reconcileState(server, buffer, ack)`; particle and render pools; perf recorder                                                                                                                                                                                                                                                                                        |
| `server/test/lab7.test.ts`       | **heartbeat with fake timers** (dead peer terminated after 2 missed pongs, no waiting); token bucket and netsim on the fake clock; tick percentiles; bot `decide()`; the bots endpoint against a real server                                                                                                                                                                                                                                                                                                                            |

Coverage: `shared/src` 96-100 % lines (`npm run test:coverage`, threshold 85 % in `vitest.config.ts`).

**Tunneling: yes, ours can.** The fastest bullet moves (520 + 520) / 30 = 34.7 px per step, the bullet-ship hit zone
is 2 × (3 + 14) = 34 px wide, so one step can carry a bullet over a ship (a test proves it; slower bullets always hit).
Fixing it (a swept segment-circle test) would change the simulation and its hash; at the measured rarity
(only when firing forward at max speed AND exactly aligned) I documented it instead.

**Determinism "clone".** A `World` cannot be structurally cloned (behaviors are closures, ids come from a global
counter), so the property clones it the way prediction uses it: same seed + same inputs, replayed. Ids are excluded.

## M2, end-to-end and CI

`e2e/two-players.spec.ts`: two browser contexts join Alpha through the lobby, both see "Pilots: Ann, Bob", Ann
thrusts and Bob's window must see her ship move **within 500 ms** (measured: 116 ms), Ann chats and Bob receives it.
The page exposes a read-only `window.__dogfight` (only with `?e2e`/`?perf`) so the test can read positions off a canvas.

CI (`.github/workflows/ci.yml`): `npm ci → typecheck → lint → format:check → test:coverage → build → playwright`,
npm cache keyed by the lockfile, Playwright browsers cached. **Commit `package-lock.json`** (`npm ci` needs it).
Vitest is pinned to `~4.0.18`: 4.1 currently makes npm 10 crash on its optional peer dependencies (`edgesOut`).

**What type-checked lint found** (`recommendedTypeChecked` + `no-floating-promises`): 7 errors, all fixed:
`reject(signal.reason)` rejected with an `any` (twice, `loader.ts`); `simulate`/`render` declared as methods but
destructured (`unbound-method`, `loop.ts`); the HTTP body stream yields `any` (`app.ts`, now narrowed with
`Buffer.isBuffer`); `RawData` can be `Buffer[]`, whose `toString()` is not the message (test helper); an array inside a
template literal. `no-floating-promises` found nothing: Labs 4-6 already marked every fire-and-forget with `void`.

## M3, profile, fix, measure

Setup for every number below: this sandbox, 2 vCPU, Chrome 153 headless, Node 22; the server, 8 bots and the
browser share the same two cores. **Re-run the tools on your machine and replace the numbers.**
Flame charts: open `docs/perf/client-before.cpuprofile` / `client-after.cpuprofile` in DevTools →
Performance → _Load profile_ and take the screenshots there (the trace files in `perf/` show GC blocks too).

### Client (8 bots, autopilot shooting, 30 s)

|                                          | before                      | after                 |
| ---------------------------------------- | --------------------------- | --------------------- |
| frame interval p50 / p95 / p99           | 16.7 / 16.7 / 16.8 ms       | 16.7 / 16.7 / 16.8 ms |
| frame work p99 (3 runs)                  | 1.6 / 1.9 / 2.0 ms          | 2.1 / 2.0 / 2.1 ms    |
| dropped frames (> 25 ms)                 | 0 / 1 / 0                   | 0 / 0 / 0             |
| **major GC per 30 s (3 runs)**           | **1 / 1 / 2** (up to 12 ms) | **0 / 0 / 0**         |
| minor GC                                 | 14-17, ~16-21 ms total      | 20, ~16-18 ms total   |
| allocation rate                          | 1.22 MB/s                   | **0.41 MB/s (−66 %)** |
| CPU throttle ×4: major GC (3 runs)       | 1 / 1 / 1 (44, 25, 25 ms)   | **0 / 0 / 0**         |
| CPU throttle ×4: work p99 (3 runs)       | 6.4 / 6.3 / 5.9 ms          | 5.5 / 5.9 / 5.3 ms    |
| CPU throttle ×4: dropped frames (3 runs) | 101 / 27 / 31               | 82 / 38 / 26          |

Top allocators before (KB in 15 s): `lerpRecord` 2811, `readEntity` 2202, `drawWorld` 2132, socket `message` 1979,
`toItem` 1452, `sample` 1030, netgraph `forEach` 975. After: `readEntity` 1960, `drawWorld` 1755, `strip` 469.
Top self time (both): `fillText` (HUD and netgraph text), `(garbage collector)`, `fillRect`, `drawImage`.

What I changed, in order of measured impact:

1. **Interpolator** (`netcode.ts`): Lab 6 kept the decoded record objects of 30 snapshots (1 s): long enough to survive
   two scavenges and be **promoted**, which is exactly what filled the old generation and caused the major GC. Snapshots
   are now copied into reusable slots of **typed arrays** (structure of arrays); records die young.
2. **Render path** (`render.ts`, `netdraw.ts`): `sample → filter → map(toItem)` built new objects of four different
   shapes every frame. Now `sample()` writes into a **pool** of one class (`RenderEntity`, all fields initialized in the
   constructor: one hidden class, monomorphic `it.x`); one `setTransform` per entity instead of save/translate/rotate/restore.
3. **Particles** (`particles.ts`): an object pool in SoA form, swap-remove instead of `splice`.
4. **Predictor**: no `clone()` per step (copy into preallocated bodies); `renderPose` returns one reused object.
5. HUD/netgraph strings rebuilt 4×/s instead of 60×/s; `for` instead of `forEach` closures; popups filtered in place.

Left alone on purpose: `readEntity` (records now die in the nursery: cheap) and `drawWorld`'s remaining allocations
(doubles passed into the C++ canvas API are boxed as HeapNumbers: not fixable from JS).

**Result against the targets.** Zero major GCs during play: achieved in every run, throttled or not.
p99 frame interval 16.8 ms = the 60 Hz vsync itself (an interval cannot be shorter than 16.7 ms; nothing is dropped
unthrottled), and the frame's own work p99 is ~2 ms. Under ×4 throttling frames still drop, but the number varies 4×
between runs of the SAME build (27-101) while the page's work p99 stays at ~6 ms: those drops come from the 2-vCPU
sandbox (Chrome, the server and the bots compete for the cores), not from our main thread. The honest summary: the
fixes removed the GC hitch and two thirds of the allocation; average speed was never the problem (the main thread is
idle > 85 % of each frame).

### Server

`--cpu-prof`, 60-s match: 8 bots tick p99 0.39 → 0.47 ms, 48 bots 0.92 → 0.98 ms (noise: at this size a tick is
~0.2 ms and GC is the largest item, 10-15 % of busy CPU). The real hot spots appeared under load
(`docs/perf/server-load-prof-before.cpuprofile`, 192 clients):

| self time at N = 192, before                                                | share  |
| --------------------------------------------------------------------------- | ------ |
| `writev` (sending 57 MB/s)                                                  | 40.6 % |
| `writeEntity` + `encodeSnapshot` (snapshot encoded **once per client**)     | ~22 %  |
| `send` in `ws.ts` (`JSON.stringify` of every broadcast **once per client**) | 17.7 % |
| `findCollisions`                                                            | 1.4 %  |

Fixes: encode the snapshot once per tick and give each client a copy with its own `ack` (`withAck`, the cache key is
the shared `entities` array); serialize each broadcast once; copy incoming frames with `set()` instead of
`Uint8Array.from`. After that, at 512 clients `findCollisions` became the **second** hottest function (7.9 %), so it
got a **spatial hash** (uniform 80 px grid, pairs sorted into the naive order: same results, hash unchanged).

### Load test: capacity

![tick p99 vs clients](docs/capacity.svg)

| N   | before: tick p50 / p99 | after: tick p50 / p99 | after: ELU | after: out MB/s | after: snapshots/s per client |
| --- | ---------------------- | --------------------- | ---------- | --------------- | ----------------------------- |
| 8   | 0.49 / 2.80            | 0.52 / 1.08           | 3 %        | 0.3             | 30.0                          |
| 64  | 4.06 / 8.74            | 1.74 / 4.34           | 9 %        | 9.7             | 30.0                          |
| 128 | 9.65 / 17.58           | 4.04 / 9.98           | 22 %       | 29.5            | 30.0                          |
| 192 | 16.25 / 27.63          | 5.55 / 14.57          | 31 %       | 56.2            | 29.9                          |
| 256 | 24.68 / **40.37**      | 7.73 / 22.79          | 43 %       | 90.0            | 30.0                          |
| 512 |                        | 15.72 / 25.50         | 66 %       | 299.2           | 30.0                          |
| 640 |                        | 16.12 / 30.30         | 68 %       | 299.5           | **24.0**                      |

**Capacity: 192 → 512 clients in one room.** Capacity = tick p99 ≤ 33.3 ms **and** ≥ 29 snapshots/s per client.
At 640 the tick still fits, but the server cannot push more than ~300 MB/s, the slow-client policy drops snapshots and
players get 24 of 30. Full tables: `docs/perf/loadtest-*.md`.

## M4, bots, the worker, the load test

**Bots** (`server/src/bot.ts`): `Bot implements PlayerInput` (the participant interface in `rooms.ts`). A bot sees only
what a browser sees (the `welcome` message and snapshots) and acts only like a browser (seq-numbered inputs through
`Match.receiveInputs`, same dedup and limits): it cannot cheat and the match cannot tell it from a human. `decide()` is
a pure function: evade an asteroid that is close and closing in, otherwise chase the nearest enemy (wrap-aware), aim
with lead, fire when aligned. Bots think in `setImmediate` after the tick, so their CPU is not tick time. They don't
count against the human cap, and leave when the last human does.

**Worker experiment: NO-GO** (`?particles=worker`, `render/particles.worker.ts`). The worker owns the particle
simulation; every frame the main thread posts the explosions and a `Float32Array` that is **transferred** (zero-copy,
double-buffered) and draws the last result. Main-thread time spent on particles, 15 s each:

| particles per explosion | main thread | worker (post + receive) |
| ----------------------- | ----------- | ----------------------- |
| 24 (the game)           | 0.55 ms/s   | 11.7 ms/s               |
| 2000 (stress)           | 1.54 ms/s   | 8.9 ms/s                |

The message round trip costs more than the work it moves, even at 80× the real load. The code stays behind the flag.

## Prove it to yourself (results on this machine)

- `bash experiments/deopt.sh`: status `0b1010001` after the integer loop (bit 4 "optimized", bit 6 "TurboFan"), then
  `0b1` after `add("a","b")`: the optimized code was thrown away (deopt).
- `node experiments/shapes.mjs` (sum of `.x` over 1e6): one shape 6.7 ms, every 10th object with `.z` 6.7 ms (two
  shapes = still a cheap polymorphic IC), `Float32Array` **0.9 ms**.
- `node experiments/transfer.mjs` (50 MB to a worker): clone 82 ms, transfer **11 ms**; after the transfer the sender's
  `byteLength` is **0** (detached).
- `fc.property(fc.float(), x => Math.fround(x) === x)` passes with 100 runs but fails at 100 000 with `NaN`
  (`NaN !== NaN`); with `fc.double()` it fails at once and shrinks to **`-5e-324`** (the smallest subnormal double, not
  representable as float32).

## Reflection drafts (put them in your own words)

1. **Pipeline:** parser → AST → Ignition bytecode (runs at once, collects type feedback) → Maglev (quick optimizing tier)
   → TurboFan (fully optimized machine code). Hot functions with stable feedback get optimized; a violated assumption
   deopts. Ours: `stepShip` is always called with the same `ShipBody` shape and numbers, so it stays optimized; the
   deopt demo above shows the trigger.
2. **Hidden classes:** objects built the same way share a shape; an inline cache at `obj.x` stores "shape → offset".
   One shape = one check and a load; many shapes = a megamorphic hash lookup every time. Constructors initialize every
   field, in the same order (`RenderEntity`, `Entity`), never add or delete properties later.
3. **Generational GC:** most objects die young; a scavenge copies only the few survivors, so it is cheap. Survivors are
   promoted; the old generation is collected by mark-compact over everything live, which is expensive. A particle (or a
   snapshot record kept for 1 s, our real case) that lives just long enough to be promoted costs a lot and dies anyway.
4. **Top allocator:** `lerpRecord` / `sample` / `toItem` (the render path) and the retained snapshot records. Fix: SoA
   slots + an object pool. Downsides of pooling: manual lifetime (a stale reference to a recycled object is a bug the GC
   used to prevent), memory held at the peak, more code.
5. **Typed arrays:** dense, homogeneous, unboxed numbers in one contiguous buffer, no per-element objects, no shape
   checks (7× in the experiment). Lost: precision (`Float32`), fixed type and size, and the convenience of objects
   (no named fields, no `kind` union, parallel indices to keep in sync).
6. **Worker data transfer:** structured clone (copy, cost ∝ size), transfer (zero-copy, the sender loses the buffer),
   `SharedArrayBuffer` + `Atomics` (true sharing, needs COOP/COEP headers). Ours lost because per-frame messaging costs
   ~0.2 ms while the particle update costs ~0.01 ms.
7. **Property vs example tests:** examples pin known cases and document behavior; properties search the input space
   for what you did not think of (garbage buffers, `NaN`, `-5e-324`) and shrink failures to a minimal case.
8. **`no-floating-promises`:** a promise nobody awaits loses its rejection: in a server that is a silent failure or,
   with `--unhandled-rejections=throw` (Node's default), a crash of every room. The rule forces `await`, `.catch` or an
   explicit `void`.
9. **Bottleneck:** bandwidth / socket writes. Evidence: `writev` is 41 % → 59 % of CPU, the tick still fits at 640
   clients but bytes/s flatten at ~300 MB/s and snapshots/s per client drop to 24. Not GC (2-5 % under load), not the
   tick math after the fixes. Next step: delta snapshots / interest management, not a faster CPU.

---

# Lab 06: TypeScript (previous lab)

The whole codebase (shared, server, client) is TypeScript under `strict` + `noUncheckedIndexedAccess`, with **one typed protocol** and validation at every boundary. The runtime behaviour is unchanged: the Lab 5 determinism hash is identical (`e34f5d00`) and a test asserts it.

## Run

```bash
npm install                 # Node 22 recommended; Node >= 20.6 works (the server runs through tsx)
npm run dev:server          # terminal 1  -> http://127.0.0.1:3000
npm run dev:client          # terminal 2  -> http://localhost:5173  (open in TWO windows, join the same room)
npm run typecheck           # tsc --noEmit in every workspace (this is what Vite does NOT do)
npm run lint                # typescript-eslint: no `any`, no non-null `!`, no `as` casts
npm test                    # all tests (shared, client, server)
npm run build
```

Native TypeScript on Node >= 22.18 (or 22.6+ with the flag), no tsx at all: `npm run start:native -w server`.
Controls and URL flags are unchanged from Lab 5 (`?lat=100&jitter=30&drop=0.02`, `?noise=4`, `?hash=1`, plus **`?codec=json`** for the JSON snapshot codec).

CI: `.github/workflows/ci.yml` runs `npm ci && typecheck && lint && test && build`. Commit the `package-lock.json` that `npm install` creates on your machine, because `npm ci` needs it.

## What changed (and why)

| Where                             | What                                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json`              | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no `enum`, no parameter properties: Node can strip the types natively), `noUnused*`                                                                   |
| `shared/`                         | compiles with **no DOM and no Node types**: that alone proves the sim is platform-free. `Vector2` has `readonly x, y`; `EntityId`/`Tick`/`Seq` are branded; `Ship \| Bullet \| Asteroid` is a discriminated union on `kind`                                     |
| `shared/src/protocol/messages.ts` | **single source of truth**: zod schema -> inferred type -> runtime parser, for every JSON message both ways, snapshot records and the HTTP API. `parseClientMessage(data: unknown): Result<ClientMessage>` never throws. Lab 4's hand-written validator is gone |
| `shared/src/codec/`               | binary decoder returns `Result`, never throws; first byte carries the **protocol version** (high nibble) so a stale client is rejected; `Codec` interface with a binary and a JSON implementation                                                               |
| `shared/src/bus.ts`               | typed `Bus<E>`: replaces `EventTarget` + `CustomEvent` (untyped `detail`) in the sim, audio, HUD and lobby                                                                                                                                                      |
| `server/src/config.ts`            | environment parsed by a zod schema (defaults, coercion, fail fast on bad values)                                                                                                                                                                                |
| `server/src/rooms.ts`             | `Room extends EventEmitter<RoomEvents>` (Node's generic emitter): listener argument types are checked                                                                                                                                                           |
| `client/`                         | Vite compiles `.ts` but does not check it; `npm run typecheck` does. `manifest.json`, `/api/rooms`, WebSocket text frames and binary frames are all validated before use                                                                                        |

Rules I enforce mechanically (ESLint): **zero `any`**, no `x!`, and **3 `as` casts in the whole repo**, all in `shared/src/protocol/ids.ts` (the brand constructors: a brand exists only in the type system, so there is nothing to check at runtime).

## What TypeScript found

Concrete things the compiler made explicit during the migration (add the ones you hit yourself; each of these is in the code):

1. **Unchecked indexing** (`noUncheckedIndexedAccess`): `list[i]` in the collision loop, `pending[0]`, `snaps[i]`, `particles[i]`, `PRESETS[preset]`, `assets.images["sheet"]` are all `T | undefined`. The JavaScript assumed the index was valid; now every one has a guard or an explicit decision.
2. **A nullable that was never handled**: a loaded asset is `ImageBitmap | null` (optional assets resolve to `null` when they fail). `startNetGame` now throws a clear error if the sprite sheet is missing instead of passing `null` to `drawImage`.
3. **Untyped event payloads**: `CustomEvent.detail` is `any`. A misspelled `detail.shipid` would have been `undefined` at runtime. With `Bus<WorldEvents>` the name decides the payload type, and a typo does not compile.
4. **An ad-hoc property on a foreign object**: Lab 5 stored `socket.missed` on the `ws` socket; TypeScript refused, so it became a `WeakMap<WebSocket, number>`.
5. **`turn: number` where only -1, 0, 1 are valid**: now `-1 | 0 | 1`, the binary decoder narrows it with `!==` checks, and a cheating `turn: 100` cannot even be represented after decoding. The client builds it with `left === right ? 0 : right ? 1 : -1` instead of arithmetic that yields `number`.
6. **Magic numbers in three places**: the entity kind (1/2/3), the flag bits and the `aux` packing were repeated in the encoder, decoder and renderer. They now live in one place (the codec); everything else sees `{ kind: "ship", hp, cooldown, thrust... }`.
7. **Runtime/compile-time mismatch in my own test**: `typeof window` does not compile in `shared` (no DOM types) — the right check is `"window" in globalThis`.

## Three types worth explaining (drafts: put them in your own words)

**1. A discriminated union and an exhaustive switch** (`EntityRecord` in `messages.ts`, used in `codec/binary.ts`, `netdraw.ts`):
`ShipRecord | BulletRecord | AsteroidRecord`, each with a literal `kind`. Checking `r.kind` tells the compiler which fields exist (`r.hp` only on ships). Every `switch` ends with `default: return assertNever(r)`: if someone adds a fourth entity kind, every switch that forgot it stops compiling.

**2. The typed event bus** (`shared/src/bus.ts`):
`on<K extends keyof E>(name: K, fn: (payload: E[K]) => void)`. `K` is "whichever event name you pass", and `E[K]` is "the payload type for exactly that name". So `bus.on("score", p => p.delta)` knows `p.delta` is a number, and `bus.emit("hit", { x: 1 })` is an error (missing `y`).

**3. Branded ids** (`protocol/ids.ts`):
`type Seq = number & { readonly [brand]: "Seq" }`. At runtime it is just a number, but `asSeq(5)` is the only way to make one, so passing a `Tick` where a `Seq` is expected is a compile error. The brand is erased: zero cost.

## Framework decision (fill in)

I did / did not rebuild the lobby and HUD in a framework. ______ (If not: the canvas and the game loop stay vanilla either way; the lobby is ~80 lines of typed DOM code (`el()` helper, `Bus` events), so a framework would add a build/runtime dependency larger than the code it replaces. If yes: what it gave you that `EventTarget` + DOM did not, and what it cost in bundle size and build complexity.)

## Measurements

`npm run bench` (30 Hz, 4 players; **the JSON column now includes zod validation**, so it is slower than in Lab 5):

| Codec                   | Bytes/snapshot | KB/s per client (down) | KB/s per client (up) | Snapshot enc+dec us |
| ----------------------- | -------------- | ---------------------- | -------------------- | ------------------- |
| JSON (validated by zod) | 3522           | 103.2                  | 4.1                  | 67.0                |
| Binary (DataView)       | 515            | 15.1                   | 0.6                  | 8.6                 |

(numbers from my machine: re-run on yours.) `typecheck` time before/after project references is the Stretch task.

## Pickups (power-ups)

Three pickups spawn in rooms that set `pickupEvery` (seconds; the seeded rooms `alpha` and `bravo` do; `0` = none). At most two exist at once and each disappears after 12 s. Fly into one to get its effect:

| Pickup | Sprite letter | Effect                                  | Where it lives                                                                                                            |
| ------ | ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| shield | S (blue)      | no damage for 6 s                       | server only (`Ship.damage`)                                                                                               |
| rapid  | R (yellow)    | fire cooldown 9 -> 3 steps for 8 s      | **shared `stepShip`**: the prediction must know it, or the client would compute the fire rate differently from the server |
| homing | H (pink)      | bullets seek the nearest target for 8 s | server only: the `homing` behavior is attached to the bullet                                                              |

Active effects are shown in the HUD (`SHIELD 4s  RAPID 7s`) and a shield draws a ring around the ship. Homing bullets are drawn pink.

What changed in the protocol (and why the types helped): the entity kind `pickup` and the new ship fields (`rapid`, `shield`, `homing`) made every `switch` over `EntityRecord` / `AnyEntity` stop compiling until it handled them (the `assertNever` default), including the binary writer and reader. An entity on the wire grew from 24 to **28 bytes** (three effect counters of one byte each + one reserved byte), so a snapshot is `11 + 28 * count` bytes. **The bench numbers in "Measurements" were taken before this change: re-run `npm run bench` and update the table.**

Effect timers are integers in steps (1 step = 1/30 s) so they fit in one byte and stay exact on both sides.
