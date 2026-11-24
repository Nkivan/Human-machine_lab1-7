// ?test=<mode> injects broken assets so you can screenshot the failure gallery.
// Needs the dev server (endpoints live in vite.config.js).
export function applyTestMode(manifest, mode) {
  manifest.json ??= {};
  manifest.sounds ??= {};
  switch (mode) {
    case "404-sound": manifest.sounds.ghost = { url: "/test/status/404", optional: true }; break; // graceful
    case "404-required": manifest.json.ghost = { url: "/test/status/404" }; break; // retry screen
    case "slow": for (let i = 1; i <= 3; i++) manifest.json[`slow${i}`] = { url: `/test/slow?ms=3000&n=${i}` }; break;
    case "flaky": manifest.json.flaky = { url: `/test/flaky?run=${Date.now()}` }; break; // 503, 503, 200
    case "corrupt": manifest.json.corrupt = { url: "/test/corrupt" }; break; // SyntaxError
    case "timeout": manifest.json.hang = { url: "/test/slow?ms=60000" }; break; // 5 s request timeout
    case "abort": manifest.json.slow = { url: "/test/slow?ms=3000" }; break; // main.js aborts at 600 ms
  }
  return manifest;
}
