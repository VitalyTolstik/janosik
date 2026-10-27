import { Transform } from "class-transformer";
import { IsEmail, IsEnum, IsISO8601, IsOptional } from "class-validator";
import { Role } from "@prisma/client";

/**
 * Body of `POST /boards/:id/members`.
 *
 * `expiresAt` (ISO 8601) is honoured for VIEWER only — a time-limited guest
 * (§7.0); for ADMIN/MEMBER it is ignored by the service.
 */
export class InviteMemberDto {
  // Same normalization as register/login: emails are stored lowercased.
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
