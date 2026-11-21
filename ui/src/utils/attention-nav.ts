import type { AttentionNotificationDto } from "@janosik/shared";

import { appPath } from "./app-path";
import { accountHref, accountPath, type AccountSection } from "./account-nav";
import { routes } from "@/routes";

import { cardHref, cardPath } from "./card-nav";

/**
 * Where one attention row leads (TASK-177.6).
 *
 * `data` is deliberately a small, non-sensitive record. Only the fields with
 * a known meaning are read; a row whose context is missing or malformed gets
 * no link at all rather than a dead link to nowhere.
 */
export type AttentionLinkKind = "card" | "approval" | "board" | "account";

export interface AttentionLinkTarget {
  kind: AttentionLinkKind;
  /** Router-relative path for the SPA navigation. */
  path: string;
  /** Site-root-relative href for the anchor (deploy base included). */
  href: string;
}

function stringField(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Board approvals surface: the header opens its agent-control dialog from
 * `?agents=inbox` (the approvals tab), and the approvals panel reads an
 * optional `?approval=` id to focus one request. Both params already exist;
 * this builder only composes them.
 */
export function approvalPath(
  boardId: string,
  approvalId: string | null,
): string {
  const search = new URLSearchParams({ agents: "inbox" });
  if (approvalId !== null) search.set("approval", approvalId);
  return `${routes.board(boardId)}?${search.toString()}`;
}

function accountTarget(
  pathname: string,
  section: AccountSection,
): AttentionLinkTarget {
  const path = accountPath(pathname, section);
  return { kind: "account", path, href: accountHref(pathname, section) };
}

/**
 * Resolve one row to its real destination. `pathname` is the current page:
 * the account panel has no route of its own, so its link stays on the page
 * the bell is open over.
 */
export function attentionTarget(
  item: Pick<AttentionNotificationDto, "type" | "boardId" | "data">,
  pathname: string,
): AttentionLinkTarget | null {
  const boardId = item.boardId;
  const cardId = stringField(item.data, "cardId");

  if (
    item.type === "agent.blocked" ||
    item.type === "agent.needs_human" ||
    item.type === "claim.expired"
  ) {
    if (boardId === null || cardId === null) return null;
    return {
      kind: "card",
      path: cardPath(boardId, cardId),
      href: cardHref(boardId, cardId),
    };
  }

  if (item.type.startsWith("approval.")) {
    if (boardId === null) return null;
    const approvalId = stringField(item.data, "approvalId");
    const path = approvalPath(boardId, approvalId);
    return { kind: "approval", path, href: appPath(path) };
  }

  if (item.type === "quota.exceeded") {
    // A board/plan limit raised while creating a board has no board yet.
    if (boardId === null) return accountTarget(pathname, "profile");
    const path = routes.board(boardId);
    return { kind: "board", path, href: appPath(path) };
  }

  if (item.type === "token.revoked") return accountTarget(pathname, "tokens");

  return null;
}
