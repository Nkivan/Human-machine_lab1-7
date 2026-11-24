# Dogfight — Lab 03: Async JavaScript

Run: `npm install`, `npm install -D vite eslint @eslint/js globals prettier`, `npm run dev`.
Controls: arrows/WASD, Space = fire, H = toggle HUD.

## Structure
- `public/assets/manifest.json` — sprites, frames, sounds (optional), arena definition
- `src/assets/loader.js` — fetchJson (checks `ok`), loadImage/loadAudio/loadJson, withRetry (backoff + jitter, no 4xx retry), loadAll (Promise.all + progress)
- `src/assets/loadingScreen.js` — canvas progress bar, error screen with click-to-retry
- `src/audio.js`, `src/hud.js` — subscribe to world events (`fired`, `hit`, `exploded`, `score`); `sim/` imports neither
- `src/lobby.js` (EventTarget, data) + `src/lobbyView.js` (DOM) — periodic refresh, `AbortSignal.timeout`, abort on leave

## Test modes (dev server only)
`/?test=slow` `/?test=flaky` `/?test=404-sound` `/?test=404-required` `/?test=corrupt` `/?test=timeout` `/?test=abort`
Add `&seq=1` to load sequentially (compare timings in the console: `[loader] ... ms`).

## M1 — concurrent vs sequential (3 slow assets, 3 s each)
| mode | time |
|---|---|
| concurrent (`?test=slow`) | ___ ms |
| sequential (`?test=slow&seq=1`) | ___ ms |

Why: ...

## M4a — ordering puzzles (replace with YOUR OWN; run each in the console to verify)
1. `console.log("A"); setTimeout(()=>console.log("B"),0); Promise.resolve().then(()=>console.log("C")); console.log("D");` -> A D C B. Sync first, then the microtask, then the task.
2. `async function f(){console.log(1); await null; console.log(2)} f(); console.log(3);` -> 1 3 2. `await` yields even for a non-promise; the rest runs as a microtask.
3. `Promise.resolve().then(()=>{console.log("p1"); setTimeout(()=>console.log("t"),0)}).then(()=>console.log("p2")); setTimeout(()=>console.log("t0"),0);` -> p1 p2 t0 t. Both microtasks drain before any timer; t0 was queued before t.
4. `requestAnimationFrame(()=>console.log("raf")); setTimeout(()=>console.log("timeout"),0); Promise.resolve().then(()=>console.log("micro"));` -> micro timeout raf (typically). rAF runs in the rendering step, after tasks/microtasks.
5. `const p = new Promise(r=>{console.log("exec"); r("v")}); p.then(v=>console.log("then",v)); console.log("after");` -> exec after then v. The executor is synchronous; reactions are always async.

## M4b — failure gallery (screenshot each)
| mode | what I expect | screenshot |
|---|---|---|
| `404-sound` | game starts, console warns about the missing optional sound | |
| `404-required` | error screen + retry (no retries: 404 is 4xx) | |
| `flaky` | two 503s retried with backoff, then loads | |
| `timeout` | request times out after 5 s, retried, then error screen | |
| `abort` | "Loading cancelled", click to retry | |
| `corrupt` | SyntaxError, error screen (not retried) | |
