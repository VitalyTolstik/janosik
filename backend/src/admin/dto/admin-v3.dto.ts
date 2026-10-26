import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** TASK-59…65 request bodies for the master panel. */

export class AdminAddBoardMemberDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(["ADMIN", "MEMBER", "VIEWER"])
  role?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expiresAt?: number | null;
}

export class AdminUpdateBoardMemberDto {
  @IsOptional()
  @IsIn(["ADMIN", "MEMBER", "VIEWER"])
  role?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expiresAt?: number | null;

  @IsOptional()
  @IsBoolean()
  accepted?: boolean;
}

export class AdminTransferOwnerDto {
  @IsString()
  userId!: string;
}

export class AdminBulkDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsIn(["delete", "restore", "archive", "unarchive"])
  action!: "delete" | "restore" | "archive" | "unarchive";
}

export class AdminUpdateFeatureFlagDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  perUser?: Record<string, boolean> | null;
}

export class AdminUpdateOpsDto {
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  maintenanceMessage?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  perUserRateLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3_650)
  retentionDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_080)
  maintenanceIntervalMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  digestIntervalHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  reminderLeadHours?: number | null;
}

const MAINTENANCE_JOBS = [
  "all",
  "purge-soft-deleted",
  "sweep-codes",
  "sweep-tokens",
  "sweep-shares",
  "sweep-invitations",
  "sweep-exports",
  "sweep-orphan-blobs",
] as const;

export class AdminMaintenanceRunDto {
  @IsIn(MAINTENANCE_JOBS)
  job!: (typeof MAINTENANCE_JOBS)[number];
}

export class AdminCreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsIn(["info", "warning", "danger"])
  level?: "info" | "warning" | "danger";

  @IsOptional()
  @IsIn(["all", "segment"])
  audience?: "all" | "segment";

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  segment?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  startsAt?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  endsAt?: number | null;
}

export class AdminUpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsIn(["info", "warning", "danger"])
  level?: "info" | "warning" | "danger";

  @IsOptional()
  @IsIn(["all", "segment"])
  audience?: "all" | "segment";

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  segment?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  startsAt?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  endsAt?: number | null;
}

export class AdminSendEmailDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}

export class AdminUpdateEmailTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  bodyHtml!: string;
}

export class AdminVerifyTotpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class AdminUpdateSecurityDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ipAllowlist?: string | null;

  @IsOptional()
  @IsBoolean()
  totpEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  totpCode?: string;
}
