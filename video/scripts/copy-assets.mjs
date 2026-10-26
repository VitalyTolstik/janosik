// Copies the (git-ignored) assets a render needs into `video/public/`:
// the Space Grotesk woff2 files from `@fontsource/space-grotesk` and the brand
// mark. `brand/` stays the single source of truth — nothing is edited here.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(here, "..");
const publicDir = resolve(videoDir, "public");
const fontsDir = resolve(publicDir, "fonts");

mkdirSync(fontsDir, { recursive: true });

const fontPkg = dirname(
  require.resolve("@fontsource/space-grotesk/package.json"),
);
const fontFilesDir = resolve(fontPkg, "files");

for (const weight of [400, 500, 700]) {
  const file = `space-grotesk-latin-${weight}-normal.woff2`;
  copyFileSync(resolve(fontFilesDir, file), resolve(fontsDir, file));
}

const brandMark = resolve(videoDir, "../brand/assets/logo/janosik-mark.svg");
if (existsSync(brandMark)) {
  copyFileSync(brandMark, resolve(publicDir, "logo.svg"));
}

console.log("video: copied fonts + brand assets into video/public");
