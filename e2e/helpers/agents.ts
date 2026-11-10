import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
} from "@playwright/test";

import { siteUrl } from "./urls.js";

/** A personal API token acting as an agent on one board (TASK-166.1). */
export interface AgentFixture {
  token: string;
  api: APIRequestContext;
  session: {
    id: string;
    name: string | null;
    status: string;
    lastHeartbeatAt: number;
  };
  /** A command issued with `X-Agent-Session`, so attribution carries all ids. */
  command: (action: Record<string, unknown>) => Promise<void>;
  heartbeat: (body: Record<string, unknown>) => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * Create a PAT, open one agent session with it and return the request context
 * so a test can drive heartbeat/commands/end exactly like the MCP client does.
 * `board.api` must be the board owner's browser-JWT context (token creation is
 * session-only).
 */
export async function createAgentSession(
  playwright: PlaywrightWorkerArgs["playwright"],
  board: {
    id: string;
    api: APIRequestContext;
  },
  testIp: string,
  options: {
    tokenName?: string;
    sessionName?: string;
    clientName?: string;
    model?: string;
    currentCardId?: string;
  } = {},
): Promise<AgentFixture> {
  const tokenName =
    options.tokenName ?? `E2E agent ${randomUUID().slice(0, 8)}`;
  const created = await board.api.post("/api/v1/users/me/tokens", {
    data: { name: tokenName, expiresAt: null },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { token } = (await created.json()) as { token: string };

  const api = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: {
      "X-Forwarded-For": testIp,
      Authorization: `Bearer ${token}`,
    },
  });
  try {
    const started = await api.post(
      `/api/v1/boards/${board.id}/agent-sessions`,
      {
        data: {
          name: options.sessionName ?? "E2E session",
          clientName: options.clientName ?? "playwright",
          model: options.model ?? "e2e-model",
        },
      },
    );
    expect(started.status(), await started.text()).toBe(201);
    const session = (await started.json()) as AgentFixture["session"];
    if (options.currentCardId !== undefined) {
      const beat = await api.post(
        `/api/v1/boards/${board.id}/agent-sessions/${session.id}/heartbeat`,
        { data: { currentCardId: options.currentCardId, status: "active" } },
      );
      expect(beat.ok()).toBe(true);
      Object.assign(session, (await beat.json()) as AgentFixture["session"]);
    }
    return {
      token,
      api,
      session,
      command: async (action) => {
        const response = await api.post(`/api/v1/boards/${board.id}/commands`, {
          headers: { "X-Agent-Session": session.id },
          data: {
            commandId: randomUUID(),
            action: { boardId: board.id, at: Date.now(), ...action },
          },
        });
        expect(response.status(), await response.text()).toBe(200);
      },
      heartbeat: async (body) => {
        const response = await api.post(
          `/api/v1/boards/${board.id}/agent-sessions/${session.id}/heartbeat`,
          { data: body },
        );
        expect(response.ok()).toBe(true);
      },
      dispose: () => api.dispose(),
    };
  } catch (error) {
    await api.dispose();
    throw error;
  }
}

/** `GET` one session as a human board member (for API-side assertions). */
export async function readAgentSession(
  api: APIRequestContext,
  boardId: string,
  sessionId: string,
) {
  const response = await api.get(
    `/api/v1/boards/${boardId}/agent-sessions/${sessionId}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    id: string;
    status: string;
    paused: boolean;
    pausedReason: string | null;
    endedAt: number | null;
    summary: string | null;
  };
}
