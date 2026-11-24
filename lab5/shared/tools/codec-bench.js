// node tools/codec-bench.js  -> the JSON vs binary table for the README (4 players, 30 Hz).
import { performance } from "node:perf_hooks";
import { decodeClient, decodeServer, encodeInputs, encodeSnapshot } from "../src/codec/binary.js";
import {
  decodeInputsJson,
  decodeSnapshotJson,
  encodeInputsJson,
  encodeSnapshotJson,
} from "../src/codec/json.js";
import { snapshotWorld } from "../src/codec/snapshot.js";
import { Ship } from "../src/sim/ship.js";
import { World } from "../src/sim/world.js";

const world = new World(5, { asteroids: 6 });
const ships = [0, 1, 2, 3].map((i) => world.spawn(new Ship({ x: 200 + i * 250, y: 300 })));
for (let i = 0; i < 120; i++) {
  world.step(
    1 / 30,
    new Map(
      ships.map((s, k) => [s.id, [{ turn: k % 2 ? 1 : -1, thrust: true, fire: i % 4 === k }]]),
    ),
  );
}
const entities = snapshotWorld(world);
const snap = { tick: 120, ack: 119, entities };
const inputs3 = [1, 2, 3].map((seq) => ({ seq, turn: 1, thrust: true, fire: false }));

const enc = new TextEncoder();
const jsonSnap = enc.encode(encodeSnapshotJson(snap)).byteLength;
const binSnap = encodeSnapshot(snap).byteLength;
const jsonUp = enc.encode(encodeInputsJson(inputs3)).byteLength;
const binUp = encodeInputs(inputs3).byteLength;

function micros(fn, n = 20000) {
  for (let i = 0; i < 2000; i++) fn();
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return ((performance.now() - t) * 1000) / n;
}
const jsonUs = micros(() => decodeSnapshotJson(encodeSnapshotJson(snap)));
const binUs = micros(() => decodeServer(encodeSnapshot(snap)));
const jsonUpUs = micros(() => decodeInputsJson(encodeInputsJson(inputs3)));
const binUpUs = micros(() => decodeClient(encodeInputs(inputs3)));

const kbs = (bytes) => ((bytes * 30) / 1024).toFixed(1);
console.log(`entities in snapshot: ${entities.length} (4 ships + asteroids + bullets)`);
console.log(
  "| Codec | Bytes/snapshot | KB/s per client (down) | KB/s per client (up) | Snapshot enc+dec us | Input enc+dec us |",
);
console.log("|---|---|---|---|---|---|");
console.log(
  `| JSON | ${jsonSnap} | ${kbs(jsonSnap)} | ${kbs(jsonUp)} | ${jsonUs.toFixed(1)} | ${jsonUpUs.toFixed(1)} |`,
);
console.log(
  `| Binary (DataView) | ${binSnap} | ${kbs(binSnap)} | ${kbs(binUp)} | ${binUs.toFixed(1)} | ${binUpUs.toFixed(1)} |`,
);
console.log(`ratio down: ${(jsonSnap / binSnap).toFixed(1)}x, up: ${(jsonUp / binUp).toFixed(1)}x`);
