import { fetchJson } from "./assets/loader.js";

// Data layer only. Rendering lives in lobbyView.js and listens to these events.
export class Lobby extends EventTarget {
  #rooms = [];
  #timer = 0;
  #ctrl = null;
  #url;
  #intervalMs;
  #timeoutMs;

  constructor({ url = "/api/rooms", intervalMs = 5000, timeoutMs = 3000 } = {}) {
    super();
    this.#url = url;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
  }

  get rooms() {
    return this.#rooms;
  }

  async refresh() {
    this.#ctrl?.abort(); // a newer refresh supersedes an in-flight one
    const ctrl = (this.#ctrl = new AbortController());
    const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(this.#timeoutMs)]); // timeout on EVERY request
    try {
      const data = await fetchJson(this.#url, { signal });
      this.#rooms = data.rooms;
      this.dispatchEvent(new CustomEvent("roomsChanged", { detail: this.#rooms }));
    } catch (err) {
      if (err.name === "AbortError") return; // cancelled on purpose: not an error
      this.dispatchEvent(new CustomEvent("refreshFailed", { detail: err }));
    }
  }

  async create(name) {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res.ok)
      throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    await this.refresh();
  }

  start() {
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), this.#intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#ctrl?.abort();
  } // no orphaned requests after leaving

  join(roomId, name) {
    const room = this.#rooms.find((r) => r.id === roomId);
    if (!room || room.players >= room.max) throw new Error(`cannot join ${roomId}`);
    this.stop();
    this.dispatchEvent(new CustomEvent("joined", { detail: { room, name } }));
  }
}
