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
  root.append(el("h1", "", "DOGFIGHT"), name, list, status);
  parent.append(root);

  lobby.addEventListener("roomsChanged", (e) => {
    list.replaceChildren(
      ...e.detail.map((room) => {
        const li = el("li");
        const join = el("button", "", room.players >= room.max ? "Full" : "Join");
        join.disabled = room.players >= room.max;
        join.addEventListener("click", () => lobby.join(room.id, name.value.trim() || "Pilot"));
        li.append(el("span", "", `${room.name}  ${room.players}/${room.max}`), join);
        return li;
      }),
    );
    status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  });
  lobby.addEventListener("refreshFailed", (e) => { status.textContent = `Could not refresh: ${e.detail.message}`; });

  return { destroy: () => root.remove() };
}
