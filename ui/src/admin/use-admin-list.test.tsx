import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminPage } from "@janosik/shared";

import { EMPTY_ADMIN_LIST_FILTERS } from "./admin-list-query";
import { useAdminList } from "./use-admin-list";

/**
 * Admin list state (SKELETON-AUDIT §4.11): a refresh keeps the last
 * successful page on screen — `loading` is true only for the very first
 * answer, while `refreshing` describes the in-flight newer request.
 */

interface Row {
  id: string;
}

function pendingPage() {
  let resolve!: (page: AdminPage<Row>) => void;
  const promise = new Promise<AdminPage<Row>>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function page(
  items: Row[],
  total = items.length,
  offset = 0,
  limit = 50,
): AdminPage<Row> {
  return { items, total, limit, offset };
}

describe("useAdminList", () => {
  it("keeps previous rows while a newer filter request is in flight", async () => {
    const first = pendingPage();
    const second = pendingPage();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useAdminList<Row>(fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.refreshing).toBe(false);

    act(() => first.resolve(page([{ id: "a" }])));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([{ id: "a" }]);

    act(() => result.current.setStatus("open"));
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    // The table header/rows stay mounted through the refresh.
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([{ id: "a" }]);
    expect(result.current.total).toBe(1);

    act(() => second.resolve(page([{ id: "b" }], 2)));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.items).toEqual([{ id: "b" }]);
    expect(result.current.total).toBe(2);
  });

  it("keeps a page chosen right after mount when the initial search debounce settles", async () => {
    // A real server only returns offset 25 when the result set is larger than
    // one page; a smaller total is now clamped by QA-A4.
    const fetcher = vi.fn().mockResolvedValue(page([{ id: "a" }], 100));
    const { result } = renderHook(() => useAdminList<Row>(fetcher));

    act(() => result.current.setOffset(25));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(result.current.offset).toBe(25);
  });

  it("drops initial, applied and programmatic filters without a surface", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([]));
    const initialState = {
      search: "",
      status: "all",
      period: "any",
      limit: 50,
      offset: 0,
      filters: { ...EMPTY_ADMIN_LIST_FILTERS, boardId: "b-1", verified: true },
    };
    const { result } = renderHook(() =>
      useAdminList<Row>(fetcher, { initialState }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.applyState(initialState);
      result.current.setFilter("boardId", "b-2");
      result.current.setFilter("verified", true);
    });
    expect(result.current.filters).toEqual(EMPTY_ADMIN_LIST_FILTERS);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith({
      search: "",
      status: "all",
      from: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("clamps to the last real page when the total shrinks (QA-A4)", async () => {
    const fetcher = vi.fn(async ({ offset }: { offset?: number }) =>
      offset === 25
        ? { items: [], total: 25, limit: 25, offset: 25 }
        : { items: [{ id: "a" }], total: 25, limit: 25, offset: 0 },
    );
    const { result } = renderHook(() =>
      useAdminList<Row>(fetcher, {
        initialState: {
          search: "",
          status: "all",
          period: "any",
          limit: 25,
          offset: 25,
          filters: EMPTY_ADMIN_LIST_FILTERS,
        },
      }),
    );

    await waitFor(() => expect(result.current.offset).toBe(0));
    await waitFor(() => expect(result.current.items).toEqual([{ id: "a" }]));
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, limit: 25 }),
    );
  });

  it("reports errors only after the refresh settles", async () => {
    const first = pendingPage();
    let rejectSecond!: (error: Error) => void;
    const second = new Promise<AdminPage<Row>>((_, reject) => {
      rejectSecond = reject;
    });
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second);

    const { result } = renderHook(() => useAdminList<Row>(fetcher));
    act(() => first.resolve(page([{ id: "a" }])));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.error).toBe(false);

    act(() => rejectSecond(new Error("offline")));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it("echoes the response page and clamps an out-of-range empty page when opted in", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: "a" }], 100, 0, 50))
      .mockResolvedValueOnce(page([], 100, 150, 50))
      .mockResolvedValueOnce(page([{ id: "z" }], 100, 50, 50));

    const { result } = renderHook(() =>
      useAdminList<Row>(fetcher, { clampOutOfRange: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pageOffset).toBe(0);
    expect(result.current.pageLimit).toBe(50);

    act(() => result.current.setOffset(150));
    await waitFor(() => expect(result.current.offset).toBe(50));
    await waitFor(() => expect(result.current.items).toEqual([{ id: "z" }]));
    expect(result.current.pageOffset).toBe(50);
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 50, limit: 50 }),
    );
  });

  it("leaves an out-of-range page alone unless clamping is opted in", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page([], 100, 0, 50))
      .mockResolvedValueOnce(page([], 100, 150, 50));
    const { result } = renderHook(() => useAdminList<Row>(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setOffset(150));
    await waitFor(() => expect(result.current.pageOffset).toBe(150));
    expect(result.current.offset).toBe(150);
    expect(result.current.items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
