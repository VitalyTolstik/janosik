import { IsString, Matches } from "class-validator";

/**
 * `POST /auth/verify-email` (TASK-53) — the 6-digit code that was delivered
 * to the address the account was registered with.
 */
export class VerifyEmailDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}
