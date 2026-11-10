import { Allow, IsInt, Min } from "class-validator";

/**
 * Body of `PATCH /boards/:id/agent-policy` (TASK-166.15, ADR §6.3).
 *
 * `policy` is deliberately `Allow()`ed here and validated centrally with the
 * shared `validateBoardAgentPolicy` helper: the same rules guard imports and
 * the command transport, and a second class-validator copy would drift.
 */
export class UpdateBoardAgentPolicyDto {
  @Allow()
  policy!: unknown;

  @IsInt()
  @Min(1)
  version!: number;
}
