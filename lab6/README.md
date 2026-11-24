# Dogfight — Lab 06: TypeScript

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

| Pickup | Sprite letter | Effect | Where it lives |
|---|---|---|---|
| shield | S (blue) | no damage for 6 s | server only (`Ship.damage`) |
| rapid | R (yellow) | fire cooldown 9 -> 3 steps for 8 s | **shared `stepShip`**: the prediction must know it, or the client would compute the fire rate differently from the server |
| homing | H (pink) | bullets seek the nearest target for 8 s | server only: the `homing` behavior is attached to the bullet |

Active effects are shown in the HUD (`SHIELD 4s  RAPID 7s`) and a shield draws a ring around the ship. Homing bullets are drawn pink.

What changed in the protocol (and why the types helped): the entity kind `pickup` and the new ship fields (`rapid`, `shield`, `homing`) made every `switch` over `EntityRecord` / `AnyEntity` stop compiling until it handled them (the `assertNever` default), including the binary writer and reader. An entity on the wire grew from 24 to **28 bytes** (three effect counters of one byte each + one reserved byte), so a snapshot is `11 + 28 * count` bytes. **The bench numbers in "Measurements" were taken before this change: re-run `npm run bench` and update the table.**

Effect timers are integers in steps (1 step = 1/30 s) so they fit in one byte and stay exact on both sides.
