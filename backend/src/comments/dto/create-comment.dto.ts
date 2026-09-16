import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { LIMITS } from "@janosik/shared";

/** Body of `POST /cards/:id/comments` (§7.4, plain text). */
export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.comment)
  text!: string;
}
