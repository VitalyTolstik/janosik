import { describe, expect, it } from "vitest";
import {
  adminActivityHref,
  adminAttachmentsHref,
  adminCardsHref,
  adminCommentsHref,
  adminCommandsHref,
  currentAdminPath,
  readReturnTo,
  withReturnTo,
} from "./admin-navigation";

/** TASK-176.5/176.6 — shareable list links and a safe return path. */

describe("admin navigation", () => {
  it("builds exact addressable filters", () => {
    expect(adminCardsHref({ boardId: "b-1" })).toBe(
      "/admin/boards?tab=cards&boardId=b-1",
    );
    expect(adminCardsHref({ columnId: "col-1" })).toBe(
      "/admin/boards?tab=cards&columnId=col-1",
    );
    expect(adminCardsHref({ labelId: "l-1" })).toBe(
      "/admin/boards?tab=cards&labelId=l-1",
    );
    expect(adminCommentsHref("b-1")).toBe(
      "/admin/moderation?tab=comments&boardId=b-1",
    );
    expect(adminAttachmentsHref("b-1")).toBe(
      "/admin/moderation?tab=attachments&boardId=b-1",
    );
    expect(adminCommandsHref("b-1")).toBe(
      "/admin/audit?tab=commands&boardId=b-1",
    );
    expect(adminActivityHref("b-1")).toBe(
      "/admin/audit?tab=activity&boardId=b-1",
    );
  });

  it("round-trips returnTo without dropping an existing query", () => {
    const href = withReturnTo(
      "/admin/cards/c-1?comment=cm-1",
      "/admin/moderation?tab=comments&boardId=b-1",
    );
    const url = new URL(href, "http://admin.test");
    expect(url.pathname).toBe("/admin/cards/c-1");
    expect(url.searchParams.get("comment")).toBe("cm-1");
    expect(url.searchParams.get("returnTo")).toBe(
      "/admin/moderation?tab=comments&boardId=b-1",
    );

    const back = readReturnTo(url.searchParams);
    expect(back).toBe("/admin/moderation?tab=comments&boardId=b-1");
  });

  it("keeps a fragment after the query when adding returnTo", () => {
    const href = withReturnTo(
      "/admin/cards/c-1#comments",
      "/admin/moderation?tab=comments",
    );
    expect(href.startsWith("/admin/cards/c-1?returnTo=")).toBe(true);
    expect(href.endsWith("#comments")).toBe(true);
    const url = new URL(href, "http://admin.test");
    expect(url.searchParams.get("returnTo")).toBe(
      "/admin/moderation?tab=comments",
    );
    expect(url.hash).toBe("#comments");
  });

  it("refuses external or malformed return paths", () => {
    const read = (value: string) =>
      readReturnTo(new URLSearchParams({ returnTo: value }));
    expect(read("https://evil.example/admin")).toBeNull();
    expect(read("//evil.example/admin")).toBeNull();
    expect(read("/admin\\evil")).toBeNull();
    expect(read("/admin/../evil")).toBeNull();
    expect(read("/other")).toBeNull();
    expect(read("/admin/users?tab=sessions")).toBe("/admin/users?tab=sessions");
  });

  it("keeps the current pathname and query for a row link", () => {
    expect(
      currentAdminPath({
        pathname: "/admin/moderation",
        search: "?tab=comments&boardId=b-1",
      }),
    ).toBe("/admin/moderation?tab=comments&boardId=b-1");
  });
});
