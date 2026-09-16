import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength } from "class-validator";

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  // No MinLength on login: a too-short password must answer 401 like any
  // other wrong credential, not 400 that reveals the policy. MaxLength caps
  // the input before argon2 so an oversized password cannot burn CPU.
  @IsString()
  @MaxLength(100)
  password!: string;
}
