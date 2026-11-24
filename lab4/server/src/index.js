import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
const { address, port } = await app.listen();
console.log(
  `dogfight server on http://${address}:${port}  (ws path /ws, logs in ${config.logDir})`,
);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: shutting down...`);
  const force = setTimeout(() => {
    console.error("forced exit");
    process.exit(1);
  }, 5000);
  force.unref();
  await app.close(); // sockets closed, match logs flushed
  console.log("bye");
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
