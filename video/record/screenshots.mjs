#!/usr/bin/env node
// screenshots — capture the running Janosik UI, one PNG per feature, for the
// user guide. Sessions are authenticated by injecting the refresh cookie
// captured by `seed.mjs` (run it first), so no login screen appears except in
// the dedicated `login` shot.
//
// Run: node video/record/screenshots.mjs [name ...]
// Env: STATE (default video/record/.state.json), OUT (default site/public/screens),
//      BASE (default http://localhost:3210), API (default <BASE>/api/v1),
//      APP_BASE (default "/app"; "" for the dev server)

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const STATE = process.env.STATE ?? path.join(HERE, ".state.json");
const OUT = process.env.OUT ?? path.join(REPO, "site", "public", "screens");
const BASE = process.env.BASE ?? "http://localhost:3210";
const API = process.env.API ?? `${BASE}/api/v1`;
// UI path prefix: "/app" for the single-image build, "" for the dev server.
const APP_BASE = process.env.APP_BASE ?? "/app";
const WIDTH = 1440;
const HEIGHT = 900;

const state = JSON.parse(readFileSync(STATE, "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

// Refresh tokens rotate on every use and a reused one revokes the whole
// session, so the script logs in once and then threads each rotated cookie
// into the next context (same dance `record.mjs` does).
async function loginCookie(email, password) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 429) {
      await wait(15_000);
      continue;
    }
    if (!res.ok) throw new Error(`login ${email} -> ${res.status}`);
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith("refresh_token="));
    if (!cookie) throw new Error(`no refresh cookie for ${email}`);
    return cookie.split(";")[0].split("=").slice(1).join("=");
  }
  throw new Error(`login ${email} kept throttling`);
}

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

async function newContext(browser, { auth = true, theme = "light" } = {}) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    ...(auth ? { storageState: storageFor("ada") } : {}),
  });
  await context.addInitScript((t) => {
    localStorage.setItem("janosik-theme", t);
    localStorage.setItem("janosik-lang", "en");
  }, theme);
  return context;
}

const boardUrl = () => `${BASE}${APP_BASE}/board/${state.boardId}`;

async function openBoard(page) {
  await page.goto(boardUrl(), { waitUntil: "load" });
  await page.getByText("Backlog", { exact: true }).first().waitFor();
  await wait(500);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

// --- shots -----------------------------------------------------------------

const card = (page, title) => page.getByText(title, { exact: false }).first();

const SHOTS = {
  async login(page) {
    await page.goto(`${BASE}${APP_BASE}/`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await wait(400);
    await shot(page, "login");
  },

  async board(page) {
    await openBoard(page);
    await wait(700);
    await shot(page, "board");
  },

  async "board-switcher"(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Switch board" }).click();
    await wait(500);
    await shot(page, "board-switcher");
  },

  async "column-menu"(page) {
    await openBoard(page);
    await page
      .getByRole("button", { name: "Column options", exact: true })
      .first()
      .click();
    await wait(700);
    await shot(page, "column-menu");
  },

  async "card-quick-menu"(page) {
    await openBoard(page);
    await card(page, "Realtime cursors on the board").click({
      button: "right",
    });
    await wait(500);
    await shot(page, "card-quick-menu");
  },

  async "card-dialog"(page) {
    await openBoard(page);
    await card(page, "Realtime cursors on the board").click();
    await page.getByText("Card details", { exact: false }).first().waitFor();
    await wait(800);
    await shot(page, "card-dialog");
  },

  async "card-activity"(page) {
    await openBoard(page);
    await card(page, "Realtime cursors on the board").click();
    await wait(700);
    const body = page
      .locator('[data-testid="card-dialog"] [role="dialog"], [role="dialog"]')
      .first();
    await page
      .getByText("Comments", { exact: false })
      .last()
      .scrollIntoViewIfNeeded();
    await wait(400);
    if (await body.count())
      await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await wait(400);
    await shot(page, "card-activity");
  },

  async calendar(page) {
    await openBoard(page);
    await page
      .getByRole("group", { name: "View" })
      .getByRole("button", { name: "Calendar" })
      .click();
    await wait(1000);
    await shot(page, "calendar");
  },

  async table(page) {
    await openBoard(page);
    await page
      .getByRole("group", { name: "View" })
      .getByRole("button", { name: "Table" })
      .click();
    await wait(1000);
    await shot(page, "table");
  },

  async watch(page) {
    await openBoard(page);
    await page
      .getByRole("group", { name: "View" })
      .getByRole("button", { name: "Watch" })
      .click();
    await wait(1200);
    await shot(page, "watch");
  },

  async "card-density"(page) {
    await openBoard(page);
    await page.evaluate(() =>
      localStorage.setItem("janosik-board-density", "compact"),
    );
    await page.reload({ waitUntil: "load" });
    await page.getByText("Backlog", { exact: true }).first().waitFor();
    await wait(700);
    await shot(page, "card-density");
  },

  async filters(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Filter cards" }).click();
    await wait(600);
    await shot(page, "filters");
  },

  async search(page) {
    await openBoard(page);
    await page.keyboard.press("Control+k");
    await wait(400);
    await page.keyboard.type("share");
    await wait(700);
    await shot(page, "search");
  },

  async members(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Members" }).click();
    await wait(700);
    await shot(page, "members");
  },

  async share(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Share" }).click();
    await wait(700);
    await shot(page, "share");
  },

  async "account-profile"(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Account and settings" }).click();
    await wait(600);
    await shot(page, "account-profile");
  },

  async "account-api-keys"(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("button", { name: "API keys" }).click();
    await wait(600);
    await shot(page, "account-api-keys");
  },

  async "account-preferences"(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("button", { name: "Preferences" }).click();
    await wait(600);
    await shot(page, "account-preferences");
  },

  async "data-menu"(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Data & backups" }).click();
    await wait(500);
    await shot(page, "data-menu");
  },

  async archive(page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Data & backups" }).click();
    await page.getByText("Card archive", { exact: false }).first().click();
    await wait(700);
    await shot(page, "archive");
  },

  async shortcuts(page) {
    await openBoard(page);
    // "?" opens the cheat sheet directly (the header's "?" is a Help menu now).
    await page.keyboard.press("Shift+Slash");
    await wait(600);
    await shot(page, "shortcuts");
  },

  async "public-share"(page) {
    const owner = state.users.find((u) => u.key === "ada");
    const res = await fetch(`${API}/boards/${state.boardId}/shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ mode: "live" }),
    });
    if (!res.ok) throw new Error(`create share -> ${res.status}`);
    const share = await res.json();
    const token = share.token ?? share.shareToken;
    await page.goto(`${BASE}${APP_BASE}/s/${token}`, { waitUntil: "load" });
    await page.getByText("Backlog", { exact: true }).first().waitFor();
    await wait(900);
    await shot(page, "public-share");
  },
};

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(SHOTS);
  const ada = state.users.find((u) => u.key === "ada");
  ada.cookie = await loginCookie(ada.email, "JanosikDemo1!");
  const browser = await chromium.launch();
  const failures = [];
  for (const name of names) {
    if (!SHOTS[name]) throw new Error(`unknown shot ${name}`);
    const context = await newContext(browser, { auth: name !== "login" });
    const page = await context.newPage();
    try {
      await SHOTS[name](page);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`  FAIL ${name}: ${error.message}`);
      await page
        .screenshot({ path: path.join(OUT, `_fail-${name}.png`) })
        .catch(() => {});
    } finally {
      // Hand the rotated refresh cookie to the next context.
      const rotated = (await context.cookies()).find(
        (c) => c.name === "refresh_token",
      );
      if (rotated) ada.cookie = rotated.value;
      await context.close();
    }
  }
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`captured ${names.length} shots -> ${OUT}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
