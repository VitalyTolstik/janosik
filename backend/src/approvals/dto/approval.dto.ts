import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { APPROVAL_KINDS, type ApprovalKind } from "@janosik/shared";

/** Body of `POST /boards/:id/approvals` (PAT only, TASK-166.5). */
export class CreateApprovalDto {
  @IsIn(APPROVAL_KINDS)
  kind!: ApprovalKind;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cardId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttlMinutes?: number;

  /** Validated by `normalizeApprovalPlan` so the shape stays one validator. */
  @IsObject()
  plan!: Record<string, unknown>;
}

/** Body of `POST /boards/:id/approvals/:approvalId/decision`. */
export class ApprovalDecisionDto {
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @Matches(/^[0-9a-f]{64}$/)
  planHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** `GET /boards/:id/approvals` query filters. */
export class ApprovalListQueryDto {
  @IsOptional()
  @IsIn(["pending", "approved", "rejected", "expired", "cancelled", "consumed"])
  status?: string;

  @IsOptional()
  @IsIn(APPROVAL_KINDS)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cardId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
