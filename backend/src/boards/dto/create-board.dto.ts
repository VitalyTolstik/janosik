import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { LIMITS } from "@janosik/shared";

/** Body of `POST /boards` — one source of truth for the title bound. */
export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.boardTitle)
  title!: string;
}
