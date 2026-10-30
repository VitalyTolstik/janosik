#!/usr/bin/env node
// encode — turn the raw Playwright recordings into the site's media assets.
//
// For each clip and theme it trims the leading page-load and trailing tail
// (offsets from out/manifest.json), then writes an H.264 mp4, a VP9 webm and a
// JPEG poster into site/public/media, matching the slugs the site expects.
//
// Run: node video/record/encode.mjs
// Env: OUT (default video/record/out), MEDIA (default site/public/media)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = process.env.OUT ?? path.join(HERE, "out");
const MEDIA = process.env.MEDIA ?? path.join(REPO, "site/public/media");
const manifest = JSON.parse(
  readFileSync(path.join(OUT, "manifest.json"), "utf8"),
);

mkdirSync(MEDIA, { recursive: true });

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

const seconds = (ms) => (ms / 1000).toFixed(3);

for (const [slug, themes] of Object.entries(manifest)) {
  for (const [theme, clip] of Object.entries(themes)) {
    const suffix = theme === "dark" ? "-dark" : "";
    const input = path.join(OUT, clip.file);
    const base = path.join(MEDIA, `${slug}${suffix}`);
    const start = seconds(clip.startMs);
    const end = seconds(clip.endMs);
    const posterAt = seconds(clip.posterMs ?? clip.startMs + 700);

    ffmpeg([
      "-ss",
      start,
      "-to",
      end,
      "-i",
      input,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "20",
      "-movflags",
      "+faststart",
      `${base}.mp4`,
    ]);
    ffmpeg([
      "-ss",
      start,
      "-to",
      end,
      "-i",
      input,
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "33",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      `${base}.webm`,
    ]);
    ffmpeg([
      "-ss",
      posterAt,
      "-i",
      input,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      `${base}.jpg`,
    ]);
    console.log(`  ${slug}${suffix}`);
  }
}

console.log(`encoded into ${path.relative(REPO, MEDIA)}`);
