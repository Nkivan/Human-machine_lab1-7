import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules", "**/logs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended, // includes @typescript-eslint/no-explicit-any: "zero any" is enforced, not promised
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error", // no `x!`
      // No `as` casts at all (`as const` is always allowed). The few deliberate ones carry an eslint-disable + justification.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  { files: ["client/src/**/*.ts"], languageOptions: { globals: globals.browser } },
  {
    files: [
      "server/**/*.ts",
      "shared/test/**/*.ts",
      "shared/tools/**/*.ts",
      "client/test/**/*.ts",
      "client/vite.config.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
);
