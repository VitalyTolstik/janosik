import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunSummaryDto } from "@janosik/shared";

const hoisted = vi.hoisted(() => ({
  previewRunRevert: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  isApiEnabled: () => true,
  api: { previewRunRevert: hoisted.previewRunRevert },
}));

import { useRunConflictPreviews } from "./use-run-conflict-previews";

const ROWS: Array<Pick<RunSummaryDto, "id" | "boardId" | "status" | "kind">> = [
  { id: "run-1", boardId: "board-1", status: "applied", kind: "batch" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRunConflictPreviews", () => {
  it("clears the count on refresh failure and ignores a stale in-flight success", async () => {
    let finish!: (value: { conflicts: unknown[] }) => void;
    hoisted.previewRunRevert
      .mockResolvedValueOnce({ conflicts: [{}] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(
      ({ revision }) => useRunConflictPreviews(ROWS, true, revision),
      { initialProps: { revision: 0 } },
    );
    await waitFor(() => expect(result.current.get("run-1")).toBe(1));
    rerender({ revision: 1 });
    rerender({ revision: 2 });
    await waitFor(() => expect(result.current.has("run-1")).toBe(false));
    await act(async () => finish({ conflicts: [{}, {}] }));
    expect(result.current.has("run-1")).toBe(false);
  });

  it("keeps the previous count while a revision refresh is pending", async () => {
    let finish!: (value: { conflicts: unknown[] }) => void;
    const rows = [...ROWS, { ...ROWS[0], id: "run-2" }];
    hoisted.previewRunRevert
      .mockResolvedValueOnce({ conflicts: [{}] })
      .mockResolvedValueOnce({ conflicts: [] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce({ conflicts: [{}] });
    const { result, rerender } = renderHook(
      ({ revision }) => useRunConflictPreviews(rows, true, revision),
      { initialProps: { revision: 0 } },
    );
    await waitFor(() => expect(result.current.get("run-1")).toBe(1));

    rerender({ revision: 1 });
    expect(result.current.get("run-1")).toBe(1);
    await waitFor(() => expect(result.current.get("run-2")).toBe(1));
    expect(result.current.get("run-1")).toBe(1);

    await act(async () => finish({ conflicts: [] }));
    expect(result.current.get("run-1")).toBe(0);
  });

  it("invalidates a cached preview when the revision changes", async () => {
    hoisted.previewRunRevert
      .mockResolvedValueOnce({ conflicts: [{}] } as never)
      .mockResolvedValueOnce({ conflicts: [] } as never);

    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) =>
        useRunConflictPreviews(ROWS, true, revision),
      { initialProps: { revision: 0 } },
    );

    await waitFor(() =>
      expect(hoisted.previewRunRevert).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(result.current.get("run-1")).toBe(1));

    // The cache is per revision: a re-render alone does not burn a request.
    rerender({ revision: 0 });
    expect(hoisted.previewRunRevert).toHaveBeenCalledTimes(1);

    rerender({ revision: 1 });
    await waitFor(() =>
      expect(hoisted.previewRunRevert).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.get("run-1")).toBe(0));
  });

  it("does not retry a failed preview until the revision changes", async () => {
    hoisted.previewRunRevert
      .mockRejectedValueOnce({ status: 0 })
      .mockResolvedValueOnce({ conflicts: [] } as never);

    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) =>
        useRunConflictPreviews(ROWS, true, revision),
      { initialProps: { revision: 0 } },
    );

    await waitFor(() =>
      expect(hoisted.previewRunRevert).toHaveBeenCalledTimes(1),
    );
    expect(result.current.has("run-1")).toBe(false);

    rerender({ revision: 1 });
    await waitFor(() =>
      expect(hoisted.previewRunRevert).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.get("run-1")).toBe(0));
  });
});
