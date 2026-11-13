import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { LIMITS } from "@janosik/shared";

/** Body of `PATCH /comments/:commentId` (TASK-176.2, plain text). */
export class UpdateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.comment)
  text!: string;
}
