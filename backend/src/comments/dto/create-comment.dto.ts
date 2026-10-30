import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { COMMENT_KINDS, LIMITS, type CommentKind } from "@janosik/shared";

/** Body of `POST /cards/:id/comments` (§7.4, plain text). */
export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.comment)
  text!: string;

  /**
   * Structured kind (TASK-157, D10). Omitted = `note`, so an ordinary comment
   * is unchanged; the swarm vocabulary (`blocker`, `question`, `handoff`, …)
   * makes a filter a query instead of a text scan.
   */
  @IsOptional()
  @IsIn(COMMENT_KINDS)
  kind?: CommentKind;

  /**
   * Client idempotency key (TASK-99): a retry that reuses the key returns the
   * first comment instead of appending a duplicate (and a duplicate Activity).
   * Optional — an anonymous/simple POST still works.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  commandId?: string;
}
