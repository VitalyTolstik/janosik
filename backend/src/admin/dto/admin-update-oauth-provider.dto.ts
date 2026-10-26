import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Master-panel edit of one OAuth provider (TASK-54). `clientSecret`
 * semantics mirror the email settings password: `undefined` = keep the
 * stored one, `null` = clear it, a string = replace it. The secret never
 * leaves the backend — the GET answer only exposes `hasSecret`.
 */
export class AdminUpdateOAuthProviderDto {
  @IsString()
  @MaxLength(255)
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSecret?: string | null;

  @IsBoolean()
  enabled!: boolean;
}
