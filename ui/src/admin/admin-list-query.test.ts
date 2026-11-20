import { describe, expect, it } from "vitest";
import {
  EMPTY_ADMIN_LIST_FILTERS,
  adminFiltersKey,
  adminListQueryKey,
  hasAdminFilters,
  readAdminListQuery,
  writeAdminListQuery,
} from "./admin-list-query";

/**
 * TASK-176.5 — the typed query-state contract used by every admin list.
 * A URL must round-trip exactly, and a crafted value must degrade to the
 * default instead of reaching the server.
 */

describe("admin list query state", () => {
  it("restores search, status, period, page and structural filters", () => {
    const params = new URLSearchParams(
      "tab=cards&search=needle&status=archived&period=7d&limit=25&offset=50" +
        "&boardId=b-1&columnId=col-1&labelId=l-1&cardId=c-1" +
        "&commandId=cmd-1&returnTo=%2Fadmin",
    );
    const state = readAdminListQuery(params, {
      statuses: ["active", "archived", "deleted"],
      periods: true,
      defaultLimit: 50,
    });
    expect(state).toEqual({
      search: "needle",
      status: "archived",
      period: "7d",
      limit: 25,
      offset: 50,
      filters: {
        boardId: "b-1",
        columnId: "col-1",
        labelId: "l-1",
        cardId: "c-1",
        commandId: "cmd-1",
      },
    });
  });

  it("rejects crafted values and keeps defaults", () => {
    const state = readAdminListQuery(
      new URLSearchParams(
        "search=x&status=owner&period=forever&limit=999&offset=-5" +
          "&boardId=bad%24id&columnId=&labelId=..%2Fetc&cardId=" +
          "a".repeat(80) +
          "&commandId=bad%24id",
      ),
      { statuses: ["active"], periods: true, defaultLimit: 50 },
    );
    expect(state.status).toBe("all");
    expect(state.period).toBe("any");
    expect(state.limit).toBe(50);
    expect(state.offset).toBe(0);
    expect(state.filters).toEqual(EMPTY_ADMIN_LIST_FILTERS);
  });

  it("clamps an oversized offset to the first page", () => {
    const state = readAdminListQuery(new URLSearchParams("offset=1000001"));
    expect(state.offset).toBe(0);
  });

  it("ignores status and period when the list has no such tabs", () => {
    const state = readAdminListQuery(
      new URLSearchParams("status=deleted&period=24h"),
    );
    expect(state.status).toBe("all");
    expect(state.period).toBe("any");
  });

  it("serializes only non-default keys and preserves the hub and return path", () => {
    const next = writeAdminListQuery(
      new URLSearchParams("tab=comments&returnTo=%2Fadmin%2Fboards%2Fb-1"),
      {
        search: "hello",
        status: "active",
        period: "any",
        limit: 100,
        offset: 25,
        filters: { ...EMPTY_ADMIN_LIST_FILTERS, boardId: "b-1" },
      },
      { defaultLimit: 50 },
    );
    expect(next.get("tab")).toBe("comments");
    expect(next.get("returnTo")).toBe("/admin/boards/b-1");
    expect(next.get("search")).toBe("hello");
    expect(next.get("status")).toBe("active");
    expect(next.get("period")).toBeNull();
    expect(next.get("limit")).toBe("100");
    expect(next.get("offset")).toBe("25");
    expect(next.get("boardId")).toBe("b-1");
    expect(next.get("columnId")).toBeNull();
  });

  it("removes stale keys when a filter is cleared", () => {
    const next = writeAdminListQuery(
      new URLSearchParams(
        "tab=cards&search=x&status=deleted&limit=25&offset=25&boardId=b-1",
      ),
      {
        search: "",
        status: "all",
        period: "any",
        limit: 50,
        offset: 0,
        filters: EMPTY_ADMIN_LIST_FILTERS,
      },
    );
    expect(next.toString()).toBe("tab=cards");
  });

  it("keys distinguish every field that changes the request", () => {
    const base = {
      search: "",
      status: "all",
      period: "any",
      limit: 50,
      offset: 0,
      filters: EMPTY_ADMIN_LIST_FILTERS,
    };
    expect(adminFiltersKey(base.filters)).toBe("||||");
    expect(hasAdminFilters(base.filters)).toBe(false);
    expect(adminListQueryKey(base)).toBe(
      adminListQueryKey({ ...base, filters: { ...base.filters } }),
    );
    expect(adminListQueryKey(base)).not.toBe(
      adminListQueryKey({ ...base, offset: 25 }),
    );
    expect(hasAdminFilters({ ...base.filters, labelId: "l-1" })).toBe(true);
    expect(hasAdminFilters({ ...base.filters, commandId: "cmd-1" })).toBe(true);
  });

  it("writes and clears the commandId audit deep-link filter", () => {
    const next = writeAdminListQuery(new URLSearchParams("tab=audit"), {
      search: "",
      status: "all",
      period: "any",
      limit: 50,
      offset: 0,
      filters: { ...EMPTY_ADMIN_LIST_FILTERS, commandId: "cmd-1" },
    });
    expect(next.get("tab")).toBe("audit");
    expect(next.get("commandId")).toBe("cmd-1");

    const cleared = writeAdminListQuery(next, {
      search: "",
      status: "all",
      period: "any",
      limit: 50,
      offset: 0,
      filters: EMPTY_ADMIN_LIST_FILTERS,
    });
    expect(cleared.get("commandId")).toBeNull();
    expect(cleared.get("tab")).toBe("audit");
  });
});

describe("surface-aware admin queries", () => {
  it("round-trips only the card facets with canonical order and defaults", () => {
    const options = { surface: "cards" } as const;
    const source = new URLSearchParams(
      "tab=cards&returnTo=%2Fadmin&labelId=l-2&labelId=l-1&labelId=l-2" +
        "&labelMatch=all&verified=true&priority=high&priority=medium" +
        "&priority=invalid&unassigned=false&hasAttachments=false&boardId=+b-1+",
    );
    const state = readAdminListQuery(source, options);
    expect(state.filters).toEqual({
      ...EMPTY_ADMIN_LIST_FILTERS,
      boardId: "b-1",
      labelId: ["l-1", "l-2"],
      labelMatch: "all",
      priority: ["high", "medium"],
      hasAttachments: false,
    });
    const canonical = writeAdminListQuery(source, state, options);
    expect(canonical.toString()).toBe(
      "tab=cards&returnTo=%2Fadmin&boardId=b-1&hasAttachments=false&labelId=l-1" +
        "&labelId=l-2&labelMatch=all&priority=high&priority=medium",
    );
    expect(readAdminListQuery(canonical, options)).toEqual(state);
    expect(
      adminFiltersKey({ ...state.filters, labelId: ["l-2", "l-1", "l-2"] }),
    ).toBe(adminFiltersKey(state.filters));
    expect(
      adminFiltersKey({ ...state.filters, hasAttachments: true }),
    ).not.toBe(adminFiltersKey(state.filters));
    expect(adminFiltersKey({ ...state.filters, labelMatch: "any" })).not.toBe(
      adminFiltersKey(state.filters),
    );
  });

  it("drops unsupported user facets but keeps supported legacy comment scopes", () => {
    const params = new URLSearchParams(
      "boardId=b-1&columnId=c-1&labelId=l-1&assigneeId=u-1&verified=false",
    );
    const users = readAdminListQuery(params, { surface: "users" });
    expect(users.filters).toEqual({
      ...EMPTY_ADMIN_LIST_FILTERS,
      verified: false,
    });
    expect(
      writeAdminListQuery(params, users, { surface: "users" }).toString(),
    ).toBe("verified=false");
    const comments = readAdminListQuery(params, { surface: "comments" });
    expect(comments.filters).toEqual({
      ...EMPTY_ADMIN_LIST_FILTERS,
      boardId: "b-1",
      columnId: "c-1",
      labelId: "l-1",
    });
  });

  it("reports oversized and repeated single-value filters before a request", () => {
    const cards = { surface: "cards" } as const;
    const oversized = new URLSearchParams(
      Array.from({ length: 21 }, () => ["labelId", "l-1"]),
    );
    const state = readAdminListQuery(oversized, cards);
    expect(state.filterError).toContain("20");
    expect(() => writeAdminListQuery(oversized, state, cards)).toThrow("20");
    const repeated = new URLSearchParams("labelId=l-1&labelId=l-1");
    expect(
      readAdminListQuery(repeated, { surface: "comments" }).filterError,
    ).toContain("one value");
    expect(readAdminListQuery(repeated, cards).filters.labelId).toEqual([
      "l-1",
    ]);
    const combined = new URLSearchParams([
      ...Array.from({ length: 17 }, (_, i) => ["labelId", `l-${i}`]),
      ...Array.from({ length: 16 }, (_, i) => ["assigneeId", `u-${i}`]),
    ]);
    expect(readAdminListQuery(combined, cards).filterError).toContain("32");
    const long = new URLSearchParams([
      ...Array.from({ length: 16 }, (_, i) => [
        "labelId",
        `${"l".repeat(62)}${i}`,
      ]),
      ...Array.from({ length: 16 }, (_, i) => [
        "assigneeId",
        `${"u".repeat(62)}${i}`,
      ]),
    ]);
    expect(readAdminListQuery(long, cards).filterError).toContain("too long");
  });

  it("normalizes announcement status while reading and writing", () => {
    const options = { surface: "announcements" } as const;
    const alias = new URLSearchParams("tab=history&status=deleted");
    const state = readAdminListQuery(alias, options);
    expect(state.status).toBe("disabled");
    expect(
      writeAdminListQuery(
        alias,
        { ...state, status: "deleted" },
        options,
      ).toString(),
    ).toBe("tab=history&status=disabled");
  });
});
