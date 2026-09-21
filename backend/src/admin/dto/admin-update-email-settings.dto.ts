import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { EMAIL_SMTP_PRESET_IDS } from "@janosik/shared";

/**
 * `PUT /admin/email-settings` (TASK-52) — saved outgoing-mail transport.
 * For a preset provider the backend takes host/port/secure from the preset;
 * with `custom` they come from the client. `password` semantics: undefined
 * = keep the stored one, null = clear, a string = replace.
 */
export class AdminUpdateEmailSettingsDto {
  @IsIn(EMAIL_SMTP_PRESET_IDS)
  provider!: (typeof EMAIL_SMTP_PRESET_IDS)[number];

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  from!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string | null;

  @IsBoolean()
  enabled!: boolean;
}
