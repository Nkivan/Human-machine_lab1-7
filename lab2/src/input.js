// Closure-based input: `down` and `pressed` are private, the returned object is the API.
export function createInput(target) {
  const down = new Set();
  const pressed = new Set(); // edge-triggered: filled on keydown, cleared by endStep()

  target.addEventListener("keydown", (e) => {
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    if (!e.repeat && !down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
  });
  target.addEventListener("keyup", (e) => down.delete(e.code));
  target.addEventListener("blur", () => down.clear()); // don't get stuck keys

  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    // Call after EVERY simulation step, so one press is seen by exactly one step.
    endStep: () => pressed.clear(),
  };
}
