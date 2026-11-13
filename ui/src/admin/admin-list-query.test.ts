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
        "&boardId=b-1&columnId=col-1&labelId=l-1&cardId=c-1&returnTo=%2Fadmin",
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
      },
    });
  });

  it("rejects crafted values and keeps defaults", () => {
    const state = readAdminListQuery(
      new URLSearchParams(
        "search=x&status=owner&period=forever&limit=999&offset=-5" +
          "&boardId=bad%24id&columnId=&labelId=..%2Fetc&cardId=" +
          "a".repeat(80),
      ),
      { statuses: ["active"], periods: true, defaultLimit: 50 },
    );
    expect(state.status).toBe("all");
    expect(state.period).toBe("any");
    expect(state.limit).toBe(50);
    expect(state.offset).toBe(0);
    expect(state.filters).toEqual(EMPTY_ADMIN_LIST_FILTERS);
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
    expect(adminFiltersKey(base.filters)).toBe("|||");
    expect(hasAdminFilters(base.filters)).toBe(false);
    expect(adminListQueryKey(base)).toBe(
      adminListQueryKey({ ...base, filters: { ...base.filters } }),
    );
    expect(adminListQueryKey(base)).not.toBe(
      adminListQueryKey({ ...base, offset: 25 }),
    );
    expect(hasAdminFilters({ ...base.filters, labelId: "l-1" })).toBe(true);
  });
});
