import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/** `PATCH /admin/users/:id` — rename and/or (un)block an account (TASK-36). */
export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  displayName?: string;
}
