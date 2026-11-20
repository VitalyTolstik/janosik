import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminFilterOptionsDto,
  AdminFilterOptionsQuery,
} from "@janosik/shared";
import { adminApi } from "../admin-client";
import { useFilterOptions } from "./use-filter-options";

const empty: AdminFilterOptionsDto = { items: [], missing: [], hasMore: false };
let session = 0;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(adminApi, "getAccessToken").mockReturnValue(
    `lookup-session-${++session}`,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("filter options cache", () => {
  it("debounces typing and aborts a superseded search even if it eventually answers", async () => {
    let finishOld: (data: AdminFilterOptionsDto) => void = () => undefined;
    const lookup = vi
      .spyOn(adminApi, "filterOptions")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue(empty);
    const { result, rerender, unmount } = renderHook(
      ({ q }) => useFilterOptions({ type: "label", boardId: "a", q }),
      {
        initialProps: { q: "u" },
      },
    );
    await advance(200);
    rerender({ q: "ur" });
    await advance(249);
    expect(lookup).not.toHaveBeenCalled();
    await advance(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    const oldSignal = lookup.mock.lastCall?.[1];
    expect(oldSignal?.aborted).toBe(false);

    rerender({ q: "urgent" });
    expect(oldSignal?.aborted).toBe(true);
    await advance(250);
    expect(lookup).toHaveBeenLastCalledWith(
      { type: "label", boardId: "a", q: "urgent" },
      expect.any(AbortSignal),
    );
    expect(result.current.data).toBe(empty);
    act(() => finishOld({ ...empty, hasMore: true }));
    await advance(0);
    expect(result.current.data).toBe(empty);

    rerender({ q: "ur" });
    expect(result.current.loading).toBe(true);
    await advance(250);
    expect(lookup).toHaveBeenCalledTimes(3);
    const currentSignal = lookup.mock.lastCall?.[1];
    unmount();
    expect(currentSignal?.aborted).toBe(true);
  });

  it("caches canonical exact-ID sets separately from picker search and expires them", async () => {
    const lookup = vi.spyOn(adminApi, "filterOptions").mockResolvedValue(empty);
    const initialProps: AdminFilterOptionsQuery = {
      type: "column",
      ids: ["b", "a", "b"],
      boardId: "old-board",
    };
    const renderOptions = (params: AdminFilterOptionsQuery) =>
      renderHook(useFilterOptions, { initialProps: params });

    const first = renderOptions(initialProps);
    await advance(0);
    expect(lookup).toHaveBeenCalledWith(
      { type: "column", ids: ["a", "b"] },
      expect.any(AbortSignal),
    );
    first.unmount();

    const cached = renderOptions({ type: "column", ids: ["a", "b"] });
    await advance(0);
    expect(cached.result.current.data).toBe(empty);
    expect(lookup).toHaveBeenCalledTimes(1);
    cached.unmount();

    const search = renderOptions({ type: "column", q: "a", boardId: "b" });
    await advance(250);
    expect(lookup).toHaveBeenCalledTimes(2);
    search.unmount();

    await advance(45_000);
    const expired = renderOptions({ type: "column", ids: ["a", "b"] });
    await advance(0);
    expect(expired.result.current.data).toBe(empty);
    expect(lookup).toHaveBeenCalledTimes(3);
  });
});
