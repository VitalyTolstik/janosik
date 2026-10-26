import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

/** Body of `POST /boards/:id/commands` (§7.4). */
export class CreateCommandDto {
  /** Client-generated idempotency key — the `Command` primary key. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  commandId!: string;

  /** The reducer action; validated strictly by `validateBoardAction` (shared). */
  @IsObject()
  action!: Record<string, unknown>;

  /** Expected board `seq`; a mismatch is answered with `409 { conflict }`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  ifMatch?: number;

  /**
   * Per-entity optimistic-concurrency preconditions (TASK-29), keyed by the
   * `touch` label (`board:<id>`, `card:<id>`, …). Keys and integer values are
   * validated in `CommandsService` (see `CommandRequest.ifMatchVersions`).
   */
  @IsOptional()
  @IsObject()
  ifMatchVersions?: Record<string, number>;
}
