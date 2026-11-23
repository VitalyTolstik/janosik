import {
  IsBoolean,
  IsInt,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { LIMITS } from "@janosik/shared";

/**
 * TASK-200.7 card intent body. The command id is still the idempotency key;
 * omitting it makes the server mint one (only safe for a caller that accepts
 * a lost response creating a second command, so agents should always send it).
 */
export class CardIntentBaseDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  commandId?: string;

  /** Explicit full-board mode; a targeted intent normally omits this. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  ifMatch?: number;

  /** Per-entity preconditions, e.g. `{ "card:<id>": 7 }`. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  ifMatchVersions?: Record<string, number>;
}

/** Body of `POST /boards/:id/cards/:cardId/claim`. */
export class ClaimCardIntentDto extends CardIntentBaseDto {
  /** Lease length; clamped server-side to [1 min, 24 h]. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  leaseMs?: number;

  /** Release the caller's lease instead of acquiring one. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  release?: boolean;
}

/** Body of `POST /boards/:id/cards/:cardId/move`. */
export class MoveCardIntentDto extends CardIntentBaseDto {
  /** Destination column; omit to reorder inside the current column. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(128)
  toColumnId?: string;

  /** Zero-based destination slot; omit to append. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  position?: number;
}

/**
 * Body of `PATCH /boards/:id/cards/:cardId`: the two text fields
 * `UPDATE_CARD` owns. Field-specific writes (priority, assignee, due date,
 * cover, task spec) keep their command actions; they do not need a board read.
 */
export class PatchCardIntentDto extends CardIntentBaseDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(LIMITS.cardTitle)
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(LIMITS.description)
  description?: string;

  /** Compare-and-set on the description text the caller last read. */
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(LIMITS.description)
  expectedDescription?: string;
}
