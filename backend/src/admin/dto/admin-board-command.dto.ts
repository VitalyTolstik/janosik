import { Transform } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import type { BoardAction } from "@janosik/shared";
import { ADMIN_ID_PATTERN } from "./admin-list-query.dto";

/**
 * `POST /admin/boards/:id/commands` (TASK-43). `action` is intentionally a
 * loose object here: the command layer runs the shared strict validator on
 * it (same one the board UI goes through), which yields `400 {field}`.
 */
export class AdminBoardCommandDto {
  /**
   * Optional idempotency key. It is also the command ↔ audit correlation id
   * (TASK-176.10), so it uses the same trimmed id contract as every admin
   * list filter: non-empty, ≤64 chars, `[A-Za-z0-9_-]`.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(64)
  @Matches(ADMIN_ID_PATTERN)
  commandId?: string;

  @IsObject()
  action!: BoardAction;
}
