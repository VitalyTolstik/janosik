// Renders every registered composition to the marketing site's media folder:
// for each clip and each theme, an mp4 (H.264), a webm (VP8) and a JPEG poster.
// Bundling happens once and is reused across all renders.
//
// The site ships both themes and switches on `data-theme` (the clips are
// baked, so they cannot follow CSS variables at runtime).
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(here, "..");
const outDir = resolve(videoDir, "../site/public/media");
mkdirSync(outDir, { recursive: true });

// `slug` is the file name the site imports; `id` is the composition id; `poster`
// is the frame captured as the `<video poster>` (a settled, representative one).
const clips = [
  { slug: "hero-swarm", id: "Hero", poster: 160 },
  { slug: "feature-board", id: "Board", poster: 60 },
  { slug: "feature-realtime", id: "Realtime", poster: 120 },
  { slug: "feature-cards", id: "Cards", poster: 170 },
  { slug: "feature-sharing", id: "Sharing", poster: 150 },
  { slug: "feature-selfhost", id: "Selfhost", poster: 180 },
];

// Light is the site default; dark gets a `-dark` suffix and the app palette.
const themes = [
  { theme: "light", suffix: "" },
  { theme: "dark", suffix: "-dark" },
];

const entryPoint = resolve(videoDir, "src/index.ts");
const serveUrl = await bundle({ entryPoint });

for (const { slug, id, poster } of clips) {
  for (const { theme, suffix } of themes) {
    const inputProps = { theme };
    const composition = await selectComposition({ serveUrl, id, inputProps });
    const base = resolve(outDir, `${slug}${suffix}`);

    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      outputLocation: `${base}.mp4`,
    });
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "vp8",
      outputLocation: `${base}.webm`,
    });
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      output: `${base}.jpg`,
      frame: poster,
      imageFormat: "jpeg",
      jpegQuality: 82,
    });

    console.log(
      `video: rendered ${slug}${suffix} (${theme}, ${composition.width}x${composition.height})`,
    );
  }
}

console.log(`video: all clips written to ${outDir}`);
