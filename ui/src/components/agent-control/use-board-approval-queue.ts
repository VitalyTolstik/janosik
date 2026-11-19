import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentsOverviewApprovalsResponse } from "@janosik/shared";
import { ApiError, isApiEnabled } from "@/api/client";
import { useBoardLive } from "@/store/board-live";
import {
  fetchApprovalPage,
  refreshApprovalPages,
} from "@/components/agents/approval-pages";

type QueueStatus = "pending" | "decided";

interface QueueSnapshot {
  boardId: string;
  pending?: AgentsOverviewApprovalsResponse;
  decided?: AgentsOverviewApprovalsResponse;
  pendingError: boolean;
  decidedError: boolean;
  loadingMore?: QueueStatus;
}

const POLL_MS = 30_000;

function accessLost(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 404)
  );
}

export function useBoardApprovalQueue(
  boardId: string | undefined,
  enabled: boolean,
) {
  const { agentControl } = useBoardLive();
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const latest = useRef<QueueSnapshot | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const active = enabled && boardId !== undefined && isApiEnabled();
  const publish = useCallback((next: QueueSnapshot) => {
    latest.current = next;
    setSnapshot(next);
  }, []);
  const reload = useCallback(async () => {
    if (!active || boardId === undefined) return;
    const request = ++generation.current;
    refreshing.current = true;
    const previous =
      latest.current?.boardId === boardId ? latest.current : null;
    const targetSize = (status: QueueStatus) =>
      (previous?.[status]?.items.length ?? 0) +
      (previous?.loadingMore === status ? 1 : 0);
    const [pending, decided] = await Promise.allSettled([
      refreshApprovalPages(
        { boardId, status: "pending" },
        targetSize("pending"),
      ),
      refreshApprovalPages(
        { boardId, status: "decided" },
        targetSize("decided"),
      ),
    ]);
    if (request !== generation.current) return;
    refreshing.current = false;
    // A role change invalidates both pages even when another request raced
    // with it and still returned a snapshot taken with the old membership.
    if (
      [pending, decided].some(
        (result) => result.status === "rejected" && accessLost(result.reason),
      )
    ) {
      publish({ boardId, pendingError: true, decidedError: true });
      return;
    }
    publish({
      boardId,
      pending:
        pending.status === "fulfilled" ? pending.value : previous?.pending,
      decided:
        decided.status === "fulfilled" ? decided.value : previous?.decided,
      pendingError: pending.status === "rejected",
      decidedError: decided.status === "rejected",
    });
  }, [active, boardId, publish]);

  useEffect(() => {
    if (!active) return;
    void reload();
    const poll = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, POLL_MS);
    let timer: number | undefined;
    const schedule = () => {
      timer ??= window.setTimeout(() => {
        timer = undefined;
        void reload();
      }, 100);
    };
    const unsubscribe = agentControl.subscribeApproval(schedule);
    const unsubscribeAgent = agentControl.subscribeAgent((event) => {
      if (event.op === "ended") schedule();
    });
    return () => {
      generation.current += 1;
      latest.current = null;
      refreshing.current = false;
      unsubscribe();
      unsubscribeAgent();
      window.clearInterval(poll);
      window.clearTimeout(timer);
    };
  }, [active, agentControl, reload]);

  const loadMore = async (status: QueueStatus) => {
    const current = latest.current;
    const page = current?.[status];
    if (
      !active ||
      boardId === undefined ||
      current?.boardId !== boardId ||
      refreshing.current ||
      current.loadingMore ||
      !page?.nextCursor
    )
      return;
    const request = ++generation.current;
    publish({ ...current, loadingMore: status });
    try {
      const next = await fetchApprovalPage({ boardId, status }, page);
      if (request !== generation.current) return;
      publish({
        ...current,
        [status]: next,
        [`${status}Error`]: false,
        loadingMore: undefined,
      });
    } catch (error) {
      if (request !== generation.current) return;
      publish(
        accessLost(error)
          ? { boardId, pendingError: true, decidedError: true }
          : { ...current, [`${status}Error`]: true, loadingMore: undefined },
      );
    }
  };

  const current = active && snapshot?.boardId === boardId ? snapshot : null;
  return { current, reload, loadMore };
}

export type BoardApprovalQueue = ReturnType<typeof useBoardApprovalQueue>;
