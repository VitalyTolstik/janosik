import { IsOptional, IsString, MaxLength } from "class-validator";

/** Free-text reason bound for a pause/resume note. */
export const AGENT_PAUSE_REASON_MAX = 500;

/**
 * Body of every TASK-166.3 pause/resume route. The reason is optional: a
 * quick "stop now" must not require an explanation, but the UI can store one
 * on the session/board stamp or in the security audit.
 */
export class AgentPauseDto {
  @IsOptional()
  @IsString()
  @MaxLength(AGENT_PAUSE_REASON_MAX)
  reason?: string;
}
