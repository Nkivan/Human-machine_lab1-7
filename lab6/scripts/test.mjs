// Cross-platform test runner: finds test/*.test.ts and runs them with Node's test runner + tsx (works on Node >= 20.6, Windows included).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "test");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join("test", f));
const res = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
