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
