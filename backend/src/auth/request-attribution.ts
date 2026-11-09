import type { ActorType } from "@janosik/shared";
import type { AuthPrincipal } from "./auth-principal";

/**
 * TASK-166 attribution carried by one request. The server derives it from
 * the authenticated principal (and, for agent sessions, the resolved
 * `X-Agent-Session` context) — never from the request body.
 */
export interface RequestAttribution {
  actorType: ActorType;
  apiTokenId: string | null;
  agentSessionId: string | null;
  runId: string | null;
  /** `ApiToken.name` snapshot at write time. */
  agentName: string | null;
}

/** A browser session / internal caller with no token attribution. */
export const HUMAN_ATTRIBUTION: RequestAttribution = {
  actorType: "human",
  apiTokenId: null,
  agentSessionId: null,
  runId: null,
  agentName: null,
};

/** Build the attribution object for a controller from the request principal. */
export function requestAttribution(
  principal: AuthPrincipal | undefined,
  sessionId?: string | null,
): RequestAttribution {
  if (principal?.via !== "pat") {
    return HUMAN_ATTRIBUTION;
  }
  return {
    actorType: "agent",
    apiTokenId: principal.apiTokenId ?? null,
    agentSessionId: sessionId ?? principal.agentSessionId ?? null,
    runId: null,
    agentName: principal.apiTokenName ?? null,
  };
}

/**
 * Fold TASK-166 attribution into a wire frame, omitting absent fields so old
 * clients see exactly the frame they saw before.
 */
export function attributionFields(source: {
  apiTokenId?: string | null;
  agentSessionId?: string | null;
  runId?: string | null;
  agentName?: string | null;
}): {
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  agentName?: string;
} {
  return {
    ...(source.apiTokenId ? { apiTokenId: source.apiTokenId } : {}),
    ...(source.agentSessionId ? { agentSessionId: source.agentSessionId } : {}),
    ...(source.runId ? { runId: source.runId } : {}),
    ...(source.agentName ? { agentName: source.agentName } : {}),
  };
}
