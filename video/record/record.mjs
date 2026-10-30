#!/usr/bin/env node
// record — capture the real Janosik UI as the landing-page feature clips.
//
// Each clip is a genuine Playwright recording of the running app at 1280x800
// (16:10, matching the site slots), rendered at 2x and downscaled on encode.
// Every clip is recorded twice, light and dark, by seeding `janosik-theme`
// before the app boots. The session is authenticated by injecting the refresh
// cookie captured by `seed.mjs`, so no login screen appears in the footage.
//
// Run: node video/record/record.mjs [slug ...]
// Env: API, STATE, OUT (default video/record/out), BASE (default http://localhost:3210)

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.STATE ?? path.join(HERE, ".state.json");
const OUT = process.env.OUT ?? path.join(HERE, "out");
const BASE = process.env.BASE ?? "http://localhost:3210";
// UI path prefix: "/app" for the single-image build, "" for the dev server.
const APP_BASE = process.env.APP_BASE ?? "/app";
const WIDTH = 1280;
const HEIGHT = 800;

const state = JSON.parse(readFileSync(STATE, "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

function storageFor(key) {
  const person = state.users.find((u) => u.key === key);
  return {
    cookies: [
      {
        name: "refresh_token",
        value: person.cookie,
        domain: "localhost",
        path: "/api/v1/auth",
        httpOnly: true,
        sameSite: "Strict",
        expires: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
    origins: [],
  };
}

async function openBoard(browser, key, theme, { record, zoom }) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    storageState: storageFor(key),
    ...(record
      ? { recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } } }
      : {}),
  });
  await context.addInitScript((t) => {
    localStorage.setItem("janosik-theme", t);
    localStorage.setItem("janosik-lang", "en");
  }, theme);
  const videoStart = Date.now();
  const page = await context.newPage();
  await page.goto(`${BASE}${APP_BASE}/board/${state.boardId}`, {
    waitUntil: "load",
  });
  await page.getByText("Backlog", { exact: true }).first().waitFor();
  if (zoom) {
    await page.evaluate(`document.documentElement.style.zoom = "${zoom}"`);
    await wait(250);
  }
  // Refresh tokens rotate on every use, so hand the rotated value to the next
  // context for this user (the app refreshed during boot).
  const rotated = (await context.cookies()).find(
    (c) => c.name === "refresh_token",
  );
  if (rotated) state.users.find((u) => u.key === key).cookie = rotated.value;
  return { context, page, videoStart };
}

async function drag(page, from, to, dy, fast = false) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const tx = b.x + b.width / 2;
  const ty = b.y + (dy ?? b.height / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 10, { steps: fast ? 4 : 6 });
  await wait(fast ? 60 : 150);
  await page.mouse.move(tx, ty, { steps: fast ? 14 : 28 });
  await wait(fast ? 90 : 220);
  await page.mouse.up();
}

const card = (page, title) => page.getByText(title, { exact: false }).first();
const column = (page, title) => page.getByText(title, { exact: true }).first();
const view = (page, name) =>
  page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name })
    .click();

// --- scenes ----------------------------------------------------------------

async function sceneBoard(page) {
  await wait(900);
  await drag(
    page,
    card(page, "Bulk import from CSV"),
    column(page, "In progress"),
    80,
  );
  await wait(900);
  await view(page, "Calendar");
  await wait(1100);
  await drag(
    page,
    page.getByTestId("calendar-chip").first(),
    page.getByTestId("calendar-day").nth(18),
  );
  await wait(900);
  await view(page, "Table");
  await wait(1100);
  const title = page.getByTestId("table-title-input").first();
  if (await title.count()) {
    await title.dblclick();
    await page.keyboard.type(" v2");
    await page.keyboard.press("Enter");
  }
  await wait(800);
  await view(page, "Watch");
  await wait(1400);
  await view(page, "Board");
  await wait(900);
}

async function sceneCards(page) {
  await wait(700);
  await card(page, "Realtime cursors on the board").click();
  await wait(1100);
  await page.getByText("Presence avatars", { exact: false }).first().click();
  await wait(700);
  const comment = page.getByTestId("comment-input");
  await comment.scrollIntoViewIfNeeded();
  await comment.click();
  await page.keyboard.type("Cursor colours now match the presence stack.");
  await wait(500);
  await page.getByTestId("comment-send").click();
  await wait(900);
  await page.keyboard.press("Escape");
  await wait(700);
}

async function sceneSharing(page) {
  await wait(800);
  await page.getByRole("button", { name: "Share" }).click();
  await wait(900);
  await page.getByTestId("share-create").click();
  await wait(1100);
  const copy = page.getByRole("button", { name: /copy/i }).first();
  if (await copy.count()) await copy.click();
  await wait(900);
  await page.keyboard.press("Escape");
  await wait(500);
}

async function sceneHero(page, { actor }) {
  // Five agents keep the flow moving: they pull cards from Backlog into In
  // progress, then push them into Review, then pull the next batch. Every
  // drop lands at the top of the target column, so the moved card stays on
  // screen. All three columns are in frame at this zoom.
  const wave = (moves) =>
    Promise.all(
      moves.map(({ key, title, to }) =>
        drag(
          actor(key).page,
          card(actor(key).page, title),
          column(actor(key).page, to),
          44,
          true,
        ),
      ),
    );
  const agents = ["grace", "leo", "nina", "omar", "priya"];
  const first = [
    "Single sign-on for enterprise",
    "Bulk import from CSV",
    "Keyboard shortcut cheat sheet",
    "Dark mode contrast pass",
    "Mobile drag on touch screens",
  ];
  const second = [
    "SAML group mapping",
    "Audit log export",
    "Board templates",
    "Card watchers",
    "Slack notifications",
  ];
  await wait(600);
  await wave(
    agents.map((key, i) => ({ key, title: first[i], to: "In progress" })),
  );
  await wait(500);
  await wave(agents.map((key, i) => ({ key, title: first[i], to: "Review" })));
  await wait(500);
  await wave(
    agents.map((key, i) => ({ key, title: second[i], to: "In progress" })),
  );
  await wait(800);
  await page.mouse.move(660, 430, { steps: 16 });
  await wait(900);
}

async function sceneRealtime(page, { actor }) {
  const grace = actor("grace");
  await wait(1400);
  await drag(
    grace.page,
    card(grace.page, "Attachment previews"),
    column(grace.page, "Review"),
    80,
  );
  await wait(1400);
  await page.mouse.move(700, 420, { steps: 20 });
  await wait(1200);
  await card(page, "Public read-only share links").hover();
  await wait(1500);
}

const SCENES = {
  "hero-swarm": {
    audience: ["grace", "leo", "nina", "omar", "priya", "sam"],
    zoom: 1.3,
    run: sceneHero,
  },
  "feature-board": { audience: [], run: sceneBoard },
  "feature-cards": { audience: [], run: sceneCards },
  "feature-realtime": { audience: ["grace"], run: sceneRealtime },
  "feature-sharing": { audience: [], run: sceneSharing },
};

async function recordClip(browser, slug, theme, manifest) {
  const scene = SCENES[slug];
  const background = [];
  const actor = (key) => background.find((c) => c.key === key);
  const recorded = await openBoard(browser, "ada", theme, {
    record: true,
    zoom: scene.zoom,
  });
  const video = recorded.page.video();
  for (const key of scene.audience) {
    const opened = await openBoard(browser, key, theme, { record: false });
    opened.key = key;
    background.push(opened);
  }
  await wait(600);
  const sceneStart = Date.now();
  await scene.run(recorded.page, { actor, recorded, background });
  const sceneEnd = Date.now();
  await recorded.context.close();
  for (const extra of background) await extra.context.close();
  const source = await video.path();
  const target = path.join(
    OUT,
    `${slug}${theme === "dark" ? "-dark" : ""}.webm`,
  );
  renameSync(source, target);
  manifest[slug][theme] = {
    file: path.basename(target),
    startMs: Math.max(0, sceneStart - recorded.videoStart - 250),
    endMs: sceneEnd - recorded.videoStart + 250,
  };
  console.log(`  ${slug} ${theme} -> ${path.basename(target)}`);
}

async function main() {
  const requested = process.argv.slice(2);
  const slugs = requested.length ? requested : Object.keys(SCENES);
  const browser = await chromium.launch();
  const manifest = {};
  for (const slug of slugs) {
    if (!SCENES[slug]) throw new Error(`unknown clip ${slug}`);
    manifest[slug] = {};
    for (const theme of ["light", "dark"]) {
      await recordClip(browser, slug, theme, manifest);
    }
  }
  writeFileSync(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await browser.close();
  console.log("recorded:", slugs.join(", "));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
