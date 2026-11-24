// ============================================================================
// BINARY PROTOCOL SPEC v2   (little-endian everywhere; first byte = message type)
//
// C->S  INPUT    (0x01)  u8 type | u8 count (1..5) | count x { u32 seq | i8 turn (-1,0,1) | u8 flags (bit0 thrust, bit1 fire) }
//                        = 2 + 6*count bytes. The last few inputs are repeated in every packet (redundancy): a dropped
//                        packet costs nothing because the next one carries the same inputs again.
// C->S  PING     (0x03)  u8 type | f64 clientTime                                        = 9 bytes
// S->C  PONG     (0x04)  u8 type | f64 clientTime (echoed) | u32 serverTick              = 13 bytes
// S->C  SNAPSHOT (0x02)  u8 type | u32 tick | u32 ack | u16 count | count x ENTITY       = 11 + 28*count bytes
//        ack  = the last INPUT seq the server applied for THIS client (reconciliation)
//        ENTITY (28 bytes): u16 id | u8 kind | u8 flags | f32 x | f32 y | f32 vx | f32 vy | i16 angle (1/1000 rad) | u16 aux
//                           | u8 rapid | u8 shield | u8 homing | u8 reserved   (ship effects, in 1/30 s steps; 0 for other kinds)
//        kind  1 ship (aux = hp | cooldownSteps << 8)  2 bullet (aux = owner id)  3 asteroid (aux = radius * 10)
//              4 pickup (aux = type index + 1: shield, rapid, homing)
//        flags bit0 thrust, bit1 invulnerable, bit2 seeker asteroid, bit3 homing bullet
//
// Why lossless: the sim keeps x/y/vx/vy as float32 and the angle as whole milliradians, so encode -> decode returns
// EXACTLY what the simulation holds. Prediction then matches the server bit for bit.
// Entity ids are the low 16 bits of the server's counter (a wrap collision needs 65k spawns within a bullet's lifetime).
// JSON text frames (join, chat, roster, welcome, events, scores, netsim) are versioned with { v: 2 }.
// ============================================================================
import { MAX_INPUTS_PER_PACKET, MSG } from "../protocol/constants.js";

const LE = true;
const HEADER = 11;
const ENTITY = 28;
const bad = (reason) => ({ ok: false, reason });

export function encodeInputs(inputs) {
  const buf = new ArrayBuffer(2 + inputs.length * 6);
  const v = new DataView(buf);
  v.setUint8(0, MSG.INPUT);
  v.setUint8(1, inputs.length);
  inputs.forEach((inp, i) => {
    const o = 2 + i * 6;
    v.setUint32(o, inp.seq >>> 0, LE);
    v.setInt8(o + 4, inp.turn);
    v.setUint8(o + 5, (inp.thrust ? 1 : 0) | (inp.fire ? 2 : 0));
  });
  return buf;
}

export function encodePing(clientTime) {
  const buf = new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PING);
  v.setFloat64(1, clientTime, LE);
  return buf;
}

export function encodePong(clientTime, tick) {
  const buf = new ArrayBuffer(13);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PONG);
  v.setFloat64(1, clientTime, LE);
  v.setUint32(9, tick >>> 0, LE);
  return buf;
}

export function encodeSnapshot({ tick, ack, entities }) {
  const buf = new ArrayBuffer(HEADER + entities.length * ENTITY);
  const v = new DataView(buf);
  v.setUint8(0, MSG.SNAPSHOT);
  v.setUint32(1, tick >>> 0, LE);
  v.setUint32(5, ack >>> 0, LE);
  v.setUint16(9, entities.length, LE);
  entities.forEach((e, i) => {
    const o = HEADER + i * ENTITY;
    v.setUint16(o, e.id & 0xffff, LE);
    v.setUint8(o + 2, e.kind);
    v.setUint8(o + 3, e.flags);
    v.setFloat32(o + 4, e.x, LE);
    v.setFloat32(o + 8, e.y, LE);
    v.setFloat32(o + 12, e.vx, LE);
    v.setFloat32(o + 16, e.vy, LE);
    v.setInt16(o + 20, Math.round(e.angle * 1000), LE);
    v.setUint16(o + 22, e.aux, LE);
    v.setUint8(o + 24, e.rapid ?? 0);
    v.setUint8(o + 25, e.shield ?? 0);
    v.setUint8(o + 26, e.homing ?? 0);
  });
  return buf;
}

// Server side: NEVER trust a client frame. Returns { ok, type, ... } or { ok:false, reason }.
export function decodeClient(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return bad("empty frame");
  const v = new DataView(buf);
  switch (v.getUint8(0)) {
    case MSG.INPUT: {
      if (buf.byteLength < 2) return bad("short input");
      const count = v.getUint8(1);
      if (count < 1 || count > MAX_INPUTS_PER_PACKET) return bad("bad input count");
      if (buf.byteLength !== 2 + count * 6) return bad("bad input length");
      const inputs = [];
      for (let i = 0; i < count; i++) {
        const o = 2 + i * 6;
        const turn = v.getInt8(o + 4);
        const flags = v.getUint8(o + 5);
        if (turn < -1 || turn > 1 || flags > 3) return bad("bad input values"); // a turn of 1000 is a cheat
        inputs.push({
          seq: v.getUint32(o, LE),
          turn,
          thrust: (flags & 1) !== 0,
          fire: (flags & 2) !== 0,
        });
      }
      return { ok: true, type: "inputs", inputs };
    }
    case MSG.PING:
      if (buf.byteLength !== 9) return bad("bad ping length");
      return { ok: true, type: "ping", t: v.getFloat64(1, LE) };
    default:
      return bad("unknown binary type");
  }
}

// Client side: the server is trusted, but a malformed frame must not throw inside the render loop.
export function decodeServer(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return null;
  const v = new DataView(buf);
  switch (v.getUint8(0)) {
    case MSG.SNAPSHOT: {
      if (buf.byteLength < HEADER) return null;
      const count = v.getUint16(9, LE);
      if (buf.byteLength !== HEADER + count * ENTITY) return null;
      const entities = new Array(count);
      for (let i = 0; i < count; i++) {
        const o = HEADER + i * ENTITY;
        entities[i] = {
          id: v.getUint16(o, LE),
          kind: v.getUint8(o + 2),
          flags: v.getUint8(o + 3),
          x: v.getFloat32(o + 4, LE),
          y: v.getFloat32(o + 8, LE),
          vx: v.getFloat32(o + 12, LE),
          vy: v.getFloat32(o + 16, LE),
          angle: v.getInt16(o + 20, LE) / 1000,
          aux: v.getUint16(o + 22, LE),
          rapid: v.getUint8(o + 24),
          shield: v.getUint8(o + 25),
          homing: v.getUint8(o + 26),
        };
      }
      return { type: "snapshot", tick: v.getUint32(1, LE), ack: v.getUint32(5, LE), entities };
    }
    case MSG.PONG:
      if (buf.byteLength !== 13) return null;
      return { type: "pong", t: v.getFloat64(1, LE), tick: v.getUint32(9, LE) };
    default:
      return null;
  }
}
