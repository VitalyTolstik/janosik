import { IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";
import { API_TOKEN_NAME_MAX } from "@janosik/shared";

/** Body of `POST /users/me/tokens` (TASK-36.1). */
export class CreateUserTokenDto {
  @IsString()
  @MaxLength(API_TOKEN_NAME_MAX)
  name!: string;

  /** ISO-8601; omitted/`null` = never expires. Validated further in service. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
