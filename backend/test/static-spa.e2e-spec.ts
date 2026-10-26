import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { serveSpa } from "@/common/serve-spa";

/**
 * Single-container delivery (TASK-38b): the API also serves the built SPA.
 * The routing contract mirrors `deploy/nginx.conf` — deep links fall back to
 * the shell, hashed assets are immutable, the API is never swallowed, and
 * public share pages stay framable.
 */
describe("Static SPA serving (e2e)", () => {
  let app: NestExpressApplication;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "janosik-spa-"));
    writeFileSync(
      path.join(dir, "index.html"),
      "<!doctype html><title>Janosik</title>",
    );
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "index-abc.js"), "console.log(1)");
    writeFileSync(path.join(dir, "sw.js"), "self.addEventListener('fetch')");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    serveSpa(app, dir);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const server = () => request(app.getHttpServer());

  it("serves the shell at the root", async () => {
    const res = await server().get("/").expect(200);
    expect(res.text).toContain("Janosik");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("falls back to the shell for client-side deep links", async () => {
    const res = await server().get("/board/abc?card=xyz").expect(200);
    expect(res.text).toContain("Janosik");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await server().get("/assets/index-abc.js").expect(200);
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("revalidates the service worker", async () => {
    const res = await server().get("/sw.js").expect(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("never swallows the API", async () => {
    const res = await server().get("/api/v1/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.text).not.toContain("Janosik");
  });

  it("keeps public share pages framable and unindexed", async () => {
    const res = await server().get("/s/token123").expect(200);
    expect(res.text).toContain("Janosik");
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors *",
    );
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });
});
