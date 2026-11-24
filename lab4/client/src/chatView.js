// DOM only (textContent, never innerHTML). Enter focuses the input; Enter again sends; Esc cancels.
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

export function createChatView({ parent = document.body, onSend }) {
  const root = el("div", "chat");
  const status = el("div", "chat-status", "connecting");
  const roster = el("div", "chat-roster");
  const log = el("div", "chat-log");
  const input = el("input");
  input.placeholder = "Enter to chat";
  input.maxLength = 200;
  root.append(status, roster, log, input);
  parent.append(root);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Enter" && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing must not steer the ship (and Enter must not re-focus us)
    if (e.code === "Enter") {
      const text = input.value.trim();
      if (text) onSend(text);
      input.value = "";
      input.blur();
    } else if (e.code === "Escape") input.blur();
  });

  return {
    setStatus: (s) => {
      status.textContent = s;
    },
    setRoster: (names) => {
      roster.textContent = `Pilots: ${names.join(", ")}`;
    },
    addLine(text, cls = "") {
      log.append(el("div", cls, text));
      while (log.children.length > 8) log.firstChild.remove();
    },
  };
}
