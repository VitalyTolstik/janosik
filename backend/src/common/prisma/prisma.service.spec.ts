import { withConnectionLimit } from "./prisma.service";

/**
 * TASK-153 (B14): Prisma's pool is CPU-sized by default, so a couple of
 * replicas could exhaust `max_connections`. The cap is applied only when the
 * DSN does not already name one.
 */
describe("withConnectionLimit", () => {
  it("adds connection_limit to a DSN without one", () => {
    const url = withConnectionLimit("postgresql://u:p@db:5432/janosik", 10);
    expect(url).toContain("connection_limit=10");
  });

  it("keeps an explicit connection_limit", () => {
    const url = "postgresql://u:p@db/janosik?connection_limit=5";
    expect(withConnectionLimit(url, 10)).toBe(url);
  });

  it("leaves 0 (Prisma default) and non-URLs untouched", () => {
    expect(withConnectionLimit("postgresql://u:p@db/janosik", 0)).toBe(
      "postgresql://u:p@db/janosik",
    );
    expect(withConnectionLimit("not a url", 10)).toBe("not a url");
  });
});
