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
import { COMMAND_BATCH_MAX } from "@janosik/shared";
import { CreateCommandDto } from "./create-command.dto";

/**
 * Body of `POST /boards/:id/commands/batch` (TASK-160): the same commands as
 * the single endpoint, applied in order under one board lock. The array is
 * bounded here (a cheap `400`), so an oversized batch never reaches the
 * service; each command's own size cap is still enforced per command.
 */
export class CreateCommandBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(COMMAND_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateCommandDto)
  commands!: CreateCommandDto[];

  /**
   * TASK-166.7: idempotency key for the PAT `AgentRun` created by this batch
   * (ADR §11.2). 8–64 `[A-Za-z0-9_-]`; ignored for browser batches.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  clientRunId?: string;
}
