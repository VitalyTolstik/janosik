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
];
