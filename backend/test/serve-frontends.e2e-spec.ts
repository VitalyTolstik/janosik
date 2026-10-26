import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { serveFrontends } from "@/common/serve-frontends";

/**
 * Single-container delivery (TASK-38b, TASK-123): the API serves the
 * marketing site at `/` and the app under `/app`. The routing contract
 * mirrors `deploy/nginx.conf` — the site owns the root, the app owns its
 * base with a shell fallback for deep links, hashed assets are immutable,
 * the API is never swallowed, and public share pages stay framable.
 */
describe("Static frontends serving (e2e)", () => {
  let app: NestExpressApplication;
  let siteDir: string;
  let appDir: string;

  beforeAll(async () => {
    siteDir = mkdtempSync(path.join(tmpdir(), "janosik-site-"));
    writeFileSync(
      path.join(siteDir, "index.html"),
      "<!doctype html><title>Janosik site</title>",
    );
    writeFileSync(
      path.join(siteDir, "404.html"),
      "<!doctype html><title>Not found</title>",
    );
    mkdirSync(path.join(siteDir, "_astro"));
    writeFileSync(path.join(siteDir, "_astro", "index-abc.css"), "body{}");

    appDir = mkdtempSync(path.join(tmpdir(), "janosik-app-"));
    writeFileSync(
      path.join(appDir, "index.html"),
      "<!doctype html><title>Janosik app</title>",
    );
    mkdirSync(path.join(appDir, "assets"));
    writeFileSync(
      path.join(appDir, "assets", "index-abc.js"),
      "console.log(1)",
    );
    writeFileSync(path.join(appDir, "sw.js"), "self.addEventListener('fetch')");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    serveFrontends(app, { appDir, appBase: "/app/", siteDir });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(siteDir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  });

  const server = () => request(app.getHttpServer());

  it("serves the marketing site at the root", async () => {
    const res = await server().get("/").expect(200);
    expect(res.text).toContain("Janosik site");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves the site's hashed assets as immutable", async () => {
    const res = await server().get("/_astro/index-abc.css").expect(200);
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("returns the site 404 for unknown site paths", async () => {
    const res = await server().get("/nope").expect(404);
    expect(res.text).toContain("Not found");
  });

  it("serves the app shell under its base", async () => {
    const res = await server().get("/app/").expect(200);
    expect(res.text).toContain("Janosik app");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("falls back to the app shell for client-side deep links", async () => {
    const res = await server().get("/app/board/abc?card=xyz").expect(200);
    expect(res.text).toContain("Janosik app");
  });

  it("serves the app's hashed assets as immutable", async () => {
    const res = await server().get("/app/assets/index-abc.js").expect(200);
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("revalidates the service worker", async () => {
    const res = await server().get("/app/sw.js").expect(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("never swallows the API", async () => {
    const res = await server().get("/api/v1/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.text).not.toContain("Janosik");
  });

  it("keeps public share pages framable and unindexed", async () => {
    const res = await server().get("/app/s/token123").expect(200);
    expect(res.text).toContain("Janosik app");
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors *",
    );
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });
});
