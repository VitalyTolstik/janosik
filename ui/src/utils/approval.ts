import type {
  ApprovalKind,
  ApprovalRisk,
  ApprovalStatus,
} from "@janosik/shared";

import type { MessageKey } from "@/i18n/i18n";

export const APPROVAL_STATUS_KEYS: Record<ApprovalStatus, MessageKey> = {
  pending: "agentControl.status.pending",
  approved: "agentControl.status.approved",
  rejected: "agentControl.status.rejected",
  expired: "agentControl.status.expired",
  cancelled: "agentControl.status.cancelled",
  consumed: "agentControl.status.consumed",
};

export const APPROVAL_RISK_KEYS: Record<ApprovalRisk, MessageKey> = {
  low: "agentControl.risk.low",
  medium: "agentControl.risk.medium",
  high: "agentControl.risk.high",
};

export const APPROVAL_KIND_KEYS: Record<ApprovalKind, MessageKey> = {
  destructive: "agentControl.kind.destructive",
  done: "agentControl.kind.done",
  custom: "agentControl.kind.custom",
};

/**
 * Effective status for UI decisions. The server keeps the stored status until
 * its lazy expiry path runs; a pending row whose TTL passed is already expired
 * for buttons, filters and counts (TASK-179.3).
 */
export function effectiveApprovalStatus(
  status: ApprovalStatus,
  expiresAt: number,
  now: number,
): ApprovalStatus {
  return status === "pending" && expiresAt <= now ? "expired" : status;
}
