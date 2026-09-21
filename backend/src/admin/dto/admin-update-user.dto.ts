import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * `PATCH /admin/users/:id` — rename, (un)block (TASK-36) or move the
 * sign-in email (TASK-51, master override: instant, no verification code).
 */
export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  displayName?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email?: string;
}
