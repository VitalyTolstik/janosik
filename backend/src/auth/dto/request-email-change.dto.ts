import { Transform } from "class-transformer";
import { IsEmail, IsString, MinLength } from "class-validator";

/**
 * `POST /auth/email/change/request` (TASK-51) — step 1 of the double
 * opt-in: the user proves the current password and names the new address.
 */
export class RequestEmailChangeDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  newEmail!: string;

  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
