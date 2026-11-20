import { describe, expect, it } from "vitest";
import {
  EMPTY_ADMIN_LIST_FILTERS,
  adminFiltersKey,
  adminListQueryKey,
  adminListRequestFilters,
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
      "tab=comments&search=needle&status=deleted&period=7d&limit=25&offset=50" +
        "&boardId=b-1&columnId=col-1&labelId=l-1&cardId=c-1" +
        "&returnTo=%2Fadmin",
    );
    const state = readAdminListQuery(params, {
      surface: "comments",
      statuses: ["active", "deleted"],
      periods: true,
      defaultLimit: 50,
    });
    expect(state).toEqual({
      search: "needle",
      status: "deleted",
      period: "7d",
      limit: 25,
      offset: 50,
      filters: {
        boardId: "b-1",
        columnId: "col-1",
        labelId: "l-1",
        cardId: "c-1",
        commandId: null,
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
      {
        surface: "comments",
        statuses: ["active"],
        periods: true,
        defaultLimit: 50,
      },
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
      { surface: "comments", defaultLimit: 50 },
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
      { surface: "cards" },
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
    const next = writeAdminListQuery(
      new URLSearchParams("tab=audit"),
      {
        search: "",
        status: "all",
        period: "any",
        limit: 50,
        offset: 0,
        filters: { ...EMPTY_ADMIN_LIST_FILTERS, commandId: "cmd-1" },
      },
      { surface: "audit" },
    );
    expect(next.get("tab")).toBe("audit");
    expect(next.get("commandId")).toBe("cmd-1");
    expect(
      readAdminListQuery(next, { surface: "audit" }).filters.commandId,
    ).toBe("cmd-1");

    expect(
      readAdminListQuery(new URLSearchParams("commandId=bad%24id"), {
        surface: "audit",
      }).filters.commandId,
    ).toBeNull();
    const cleared = writeAdminListQuery(
      next,
      {
        search: "",
        status: "all",
        period: "any",
        limit: 50,
        offset: 0,
        filters: EMPTY_ADMIN_LIST_FILTERS,
      },
      { surface: "audit" },
    );
    expect(cleared.get("commandId")).toBeNull();
    expect(cleared.get("tab")).toBe("audit");
  });
});

describe("surface-aware admin queries", () => {
  it("round-trips cards filters and drops defaults and deferred facets", () => {
    const options = { surface: "cards" } as const;
    const source = new URLSearchParams(
      "tab=cards&returnTo=%2Fadmin&status=archived&labelId=l-1&labelMatch=all&verified=true" +
        "&priority=high&unassigned=false&hasAttachments=false&boardId=+b-1+",
    );
    const state = readAdminListQuery(source, options);
    expect(state.status).toBe("archived");
    expect(state.filters).toEqual({
      ...EMPTY_ADMIN_LIST_FILTERS,
      boardId: "b-1",
      labelId: "l-1",
      priority: ["high"],
      hasAttachments: false,
    });
    const canonical = writeAdminListQuery(source, state, options);
    expect(canonical.toString()).toBe(
      "tab=cards&returnTo=%2Fadmin&status=archived&boardId=b-1&hasAttachments=false&labelId=l-1&priority=high",
    );
    expect(readAdminListQuery(canonical, options)).toEqual(state);
  });

  it.each(["commands", "cards"] as const)(
    "preserves explicit bounds when rewriting the %s URL",
    (surface) => {
      const source = new URLSearchParams("from=0&to=123&search=initial");
      const state = readAdminListQuery(source, { surface });
      const changed = { ...state, search: "edited" };
      const canonical = writeAdminListQuery(source, changed, { surface });
      expect(canonical.get("from")).toBe("0");
      expect(canonical.get("to")).toBe("123");
      expect(readAdminListQuery(canonical, { surface })).toEqual(changed);
    },
  );

  it("deduplicates card labels and assignees and rejects repeated legacy singletons", () => {
    const params = new URLSearchParams("labelId=l-1&labelId=l-1");
    for (let i = 0; i < 21; i++) params.append("assigneeId", "u-1");
    const cards = readAdminListQuery(params, { surface: "cards" });
    expect(cards.filters).toEqual({
      ...EMPTY_ADMIN_LIST_FILTERS,
      labelId: "l-1",
      assigneeId: ["u-1"],
    });
    expect(cards.filterError).toBeUndefined();
    expect(
      readAdminListQuery(params, { surface: "comments" }).filterError,
    ).toContain("one value");
  });

  it("deduplicates repeated values in filter keys before counting unique values", () => {
    const assigneeId = Array.from({ length: 20 }, (_, i) => `user-${i}`);
    expect(
      adminFiltersKey({
        ...EMPTY_ADMIN_LIST_FILTERS,
        assigneeId: [...assigneeId, ...assigneeId],
      }),
    ).toBe(adminFiltersKey({ ...EMPTY_ADMIN_LIST_FILTERS, assigneeId }));
  });

  it("requires a list surface to parse or send structural filters", () => {
    const filters = {
      ...EMPTY_ADMIN_LIST_FILTERS,
      boardId: "b-1",
      assigneeId: ["u-1"],
    };
    expect(
      readAdminListQuery(new URLSearchParams("boardId=b-1")).filters,
    ).toEqual(EMPTY_ADMIN_LIST_FILTERS);
    expect(adminListRequestFilters(filters)).toEqual({});
    expect(adminListRequestFilters(filters, "cards")).toEqual({
      boardId: "b-1",
      assigneeId: ["u-1"],
    });
    expect(adminListRequestFilters(filters, "users")).toEqual({});
  });

  it("round-trips cards multi-values, mode and period in canonical order", () => {
    const options = { surface: "cards" } as const;
    const params = new URLSearchParams(
      "tab=cards&period=7d&labelId=l-2&labelId=l-1&labelMatch=all&assigneeId=u-2&assigneeId=u-1&unassigned=true&due=soon",
    );
    const state = readAdminListQuery(params, options);
    expect(state.period).toBe("7d");
    expect(adminListRequestFilters(state.filters, "cards")).toEqual({
      assigneeId: ["u-1", "u-2"],
      due: "soon",
      labelId: ["l-1", "l-2"],
      labelMatch: "all",
      unassigned: true,
    });
    const canonical = writeAdminListQuery(params, state, options);
    expect(canonical.toString()).toBe(
      "tab=cards&period=7d&assigneeId=u-1&assigneeId=u-2&due=soon&labelId=l-1&labelId=l-2&labelMatch=all&unassigned=true",
    );
    expect(readAdminListQuery(canonical, options)).toEqual(state);
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
