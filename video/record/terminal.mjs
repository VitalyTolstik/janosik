#!/usr/bin/env node
// terminal — the self-host clip. It runs the documented start-up commands for
// real, captures their stdout/stderr, and plays that output in a terminal
// recorded by Playwright. Nothing is typed by hand; every line is real output.
//
// Run: node video/record/terminal.mjs
// Env: OUT, STATE (unused), MEDIA via encode.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = process.env.OUT ?? path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });

function run(args) {
  try {
    return execFileSync(args[0], args.slice(1), {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

const steps = [];
function command(text) {
  steps.push({ type: "command", text });
}
function output(text) {
  for (const line of text.replace(/\s+$/, "").split("\n")) {
    steps.push({ type: "output", text: line });
  }
}

command("docker compose -f backend/docker-compose.yml up -d");
output(
  run(["docker", "compose", "-f", "backend/docker-compose.yml", "up", "-d"]),
);

command("docker compose -f backend/docker-compose.yml ps");
output(run(["docker", "compose", "-f", "backend/docker-compose.yml", "ps"]));

command("npm run prisma:deploy -w backend");
output(run(["npm", "run", "prisma:deploy", "-w", "backend"]));

function html(theme) {
  const dark = theme === "dark";
  const colors = dark
    ? {
        bg: "#0b1120",
        fg: "#e2e8f0",
        dim: "#7c8aa5",
        prompt: "#60a5fa",
        ok: "#4ade80",
      }
    : {
        bg: "#ffffff",
        fg: "#1e293b",
        dim: "#64748b",
        prompt: "#2563eb",
        ok: "#16a34a",
      };
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:${colors.bg};}
    .term{font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:${colors.fg};
      padding:26px 30px;white-space:pre-wrap;word-break:break-word;}
    .p{color:${colors.prompt};font-weight:600}
    .dim{color:${colors.dim}}
    .ok{color:${colors.ok}}
    .cursor{display:inline-block;width:8px;height:16px;background:${colors.fg};
      vertical-align:-3px;animation:b 1s steps(1) infinite}
    @keyframes b{50%{opacity:0}}
  </style><div class="term" id="t"></div>
  <script>
    const steps = ${JSON.stringify(steps)};
    const t = document.getElementById("t");
    const prompt = '<span class="p">$</span> ';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function type(text) {
      const line = document.createElement("div");
      line.innerHTML = prompt + '<span class="cmd"></span><span class="cursor"></span>';
      t.appendChild(line);
      const cmd = line.querySelector(".cmd");
      for (const ch of text) { cmd.textContent += ch; await sleep(26); }
      line.querySelector(".cursor").remove();
    }
    function emit(text) {
      const line = document.createElement("div");
      line.textContent = text;
      if (/ready|Running|healthy|applied|migrat/i.test(text)) line.className = "ok";
      else if (/^\\s*$/.test(text)) line.className = "dim";
      t.appendChild(line);
    }
    (async () => {
      for (const s of steps) {
        if (s.type === "command") { await type(s.text); await sleep(200); }
        else { emit(s.text); await sleep(90); }
      }
      const c = document.createElement("div");
      c.innerHTML = prompt + '<span class="cursor"></span>';
      t.appendChild(c);
      await sleep(900);
      window.__done = true;
    })();
  </script>`;
}

async function main() {
  const browser = await chromium.launch();
  const manifest = JSON.parse(
    readFileSync(path.join(OUT, "manifest.json"), "utf8"),
  );
  manifest["feature-selfhost"] = {};
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
    });
    const videoStart = Date.now();
    const page = await context.newPage();
    await page.setContent(html(theme), { waitUntil: "load" });
    const sceneStart = Date.now();
    await page.waitForFunction("window.__done === true", null, {
      timeout: 60000,
    });
    const sceneEnd = Date.now();
    const video = page.video();
    await context.close();
    const source = await video.path();
    const name = `feature-selfhost${theme === "dark" ? "-dark" : ""}.webm`;
    renameSync(source, path.join(OUT, name));
    manifest["feature-selfhost"][theme] = {
      file: name,
      startMs: Math.max(0, sceneStart - videoStart - 250),
      endMs: sceneEnd - videoStart + 250,
    };
    console.log(`  feature-selfhost ${theme} -> ${name}`);
  }
  await browser.close();
  writeFileSync(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
