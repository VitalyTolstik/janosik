// The video workspace is React (Remotion), but it has no Fast Refresh / HMR
// concerns and no `react-refresh` entry points, so it uses a lean flat config
// instead of reusing `ui/eslint.config.js`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node scripts and the Remotion config run outside the browser.
    files: ["scripts/**/*.mjs", "*.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
