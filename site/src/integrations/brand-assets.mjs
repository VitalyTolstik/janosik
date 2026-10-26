import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brandAssetsDir = resolve(here, "../../../brand/assets");
const publicDir = resolve(here, "../../public");

// The `brand/` workspace is the single source of truth for assets. These
// copies are generated (and git-ignored) so the site can serve them as plain
// static files — favicon via Starlight's default `/favicon.svg` path, and the
// social card via `/og.png`.
const files = [
  ["logo/janosik-mark.svg", "favicon.svg"],
  ["og/janosik-og.png", "og.png"],
];

/** @returns {import('astro').AstroIntegration} */
export default function brandAssets() {
  return {
    name: "janosik-brand-assets",
    hooks: {
      "astro:config:setup": () => {
        mkdirSync(publicDir, { recursive: true });
        for (const [from, to] of files) {
          copyFileSync(resolve(brandAssetsDir, from), resolve(publicDir, to));
        }
      },
    },
  };
}
