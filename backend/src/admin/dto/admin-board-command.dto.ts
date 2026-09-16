import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import type { BoardAction } from "@janosik/shared";

/**
 * `POST /admin/boards/:id/commands` (TASK-43). `action` is intentionally a
 * loose object here: the command layer runs the shared strict validator on
 * it (same one the board UI goes through), which yields `400 {field}`.
 */
export class AdminBoardCommandDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  commandId?: string;

  @IsObject()
  action!: BoardAction;
}
