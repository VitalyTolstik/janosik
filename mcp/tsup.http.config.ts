import { defineConfig } from "tsup";

/**
 * Self-contained bundle used only by the gateway container (TASK-200.8).
 *
 * The published npm package keeps the MCP SDK and Zod external, but the
 * gateway image should not install a whole workspace dependency tree just to
 * run one file. Bundling the two runtime dependencies keeps the image a Node
 * base plus ~1.5 MB, and `readVersion` still finds `mcp/package.json` because
 * the bundle sits in `mcp/dist`.
 */
export default defineConfig({
  entry: ["src/http.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist-http",
  clean: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});
