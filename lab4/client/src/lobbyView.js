// DOM rendering only: listens to a Lobby, never fetches. textContent (not innerHTML) = no injection.
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

export function createLobbyView(lobby, parent = document.body) {
  const root = el("div", "lobby");
  const name = el("input");
  name.placeholder = "Your callsign";
  name.maxLength = 16;
  const list = el("ul");
  const status = el("p", "status", "Loading rooms...");
  const roomName = el("input");
  roomName.placeholder = "New room name";
  roomName.maxLength = 24;
  const create = el("button", "", "Create room");
  create.addEventListener("click", () => {
    const value = roomName.value.trim();
    if (!value) return;
    lobby
      .create(value)
      .then(() => {
        roomName.value = "";
      })
      .catch((err) => {
        status.textContent = `Could not create room: ${err.message}`;
      });
  });
  const createRow = el("div");
  createRow.style.cssText = "display:flex;gap:8px";
  createRow.append(roomName, create);
  root.append(el("h1", "", "DOGFIGHT"), name, list, createRow, status);
  parent.append(root);

  lobby.addEventListener("roomsChanged", (e) => {
    list.replaceChildren(
      ...e.detail.map((room) => {
        const li = el("li");
        const full = room.players >= room.max;
        const join = el("button", "", full ? "Full" : "Join");
        join.disabled = full;
        join.addEventListener("click", () => lobby.join(room.id, name.value.trim() || "Pilot"));
        li.append(el("span", "", `${room.name}  ${room.players}/${room.max}`), join);
        return li;
      }),
    );
    status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  });
  lobby.addEventListener("refreshFailed", (e) => {
    status.textContent = `Could not refresh: ${e.detail.message}`;
  });

  return { destroy: () => root.remove() };
}
