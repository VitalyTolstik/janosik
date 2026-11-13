import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareRuntimeSite } from "./runtime-site";

describe("prepareRuntimeSite", () => {
  let source: string;
  let generated: string | undefined;

  beforeEach(() => {
    source = fs.mkdtempSync(path.join(os.tmpdir(), "janosik-site-test-"));
  });

  afterEach(() => {
    fs.rmSync(source, { recursive: true, force: true });
    if (generated && generated !== source) {
      fs.rmSync(generated, { recursive: true, force: true });
    }
    generated = undefined;
  });

  it("rewrites generated URLs while preserving localhost examples and the source", () => {
    fs.writeFileSync(
      path.join(source, "index.html"),
      '<link href="https://site-origin.invalid/docs/"> http://localhost:3000',
    );
    fs.writeFileSync(
      path.join(source, "sitemap.xml"),
      "<loc>https://site-origin.invalid/docs/</loc>",
    );
    fs.writeFileSync(
      path.join(source, "robots.txt"),
      "Sitemap: https://site-origin.invalid/sitemap.xml",
    );

    generated = prepareRuntimeSite(source, "https://example.org");
    expect(fs.readFileSync(path.join(generated, "index.html"), "utf8")).toBe(
      '<link href="https://example.org/docs/"> http://localhost:3000',
    );
    expect(fs.readFileSync(path.join(generated, "sitemap.xml"), "utf8")).toBe(
      "<loc>https://example.org/docs/</loc>",
    );
    expect(fs.readFileSync(path.join(generated, "robots.txt"), "utf8")).toBe(
      "Sitemap: https://example.org/sitemap.xml",
    );
    expect(fs.readFileSync(path.join(source, "index.html"), "utf8")).toContain(
      "https://site-origin.invalid",
    );
  });

  it("does not rewrite lookalike hosts, userinfo, ports or the wrong protocol", () => {
    const malicious = [
      "https://site-origin.invalid.evil/docs/",
      "https://user@site-origin.invalid/docs/",
      "https://site-origin.invalid:8443/docs/",
      "http://site-origin.invalid/docs/",
      "https://site-origin.invalid@evil.example/docs/",
    ].join("\n");
    fs.writeFileSync(path.join(source, "index.html"), malicious);

    generated = prepareRuntimeSite(source, "https://example.org");

    expect(generated).toBe(source);
    expect(fs.readFileSync(path.join(source, "index.html"), "utf8")).toBe(
      malicious,
    );
  });

  it("rewrites exact origins with a path, query or fragment", () => {
    fs.writeFileSync(
      path.join(source, "index.html"),
      [
        "https://site-origin.invalid/docs/",
        "https://site-origin.invalid?x=1",
        "https://site-origin.invalid#top",
      ].join("\n"),
    );

    generated = prepareRuntimeSite(source, "https://example.org");
    const rewritten = fs.readFileSync(
      path.join(generated, "index.html"),
      "utf8",
    );
    expect(rewritten).toContain("https://example.org/docs/");
    expect(rewritten).toContain("https://example.org/?x=1");
    expect(rewritten).toContain("https://example.org/#top");
  });

  it("leaves sites with an explicit build origin untouched", () => {
    fs.writeFileSync(
      path.join(source, "index.html"),
      "https://custom.example/",
    );
    generated = prepareRuntimeSite(source, "https://another.example");
    expect(generated).toBe(source);
    expect(fs.readFileSync(path.join(source, "index.html"), "utf8")).toBe(
      "https://custom.example/",
    );
  });
});
