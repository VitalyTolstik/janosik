import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  AGENT_SESSION_STATUSES,
  type AgentSessionStatus,
} from "@janosik/shared";

const TERMINAL: AgentSessionStatus[] = ["completed", "failed", "cancelled"];
const NON_TERMINAL: AgentSessionStatus[] = [
  "active",
  "idle",
  "waiting_approval",
];

/** Free-text summary bound (the DB column is `TEXT`; this is a sanity cap). */
export const AGENT_SESSION_SUMMARY_MAX = 2000;

/** Body of `POST /boards/:id/agent-sessions` (TASK-166). */
export class CreateAgentSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}

/** Body of `POST /boards/:id/agent-sessions/:sessionId/heartbeat`. */
export class AgentSessionHeartbeatDto {
  @IsOptional()
  @IsIn(NON_TERMINAL)
  status?: AgentSessionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentCardId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(AGENT_SESSION_SUMMARY_MAX)
  summary?: string;
}

/** Body of `POST /boards/:id/agent-sessions/:sessionId/end`. */
export class EndAgentSessionDto {
  @IsOptional()
  @IsIn(TERMINAL)
  status?: "completed" | "failed" | "cancelled";

  @IsOptional()
  @IsString()
  @MaxLength(AGENT_SESSION_SUMMARY_MAX)
  summary?: string;
}

/** `AGENT_SESSION_STATUSES` re-exported for the controller's docs/tests. */
export { AGENT_SESSION_STATUSES };
