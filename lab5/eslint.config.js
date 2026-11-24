import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/dist", "**/node_modules", "**/logs"] },
  js.configs.recommended,
  { files: ["client/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: [
      "server/**/*.js",
      "shared/test/**/*.js",
      "shared/tools/**/*.js",
      "client/test/**/*.js",
      "client/vite.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
  // shared/src must run in browser AND Node: it may use neither platform's globals.
  {
    files: ["shared/src/**/*.js"],
    languageOptions: { globals: { EventTarget: "readonly", CustomEvent: "readonly" } },
  },
];
