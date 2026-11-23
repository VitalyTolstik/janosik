// ESLint for the repo-level Node scripts (TASK-200.1).
//
// Workspace packages keep their own configs; this one only exists so the
// plain-ESM perf harness is linted instead of silently skipped.

import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "scripts/perf/results/**"] },
  js.configs.recommended,
  {
    files: ["scripts/perf/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // TASK-200.12 deployment checks and the optional on-host smoke script.
    files: ["scripts/deploy/**/*.mjs", "deploy/scale/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
