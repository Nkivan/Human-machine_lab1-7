import { SIM_HASH_NOTE } from "./simcheck.js";
import { setupCanvas } from "./render/canvas.js";
import { fetchJson, loadAll, withRetry } from "./assets/loader.js";
import { loadWithScreen } from "./assets/loadingScreen.js";
import { applyTestMode } from "./assets/testmodes.js";
import { createAudio } from "./audio.js";
import { startNetGame } from "./game.js";
import { Lobby } from "./lobby.js";
import { createLobbyView } from "./lobbyView.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const params = new URLSearchParams(location.search); // ?lat=100&jitter=30&drop=0.02  ?noise=1  ?hash=1  ?test=slow ...
if (params.has("hash")) console.log(SIM_HASH_NOTE());
const audio = createAudio();
let abortedOnce = false;

async function load({ signal, onProgress, abort }) {
  const raw = await withRetry(() => fetchJson("/assets/manifest.json", { signal }), { signal });
  const manifest = applyTestMode(raw, params.get("test"));
  if (params.get("test") === "abort" && !abortedOnce) {
    abortedOnce = true;
    setTimeout(abort, 600);
  }
  return loadAll(manifest, { ctx: audio.ctx, signal, onProgress, sequential: params.has("seq") });
}

function enterLobby() {
  return new Promise((resolve) => {
    // an event that fires ONCE -> a promise
    const lobby = new Lobby();
    const lobbyView = createLobbyView(lobby);
    lobby.addEventListener(
      "joined",
      (e) => {
        lobbyView.destroy();
        resolve(e.detail);
      },
      { once: true },
    );
    lobby.start();
  });
}

const assets = await loadWithScreen({ canvas, ctx, view, start: load });
audio.setBuffers(assets.sounds);
const { room, name } = await enterLobby();
startNetGame({ ctx, view, room, name, assets, audio, params });
