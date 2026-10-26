// Renders every registered composition to the marketing site's media folder:
// an mp4 (H.264), a webm (VP8) and a JPEG poster per clip. Bundling happens
// once and is reused across all renders — much faster than N CLI invocations.
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
  { slug: "hero-swarm", id: "Hero", poster: 100 },
  { slug: "feature-board", id: "Board", poster: 110 },
  { slug: "feature-realtime", id: "Realtime", poster: 90 },
  { slug: "feature-cards", id: "Cards", poster: 170 },
  { slug: "feature-sharing", id: "Sharing", poster: 150 },
  { slug: "feature-selfhost", id: "Selfhost", poster: 180 },
];

const entryPoint = resolve(videoDir, "src/index.ts");
const serveUrl = await bundle({ entryPoint });

for (const { slug, id, poster } of clips) {
  const composition = await selectComposition({ serveUrl, id });
  const base = resolve(outDir, slug);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: `${base}.mp4`,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "vp8",
    outputLocation: `${base}.webm`,
  });
  await renderStill({
    composition,
    serveUrl,
    output: `${base}.jpg`,
    frame: poster,
    imageFormat: "jpeg",
    jpegQuality: 82,
  });

  console.log(
    `video: rendered ${slug} (${composition.width}x${composition.height})`,
  );
}

console.log(`video: all clips written to ${outDir}`);
