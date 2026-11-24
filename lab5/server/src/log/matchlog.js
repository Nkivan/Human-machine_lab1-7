import { on } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Object-mode in, text out: one JSON object -> one NDJSON line.
export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }
  _transform(obj, _enc, cb) {
    try {
      cb(null, JSON.stringify(obj) + "\n");
    } catch (err) {
      cb(err);
    }
  }
}

// A room's events become a stream: events.on(room, "event") -> Readable -> Transform -> file.
// pipeline() wires backpressure, error propagation and cleanup for us.
export function createMatchLog({ dir, room }) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${room.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`,
  );

  const events = on(room, "event"); // listener is attached NOW, so no event is missed
  async function* source() {
    for await (const [ev] of events) {
      yield ev;
      if (ev.type === "closed") return; // returning detaches the listener and ends the stream
    }
  }

  const done = pipeline(
    Readable.from(source(), { objectMode: true }),
    new NdjsonTransform(),
    createWriteStream(file),
  );
  return { file, done };
}
