import { act, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import {
  OVERVIEW_BOARDS,
  overviewItem,
  overviewResponse,
} from "@/test/agents-overview";

const hoisted = vi.hoisted(() => ({
  agentsOverview: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  isApiEnabled: () => true,
  api: { agentsOverview: hoisted.agentsOverview },
}));

import { usePendingApprovals } from "@/components/agents/use-pending-approvals";

const BOARDS = OVERVIEW_BOARDS;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePendingApprovals", () => {
  it("shares one overview request between the header and page consumers", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boardId: "board-1",
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );

    function Probe(): ReactElement {
      const state = usePendingApprovals({
        boardId: "board-1",
        boards: BOARDS,
      });
      return <span data-testid="probe">{state.pendingCount ?? "unknown"}</span>;
    }

    const view = render(
      <>
        <Probe />
        <Probe />
      </>,
    );
    await waitFor(() =>
      expect(hoisted.agentsOverview).toHaveBeenCalledTimes(1),
    );
    expect(view.getAllByTestId("probe")[0]).toHaveTextContent("1");
    expect(view.getAllByTestId("probe")[1]).toHaveTextContent("1");
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "does not request approvals for a %s scope",
    async (role) => {
      const { result } = renderHook(() =>
        usePendingApprovals({
          boardId: "board-2",
          boards: [{ ...BOARDS[1], role }],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(hoisted.agentsOverview).not.toHaveBeenCalled();
      expect(result.current.pendingCount).toBeNull();
      expect(result.current.totalCount).toBeNull();
      expect(result.current.rows).toHaveLength(0);
    },
  );

  it("does not request approvals when no board is ADMIN in All scope", async () => {
    const { result } = renderHook(() =>
      usePendingApprovals({
        boards: [
          { ...BOARDS[0], role: "MEMBER" },
          { ...BOARDS[1], role: "VIEWER" },
        ],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hoisted.agentsOverview).not.toHaveBeenCalled();
    expect(result.current.pendingCount).toBeNull();
    expect(result.current.totalCount).toBeNull();
  });

  it("reports an initial network failure as unknown, never as zero", async () => {
    hoisted.agentsOverview.mockRejectedValueOnce({ status: 0 });
    const { result } = renderHook(() =>
      usePendingApprovals({ boardId: "board-1", boards: BOARDS }),
    );

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.pendingCount).toBeNull();
    expect(result.current.totalCount).toBeNull();
    expect(result.current.counts).toEqual({});
    expect(result.current.loading).toBe(false);
  });

  it("keeps the last count and marks it stale after a failed refresh", async () => {
    hoisted.agentsOverview.mockResolvedValueOnce(
      overviewResponse([overviewItem()], {
        boardId: "board-1",
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    const { result } = renderHook(() =>
      usePendingApprovals({ boardId: "board-1", boards: BOARDS }),
    );
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    hoisted.agentsOverview.mockRejectedValueOnce({ status: 503 });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.pendingCount).toBe(1);
    expect(result.current.stale).toBe(true);
    expect(result.current.refreshedAt).not.toBeNull();
  });

  it.each([403, 404] as const)(
    "drops data on a confirmed %i without error or a Retry state",
    async (status) => {
      hoisted.agentsOverview.mockRejectedValueOnce({ status });
      const { result } = renderHook(() =>
        usePendingApprovals({ boardId: "board-1", boards: BOARDS }),
      );

      await waitFor(() => expect(result.current.forbidden).toBe(true));
      expect(result.current.error).toBe(false);
      expect(result.current.pendingCount).toBeNull();
      expect(result.current.rows).toHaveLength(0);

      act(() => result.current.reload());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(hoisted.agentsOverview).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps exact board counts and the All-boards total together", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 3 },
        pendingTotal: 3,
        totalApprovals: 3,
      }),
    );
    const { result } = renderHook(() =>
      usePendingApprovals({ boards: BOARDS }),
    );

    await waitFor(() => expect(result.current.pendingCount).toBe(3));
    expect(result.current.totalCount).toBe(3);
    expect(result.current.counts).toEqual({
      "board-1": 3,
      "board-2": null,
    });
    expect(result.current.truncated).toBe(false);
  });

  it("does not request overview while disabled", async () => {
    renderHook(() => usePendingApprovals({ boards: BOARDS, enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hoisted.agentsOverview).not.toHaveBeenCalled();
  });
});
