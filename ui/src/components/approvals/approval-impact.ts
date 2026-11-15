import type { ApprovalImpactDto } from "@janosik/shared";

import type { MessageKey } from "@/i18n";

type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;
type TranslatePlural = (
  key: MessageKey,
  count: number,
  params?: Record<string, string | number>,
) => string;

/** Whether the sentence describes the attention card or the detail body. */
export type ImpactVariant = "list" | "detail";

function joinConjunction(parts: readonly string[], lang: string): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const conjunction = lang === "ru" ? "и" : "and";
  if (parts.length === 2) return `${parts[0]} ${conjunction} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts.at(-1)}`;
}

/**
 * Build the localized "N comments, M attachments and history" clause.
 *
 * `impact === undefined` means the server could not count (the plan is not a
 * known DELETE_CARD target, or an older response has no impact field). The
 * sentence then names the categories without inventing numbers. A zero count
 * omits that category entirely.
 */
export function impactDetails(
  impact: ApprovalImpactDto | undefined,
  t: Translate,
  tp: TranslatePlural,
  lang: string,
  variant: ImpactVariant,
): string {
  if (impact === undefined) {
    return t(
      variant === "list"
        ? "agents.approvals.impact.listAll"
        : "agents.approvals.impact.detailAll",
    );
  }
  const parts: string[] = [];
  if (impact.comments > 0) {
    parts.push(tp("agents.approvals.impact.comments", impact.comments));
  }
  if (impact.attachments > 0) {
    parts.push(tp("agents.approvals.impact.attachments", impact.attachments));
  }
  parts.push(
    t(
      variant === "list"
        ? "agents.approvals.impact.listHistory"
        : "agents.approvals.impact.detailHistory",
    ),
  );
  return joinConjunction(parts, lang);
}

/** The attention-card sentence for a known DELETE_CARD target. */
export function deleteCardImpactSentence(
  card: string,
  impact: ApprovalImpactDto | undefined,
  t: Translate,
  tp: TranslatePlural,
  lang: string,
): string {
  return t("agents.approvals.listImpact", {
    card,
    details: impactDetails(impact, t, tp, lang, "list"),
  });
}

/** The detail / decision-dialog paragraph for a known DELETE_CARD target. */
export function destructiveCardImpactText(
  card: string,
  impact: ApprovalImpactDto | undefined,
  t: Translate,
  tp: TranslatePlural,
  lang: string,
): string {
  return t("agents.approvals.destructiveCardBody", {
    card,
    details: impactDetails(impact, t, tp, lang, "detail"),
  });
}
