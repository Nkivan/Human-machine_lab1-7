// npm run replay -- logs/<file>.ndjson  -> event counts by type
import { replay } from "../src/log/replay.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run replay -- <file.ndjson>");
  process.exit(1);
}
const counts = {};
for await (const ev of replay(file)) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
console.log(counts);
