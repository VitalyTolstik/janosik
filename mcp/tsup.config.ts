import { defineConfig } from "tsup";

/**
 * Bundles the server into a single `dist/index.js` for `npx @janosik/mcp`.
 * `@janosik/shared` is inlined (it is source-only in the monorepo); the MCP
 * SDK and Zod stay external so they resolve from the published dependencies.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  noExternal: ["@janosik/shared"],
  external: ["@modelcontextprotocol/sdk", "zod"],
  banner: { js: "#!/usr/bin/env node" },
});
