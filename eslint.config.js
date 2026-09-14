import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Provider+hook pairs (useTheme, useToast, ...) are an idiomatic
      // single-file pattern; Fast Refresh's full-reload fallback for them
      // is acceptable, so only non-hook exports are flagged.
      "react-refresh/only-export-components": [
        "warn",
        {
          // Exact names only (the rule uses Set.has, not regex): hook
          // exports next to their providers and shadcn's buttonVariants.
          allowExportNames: [
            "useI18n",
            "useHour12",
            "useTimeFormat",
            "useTheme",
            "useBoard",
            "useBoardState",
            "useBoardActions",
            "useBoardHistory",
            "useCardLabels",
            "useBoardBackground",
            "useBoardGlass",
            "useToast",
            "buttonVariants",
          ],
        },
      ],
      // New in react-hooks v7 and currently opinionated about patterns the
      // codebase relies on (dialog state reset on open, render-time clock).
      // Demoted to warnings until the context split (TASK-21.4) and friends.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Service worker runs outside the page context (self, caches, clients).
    files: ["src/pwa/sw.js"],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    // Test components intentionally capture values in outer variables to
    // assert on them; the render-purity rules are for production code.
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/globals": "off",
    },
  },
  {
    files: ["*.config.ts", "*.config.js", "vite/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
