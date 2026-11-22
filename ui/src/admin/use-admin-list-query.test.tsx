import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AdminPage } from "@janosik/shared";
import type { AdminListParams } from "./admin-client";
import { useAdminListQuery } from "./use-admin-list-query";

interface Row {
  id: string;
}

function setup(
  url: string,
  preceding?: string,
  fetcher: (params: AdminListParams) => Promise<AdminPage<Row>> = vi
    .fn()
    .mockResolvedValue({ items: [], total: 120, limit: 50, offset: 0 }),
) {
  const hook = renderHook(
    () => ({
      list: useAdminListQuery(fetcher),
      location: useLocation(),
      navigate: useNavigate(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={preceding ? [preceding, url] : [url]}>
          {children}
        </MemoryRouter>
      ),
    },
  );
  return { ...hook, fetcher };
}

describe("URL-backed admin lists", () => {
  it.each([
    [
      "/admin/users?adminMemberId=u-1&assigneeId=u-1&returnTo=%2Fadmin",
      "?returnTo=%2Fadmin",
    ],
    [
      "/admin/boards?tab=cards&verified=true&authorId=u-1&adminMemberId=u-1",
      "?tab=cards",
    ],
    [
      "/admin/audit?tab=audit&actorId=a-1&boardId=b-1&type=reference",
      "?tab=audit",
    ],
    ["/admin/boards?verified=true", ""],
    ["/admin/moderation?tab=attachments&kind=blocker", "?tab=attachments"],
  ])(
    "loads %s without sending unsupported filter keys or entering an error state",
    async (url, canonical) => {
      const { result, fetcher } = setup(url);
      await waitFor(() =>
        expect(result.current.location.search).toBe(canonical),
      );
      await waitFor(() => expect(result.current.list.loading).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith({
        search: "",
        status: "all",
        from: undefined,
        limit: 50,
        offset: 0,
      });
      expect(result.current.list.error).toBe(false);
      expect(result.current.list.filterError).toBeUndefined();
    },
  );

  it("sends repeated audit facets and the target from the canonical deep link", async () => {
    const { result, fetcher } = setup(
      "/admin/audit?tab=audit&adminId=a-2&adminId=a-1&action=board.command&targetId=scope:b-1&offset=2",
    );
    await waitFor(() =>
      expect(result.current.location.search).toBe(
        "?tab=audit&offset=2&action=board.command&adminId=a-1&adminId=a-2&targetId=scope%3Ab-1",
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({
      search: "",
      status: "all",
      from: undefined,
      limit: 50,
      offset: 2,
      action: ["board.command"],
      adminId: ["a-1", "a-2"],
      targetId: "scope:b-1",
    });
  });

  it("sends the card facets from the canonical deep link", async () => {
    const { result, fetcher } = setup(
      "/admin/boards?tab=cards&assigneeId=u-1&labelMatch=all&labelId=l-2&labelId=l-1",
    );
    await waitFor(() =>
      expect(result.current.location.search).toBe(
        "?tab=cards&assigneeId=u-1&labelId=l-1&labelId=l-2&labelMatch=all",
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({
      search: "",
      status: "all",
      from: undefined,
      limit: 50,
      offset: 0,
      assigneeId: ["u-1"],
      labelId: ["l-1", "l-2"],
      labelMatch: "all",
    });
  });

  it("keeps a non-multiple offset inside the first page (QA-A4)", async () => {
    const fetcher = vi
      .fn<(params: AdminListParams) => Promise<AdminPage<Row>>>()
      .mockResolvedValue({
        items: [{ id: "u-1" }],
        total: 25,
        limit: 50,
        offset: 2,
      });
    const { result } = setup("/admin/users?offset=2", undefined, fetcher);
    await waitFor(() => expect(result.current.list.loading).toBe(false));

    // offset=2 is page 1 of 1, not an out-of-range offset, so it must survive.
    expect(result.current.list.offset).toBe(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 2, limit: 50 }),
    );
    expect(
      new URLSearchParams(result.current.location.search).get("offset"),
    ).toBe("2");
  });

  it("replaces an out-of-range offset instead of pushing a back-trap entry", async () => {
    const fetcher = vi
      .fn<(params: AdminListParams) => Promise<AdminPage<Row>>>()
      .mockResolvedValue({
        items: [],
        total: 25,
        limit: 25,
        offset: 25,
      });
    const { result } = setup(
      "/admin/users?offset=25&limit=25",
      "/admin/users?search=previous",
      fetcher,
    );

    await waitFor(() => expect(result.current.list.offset).toBe(0));
    await waitFor(() =>
      expect(
        new URLSearchParams(result.current.location.search).get("offset"),
      ).toBeNull(),
    );

    // If the clamp pushed an entry, Back would return to offset=25 and clamp
    // again. Replacing it lets Back reach the previous view.
    act(() => result.current.navigate(-1));
    await waitFor(() =>
      expect(result.current.location.search).toContain("search=previous"),
    );
  });

  it("clamps an offset at or past the total even inside the last page index", async () => {
    const fetcher = vi
      .fn<(params: AdminListParams) => Promise<AdminPage<Row>>>()
      .mockResolvedValue({
        items: [],
        total: 25,
        limit: 50,
        offset: 25,
      });
    const { result } = setup(
      "/admin/users?offset=25&limit=50",
      undefined,
      fetcher,
    );

    await waitFor(() => expect(result.current.list.offset).toBe(0));
    await waitFor(() =>
      expect(
        new URLSearchParams(result.current.location.search).get("offset"),
      ).toBeNull(),
    );
  });

  it("preserves explicit URL bounds while paging", async () => {
    const { result, fetcher } = setup(
      "/admin/audit?tab=commands&from=0&to=123",
    );
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    act(() => result.current.list.setOffset(50));
    await waitFor(() =>
      expect(
        new URLSearchParams(result.current.location.search).get("offset"),
      ).toBe("50"),
    );
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("from")).toBe("0");
    expect(params.get("to")).toBe("123");
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 50, from: undefined }),
    );
    expect(vi.mocked(fetcher).mock.lastCall?.[0]).not.toHaveProperty("to");
  });

  it("sends the announcement alias as disabled and replaces the URL", async () => {
    const { result, fetcher } = setup(
      "/admin/communications?tab=history&status=deleted",
    );
    await waitFor(() =>
      expect(result.current.location.search).toBe(
        "?tab=history&status=disabled",
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disabled" }),
    );
    expect(result.current.list.status).toBe("disabled");
  });

  it("keeps a legacy single-label filter through back and forward", async () => {
    const { result, fetcher } = setup("/admin/boards?tab=cards&labelId=l-1");
    await waitFor(() =>
      expect(result.current.location.search).toBe("?tab=cards&labelId=l-1"),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ labelId: "l-1" }),
    );
    act(() => result.current.list.setFilter("labelId", null));
    await waitFor(() =>
      expect(result.current.location.search).toBe("?tab=cards"),
    );
    act(() => result.current.navigate(-1));
    await waitFor(() =>
      expect(result.current.list.filters.labelId).toBe("l-1"),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ labelId: "l-1" }),
    );
    act(() => result.current.navigate(1));
    await waitFor(() => expect(result.current.list.filters.labelId).toBeNull());
    expect(vi.mocked(fetcher).mock.lastCall?.[0]).not.toHaveProperty("labelId");
  });

  it("keeps debounced search in the current history entry", async () => {
    const { result, fetcher } = setup(
      "/admin/users?search=initial",
      "/admin/users?search=previous",
    );
    act(() => result.current.list.setSearch("edited"));
    await waitFor(() =>
      expect(result.current.location.search).toBe("?search=edited"),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "edited" }),
    );
    act(() => result.current.navigate(-1));
    await waitFor(() =>
      expect(result.current.list.effectiveSearch).toBe("previous"),
    );
  });

  it("blocks a repeated legacy columnId until the filters are cleared", async () => {
    const { result, fetcher } = setup(
      "/admin/boards?tab=cards&columnId=c-1&columnId=c-1",
    );
    expect(result.current.list.error).toBe(true);
    expect(result.current.list.filterError).toContain("one value");
    expect(fetcher).not.toHaveBeenCalled();
    act(() => result.current.list.clearFilters());
    await waitFor(() =>
      expect(result.current.location.search).toBe("?tab=cards"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
