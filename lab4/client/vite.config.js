import { defineConfig } from "vite";

// Dev-only endpoints to test failures (they do not exist in `vite preview` / production):
//   /test/slow?ms=3000     -> JSON after a delay
//   /test/flaky?run=ID     -> 503 twice, then 200 (per run id)
//   /test/corrupt          -> invalid JSON
//   /test/status/404       -> a REAL 404 (Vite's SPA fallback would otherwise return index.html)
const flakyCalls = new Map();
const json = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body);
};

export default defineConfig({
  // Dev: the Vite server proxies the API and the WebSocket to the Node server (prod: Node serves dist/ itself).
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "http://127.0.0.1:3000", ws: true },
    },
  },
  plugins: [
    {
      name: "dev-test-endpoints",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          if (url.pathname === "/test/slow") {
            setTimeout(() => json(res, '{"ok":true}'), Number(url.searchParams.get("ms") ?? 3000));
          } else if (url.pathname === "/test/flaky") {
            const id = url.searchParams.get("run") ?? "default";
            const n = (flakyCalls.get(id) ?? 0) + 1;
            flakyCalls.set(id, n);
            if (n < 3) json(res, '{"error":"busy"}', 503);
            else json(res, '{"ok":true}');
          } else if (url.pathname === "/test/corrupt") {
            json(res, "{not valid json");
          } else if (url.pathname.startsWith("/test/status/")) {
            json(res, '{"error":"test"}', Number(url.pathname.split("/").pop()));
          } else next();
        });
      },
    },
  ],
});
