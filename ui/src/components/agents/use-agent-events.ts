import { useEffect, useRef } from "react";
import type { AgentSseEvent, BoardSseEvent } from "@janosik/shared";

import { api, apiBaseUrl, isApiEnabled } from "@/api/client";

/**
 * A live-only, control-plane subscription to the agent lifecycle frames of
 * several boards (TASK-166.13).
 *
 * The board shell already keeps one SSE stream open for the active board, but
 * the agents console spans every board the caller belongs to. Reconnecting
 * through the full `BoardRealtime` bridge per board would duplicate presence
 * and command replay; this lightweight reader asks for no presence and resumes
 * from the highest safe seq, so the server sends no command backlog and only
 * the `agent` frames reach the caller. Those frames have no seq, so a
 * reconnect loses nothing but the events while the tab was offline — the
 * console also polls, and the next action refreshes the row.
 */
const LIVE_ONLY_SINCE = Number.MAX_SAFE_INTEGER;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type AgentEventHandler = (boardId: string, event: AgentSseEvent) => void;

export function useAgentSessionEvents(
  boardIds: readonly string[],
  onEvent: AgentEventHandler,
  enabled = true,
): void {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  // A stable key keeps the effect from reconnecting on every render while a
  // caller passes a freshly filtered array.
  const boardKey = [...new Set(boardIds)].sort().join("|");

  useEffect(() => {
    if (!enabled || !isApiEnabled() || boardKey === "") return;
    const watched = boardKey.split("|");
    const controllers = watched.map(() => new AbortController());
    let stopped = false;

    void import("@/store/realtime").then(({ parseEventStream }) => {
      if (stopped) return;
      for (const [index, boardId] of watched.entries()) {
        void followAgents(
          boardId,
          controllers[index].signal,
          parseEventStream,
          handlerRef,
        );
      }
    });

    return () => {
      stopped = true;
      for (const controller of controllers) controller.abort();
    };
  }, [boardKey, enabled]);
}

async function followAgents(
  boardId: string,
  signal: AbortSignal,
  parseEventStream: (
    stream: ReadableStream<Uint8Array>,
  ) => AsyncGenerator<BoardSseEvent>,
  handlerRef: { current: AgentEventHandler },
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const token = api.getAccessToken();
      const response = await fetch(
        `${apiBaseUrl()}/boards/${encodeURIComponent(boardId)}/events?presence=0&since=${LIVE_ONLY_SINCE}`,
        {
          headers: {
            Accept: "text/event-stream",
            ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
          },
          credentials: "include",
          signal,
        },
      );
      if (response.status === 401) {
        const restored = await api.refreshSession();
        if (restored === null && api.getAccessToken() === null) return;
        continue;
      }
      // Membership lost or board gone: the main board stream owns that
      // reaction; this auxiliary reader simply stops retrying.
      if (response.status === 403 || response.status === 404) return;
      if (!response.ok || response.body === null) {
        throw new Error(`agent events answered ${response.status}`);
      }
      attempt = 0;
      for await (const event of parseEventStream(response.body)) {
        if (signal.aborted) return;
        if (event.type === "agent") handlerRef.current(boardId, event);
      }
    } catch {
      if (signal.aborted) return;
    }
    attempt += 1;
    await delay(
      Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (attempt - 1)),
      signal,
    );
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
