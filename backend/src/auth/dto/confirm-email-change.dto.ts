import { IsString, Matches } from "class-validator";

/**
 * `POST /auth/email/change/confirm` (TASK-51) — step 2: the 6-digit code
 * that was delivered to the new address.
 */
export class ConfirmEmailChangeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}
