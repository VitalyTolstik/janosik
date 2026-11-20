import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAdminListQuery } from "./use-admin-list-query";

function setup(url: string, preceding?: string) {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
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
  it("drops unsupported filters before requesting users", async () => {
    const { result, fetcher } = setup(
      "/admin/users?assigneeId=u-1&returnTo=%2Fadmin",
    );
    await waitFor(() =>
      expect(result.current.location.search).toBe("?returnTo=%2Fadmin"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).not.toHaveProperty("assigneeId");
    expect(result.current.list.filters).not.toHaveProperty("assigneeId");
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

  it("keeps repeated filters and restores them through back and forward", async () => {
    const { result, fetcher } = setup(
      "/admin/boards?tab=cards&labelId=l-2&labelId=l-1&labelId=l-2",
    );
    await waitFor(() =>
      expect(result.current.location.search).toBe(
        "?tab=cards&labelId=l-1&labelId=l-2",
      ),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ labelId: ["l-1", "l-2"] }),
    );
    act(() => result.current.list.setFilter("labelId", null));
    await waitFor(() =>
      expect(result.current.location.search).toBe("?tab=cards"),
    );
    act(() => result.current.navigate(-1));
    await waitFor(() =>
      expect(result.current.list.filters.labelId).toEqual(["l-1", "l-2"]),
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ labelId: ["l-1", "l-2"] }),
    );
    act(() => result.current.navigate(1));
    await waitFor(() => expect(result.current.list.filters.labelId).toBeNull());
    expect(fetcher.mock.lastCall?.[0]).not.toHaveProperty("labelId");
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

  it("blocks requests for an oversized URL and allows clearing it", async () => {
    const query = new URLSearchParams(
      Array.from({ length: 21 }, () => ["labelId", "l-1"]),
    );
    const { result, fetcher } = setup(`/admin/boards?tab=cards&${query}`);
    expect(result.current.list.error).toBe(true);
    expect(result.current.list.filterError).toContain("20");
    expect(fetcher).not.toHaveBeenCalled();
    act(() => result.current.list.clearFilters());
    await waitFor(() =>
      expect(result.current.location.search).toBe("?tab=cards"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
