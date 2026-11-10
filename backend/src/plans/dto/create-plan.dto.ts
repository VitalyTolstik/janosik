import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";
import { CreateCommandDto } from "@/commands/dto/create-command.dto";

/**
 * Body of `POST /boards/:id/plans` (TASK-166.8). The array bound is a body
 * sanity cap, not the plan limit: the per-board cap (`min(100,
 * policy.maxCommandsPerRun)`) is enforced in the service and answers
 * `409 limit_exceeded`, exactly like an approval plan.
 */
export class CreatePlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => CreateCommandDto)
  commands!: CreateCommandDto[];

  /** Idempotency key for the PAT `AgentRun` (`kind: "plan"`) on apply. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  clientRunId?: string;
}

/** Body of `POST /boards/:id/plans/apply`. */
export class ApplyPlanDto extends CreatePlanDto {
  /**
   * Canonical hash returned by the preview. A client hash is never trusted on
   * its own: the server recomputes it from the submitted commands and refuses
   * a mismatch with `409 approval_mismatch`.
   */
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  planHash!: string;
}
