import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/dist", "**/node_modules", "**/logs"] },
  js.configs.recommended,
  { files: ["client/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.js", "client/vite.config.js"], languageOptions: { globals: globals.node } },
];
