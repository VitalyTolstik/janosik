import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Body of `POST /auth/password` (TASK-36.1). */
export class ChangePasswordDto {
  /** Required for an account that already has a password. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentPassword?: string;

  /** OAuth-only accounts prove the operation with a fresh OAuth token. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oauthProof?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword!: string;
}
