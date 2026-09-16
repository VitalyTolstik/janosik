import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { ADMIN_PASSWORD_MAX, ADMIN_PASSWORD_MIN } from "@janosik/shared";

/**
 * `POST /admin/users` (TASK-36). Without `password` the server generates a
 * strong one and returns it exactly once; a supplied password must satisfy
 * the same bounds as public registration.
 */
export class AdminCreateUserDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(ADMIN_PASSWORD_MIN)
  @MaxLength(ADMIN_PASSWORD_MAX)
  password?: string;
}
