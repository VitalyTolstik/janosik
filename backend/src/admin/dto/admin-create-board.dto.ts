import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { LIMITS } from "@janosik/shared";

/** `POST /admin/boards` — a board created by the master for a real owner. */
export class AdminCreateBoardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(LIMITS.boardTitle)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  title!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  ownerEmail!: string;
}
