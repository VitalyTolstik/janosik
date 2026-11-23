import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-156: under the self-host deploy base (`/app/`) a card link must be
 * prefixed exactly once. `cardHref` is site-root-relative; `cardPath` is the
 * router-relative form the share helper takes.
 */
describe("card-nav under a deploy base", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds a card path and an idempotent href", async () => {
    vi.stubEnv("BASE_URL", "/app/");
    vi.resetModules();
    const { cardHref, cardPath } = await import("./card-nav");
    const { appPath, appShareUrl } = await import("./app-path");

    expect(cardPath("b-1", "c-1")).toBe("/board/b-1?card=c-1");
    expect(cardHref("b-1", "c-1")).toBe("/app/board/b-1?card=c-1");
    expect(appPath(cardHref("b-1", "c-1"))).toBe("/app/board/b-1?card=c-1");
    expect(appShareUrl(cardPath("b-1", "c-1"))).toBe(
      `${window.location.origin}/app/board/b-1?card=c-1`,
    );
  });

  it("recognises a read-model archived id without a loaded card", async () => {
    const { hasCard } = await import("./card-nav");
    const board = {
      cards: {},
      archivedCardIds: ["archived-1"],
    };
    expect(hasCard(board, "archived-1")).toBe(true);
    expect(hasCard(board, "constructor")).toBe(false);
    expect(hasCard(board, "missing")).toBe(false);
  });
});
