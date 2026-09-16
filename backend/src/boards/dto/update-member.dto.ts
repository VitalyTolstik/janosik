import { IsEnum, IsISO8601, IsOptional } from "class-validator";
import { Role } from "@prisma/client";

/**
 * Body of `PATCH /boards/:id/members/:userId`.
 *
 * Both fields are optional: `role` changes the membership role, `expiresAt`
 * (ISO 8601 or explicit `null` to clear) adjusts a VIEWER's time budget.
 */
export class UpdateMemberDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
