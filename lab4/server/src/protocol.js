// Protocol v1: JSON text frames { v, type, ... }. NEVER trust a client message's shape: validate() every one.
export const PROTOCOL_VERSION = 1;
export const LIMITS = { name: 16, text: 200 };

// Rejecting control characters is the whole point of this regex.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ROOM_ID = /^[\w-]{1,40}$/;
const fail = (reason) => ({ ok: false, reason });

export function validate(msg) {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return fail("not an object");
  if (msg.v !== PROTOCOL_VERSION) return fail("unsupported version");
  switch (msg.type) {
    case "join": {
      if (typeof msg.room !== "string" || !ROOM_ID.test(msg.room)) return fail("bad room id");
      if (typeof msg.name !== "string") return fail("bad name");
      const name = msg.name.trim();
      if (name.length < 1 || name.length > LIMITS.name || CONTROL_CHARS.test(name))
        return fail("bad name");
      return { ok: true, msg: { type: "join", room: msg.room, name } };
    }
    case "chat": {
      if (typeof msg.text !== "string") return fail("bad text");
      const text = msg.text.trim();
      if (text.length < 1 || text.length > LIMITS.text || CONTROL_CHARS.test(text))
        return fail("bad text");
      return { ok: true, msg: { type: "chat", text } };
    }
    default:
      return fail("unknown type");
  }
}

const v = PROTOCOL_VERSION;
export const serverMsg = {
  roster: (players) => ({ v, type: "roster", players }),
  chat: (from, text, t) => ({ v, type: "chat", from, text, t }),
  system: (text) => ({ v, type: "system", text }),
  error: (code, message) => ({ v, type: "error", code, message }),
};
