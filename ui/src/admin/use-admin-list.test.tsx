import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminPage } from "@janosik/shared";

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

function page(items: Row[], total = items.length): AdminPage<Row> {
  return { items, total, limit: 50, offset: 0 };
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
});
