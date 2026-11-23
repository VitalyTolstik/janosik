import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest runs inside the monorepo and imports the shared package from source.
 * The explicit alias keeps a linked/hoisted @janosik/shared from resolving to
 * a different checkout in a git worktree (node_modules are symlinked there).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@janosik/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
