import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
}
