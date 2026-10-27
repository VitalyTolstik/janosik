import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inlineScriptHashes } from "./csp";

describe("inlineScriptHashes", () => {
  it("hashes exactly the inline scripts of the served HTML", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "janosik-csp-"));
    const theme =
      "\n(function(){document.documentElement.classList.add('dark')})();\n";
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<html><head><script>${theme}</script><script type="module" src="/a.js"></script></head></html>`,
    );
    fs.writeFileSync(
      path.join(dir, "docs", "page.html"),
      `<script type="module">console.log(1)</script><script type="application/ld+json">{"a":1}</script>`,
    );
    const sha = (body: string) =>
      `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

    expect(inlineScriptHashes([dir, "", "/does/not/exist"])).toEqual(
      [sha(theme), sha("console.log(1)")].sort(),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
