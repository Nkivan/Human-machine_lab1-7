import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Async generator over an NDJSON file: constant memory however large the file is.
export async function* replay(file) {
  const input = createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line) yield JSON.parse(line);
    }
  } finally {
    input.destroy(); // if the consumer breaks early, do not leak the file descriptor
  }
}
