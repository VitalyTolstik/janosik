import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
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

  @IsOptional()
  @IsBoolean()
  owner?: boolean;
}
