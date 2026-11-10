import { SetMetadata } from "@nestjs/common";
import type { ScopePreset } from "@janosik/shared";
import type { LifecycleAction } from "./token-scope";

/**
 * Minimum effective token preset for a board route (TASK-166). Read routes
 * default to `observer`; write routes default to `worker`, so only routes
 * that differ (board administration, agent-session control plane) need this.
 */
export const TOKEN_SCOPE_KEY = "tokenScope";
export const TokenScope = (scope: ScopePreset) =>
  SetMetadata(TOKEN_SCOPE_KEY, scope);

/**
 * Lifecycle action gated by the board agent policy (TASK-166). The
 * `MembershipGuard` reads it after the board role and token preset checks;
 * for example `@AgentAction("member.invite")`.
 */
export const AGENT_ACTION_KEY = "agentAction";
export const AgentAction = (action: LifecycleAction) =>
  SetMetadata(AGENT_ACTION_KEY, action);
