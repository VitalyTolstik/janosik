import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  registerDecorator,
  type ValidationOptions,
} from "class-validator";
import {
  ANNOUNCEMENT_FALLBACK_POLICIES,
  ANNOUNCEMENT_LOCALES,
} from "@janosik/shared";
import { MAINTENANCE_JOBS } from "@/ops/maintenance.service";

/**
 * TASK-112: `Record<string, boolean> | null`. `@IsObject()` alone would let
 * a `{ "user-1": "yes" }` through; the flag service reads the values as
 * booleans, so the shape is validated here.
 */
function IsBooleanRecord(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: "isBooleanRecord",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === null) return true;
          if (typeof value !== "object" || Array.isArray(value)) return false;
          return Object.values(value as Record<string, unknown>).every(
            (entry) => typeof entry === "boolean",
          );
        },
        defaultMessage(): string {
          return "$property must be an object of boolean values";
        },
      },
    });
  };
}

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
  @IsBooleanRecord()
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

// One source of truth with `MaintenanceService` (TASK-156).
const MAINTENANCE_JOB_CHOICES = ["all", ...MAINTENANCE_JOBS] as const;

export class AdminMaintenanceRunDto {
  @IsIn(MAINTENANCE_JOB_CHOICES)
  job!: (typeof MAINTENANCE_JOB_CHOICES)[number];
}

export class AdminCreateAnnouncementDto {
  /** @deprecated Pre-localization payload; maps to the source translation. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** @deprecated Pre-localization payload; maps to the source translation. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_LOCALES)
  sourceLocale?: (typeof ANNOUNCEMENT_LOCALES)[number];

  @IsOptional()
  @IsIn(ANNOUNCEMENT_FALLBACK_POLICIES)
  fallbackPolicy?: (typeof ANNOUNCEMENT_FALLBACK_POLICIES)[number];

  /**
   * Locale → `{ title, body }`. Shape and per-locale limits are checked in
   * `CommsService` because the map is dynamic; the object check keeps arrays
   * and scalars out of the service.
   */
  @IsOptional()
  @IsObject()
  translations?: Record<string, { title: string; body: string } | null>;

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
  /** @deprecated Pre-localization payload; updates the source translation. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** @deprecated Pre-localization payload; updates the source translation. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_LOCALES)
  sourceLocale?: (typeof ANNOUNCEMENT_LOCALES)[number] | null;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_FALLBACK_POLICIES)
  fallbackPolicy?: (typeof ANNOUNCEMENT_FALLBACK_POLICIES)[number];

  @IsOptional()
  @IsObject()
  translations?: Record<string, { title: string; body: string } | null>;

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

  /** Optimistic concurrency: version loaded with the announcement. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
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

export class AdminMasterAllowlistDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(500)
  ipAllowlist!: string | null;
}
