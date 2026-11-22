import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { COMMENT_KINDS, LIMITS, type CommentKind } from "@janosik/shared";

/**
 * Body of `PATCH /comments/:commentId` (TASK-176.2, TASK-177.11).
 *
 * Both fields are optional so the author can fix the text, retype the kind,
 * or do both in one save. `@ValidateIf` (not `@IsOptional`) makes an explicit
 * `null` fail validation instead of silently acting as "omitted"; the service
 * rejects an empty body.
 *
 * TASK-177.12: a text edit may add `https://janosik.invalid/mention/<userId>` links; the service
 * validates and notifies only newly mentioned members (repeat edits keep the
 * original deduplicated row).
 */
export class UpdateCommentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.comment)
  text?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(COMMENT_KINDS)
  kind?: CommentKind;
}
