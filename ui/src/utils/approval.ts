import type {
  ApprovalKind,
  ApprovalRisk,
  ApprovalStatus,
} from "@janosik/shared";

import { formatDate } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/i18n";

type Translate = (
  key: MessageKey,
  options?: Record<string, string | number>,
) => string;

/**
 * The mockup's absolute decision moment: `Today, 5:15 PM`, `Yesterday, …`, or
 * the compact locale date for older rows. Decided rows never show "2 hours
 * ago"; the relative age only belongs to a pending TTL.
 */
export function formatApprovalMoment(
  timestamp: number,
  lang: string,
  t: Translate,
  nowMs = Date.now(),
): string {
  const date = new Date(timestamp);
  const now = new Date(nowMs);
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const time = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (days === 0) return t("agents.approvals.todayAt", { time });
  if (days === 1) return t("agents.approvals.yesterdayAt", { time });
  return formatDate(timestamp, lang);
}

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
