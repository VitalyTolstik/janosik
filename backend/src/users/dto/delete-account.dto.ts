import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

/** `DELETE /users/me` (TASK-166 §12.5). */
export class DeleteAccountDto {
  /** Required for an account with a local password. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  /** Required for an OAuth-only account; an OAuth-issued access token. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oauthProof?: string;

  /** Required for an OAuth-only account; the emailed six-digit code. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  emailCode?: string;

  /** Typed confirmation; must equal the account email. */
  @IsEmail()
  confirmEmail!: string;
}
