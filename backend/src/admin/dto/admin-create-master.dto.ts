import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/** `POST /admin/admins` — owners mint another master account (TASK-36). */
export class AdminCreateMasterDto {
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

  /**
   * TASK-89: the panel sends `role` (OWNER/OPERATOR). It used to send an
   * `owner` boolean while the DTO declared `owner`, so `role` was stripped by
   * `whitelist: true` and every master came out an OPERATOR.
   */
  @IsOptional()
  @IsIn(["OWNER", "OPERATOR"])
  role?: "OWNER" | "OPERATOR";
}
