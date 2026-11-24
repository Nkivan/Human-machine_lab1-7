// Demonstrates the `this` bug from Section 2. In main.js temporarily add:
//   import { demoThisBug } from "./this-demo.js"; demoThisBug();
// and read the console.
import { Ship } from "./sim/ship.js";

export function demoThisBug() {
  const world = { spawn: (e) => e, dispatchEvent() {} }; // minimal stand-in
  const ship = new Ship({ x: 0, y: 0 });

  const detached = ship.fire; // we passed the function, not the CALL
  try {
    detached(world);
  } catch (e) {
    console.log("BUG  detached call ->", e.message);
  }

  console.log("FIX 1 arrow wrapper  ->", (() => ship.fire(world))()); // closure keeps `ship`
  console.log("FIX 2 bind           ->", ship.fire.bind(ship)(world)); // permanently bound copy
  console.log("FIX 3 call           ->", ship.fire.call(ship, world)); // explicit binding at call time
  // FIX 4 (class field `fire = (w) => {...}`) works too, but creates one function per instance.
}
