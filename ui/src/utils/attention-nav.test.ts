import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttentionNotificationDto } from "@janosik/shared";

/**
 * TASK-177.20: one assignment opens its card; a coalesced batch opens the
 * board filtered to the new assignee. The href carries the deploy base once.
 */
describe("attention-nav card.assigned", () => {
  const location = { pathname: "/board/b-1", search: "" };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function nav() {
    vi.stubEnv("BASE_URL", "/app/");
    vi.resetModules();
    return import("./attention-nav");
  }

  const row = (
    data: Record<string, unknown>,
    boardId: string | null = "b-1",
  ): Pick<AttentionNotificationDto, "type" | "boardId" | "data"> => ({
    type: "card.assigned",
    boardId,
    data,
  });

  it("opens the exact card for a single assignment", async () => {
    const { attentionTarget } = await nav();
    expect(
      attentionTarget(
        row({ assigneeId: "u-1", cardIds: ["c-1"], cardId: "c-1" }),
        location,
        "MEMBER",
      ),
    ).toEqual({
      kind: "card",
      path: "/board/b-1?card=c-1",
      href: "/app/board/b-1?card=c-1",
    });
  });

  it("opens the board filtered by assignee for a coalesced batch", async () => {
    const { attentionTarget } = await nav();
    expect(
      attentionTarget(
        row({ assigneeId: "u-1", cardIds: ["c-1", "c-2"] }),
        location,
        "MEMBER",
      ),
    ).toEqual({
      kind: "board",
      path: "/board/b-1?f.assignee=u-1",
      href: "/app/board/b-1?f.assignee=u-1",
    });
  });

  it("has no target without a board or an assignee", async () => {
    const { attentionTarget } = await nav();
    expect(
      attentionTarget(row({ assigneeId: "u-1" }, null), location, "MEMBER"),
    ).toBeNull();
    expect(
      attentionTarget(row({ cardIds: ["c-1"] }), location, "MEMBER"),
    ).toBeNull();
  });
});
