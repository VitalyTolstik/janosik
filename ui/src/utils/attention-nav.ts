import type { AttentionNotificationDto, BoardRole } from "@janosik/shared";

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

/** The current location the bell is open over. */
export interface AttentionLocation {
  pathname: string;
  search: string;
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

function cardTarget(boardId: string, cardId: string): AttentionLinkTarget {
  return {
    kind: "card",
    path: cardPath(boardId, cardId),
    href: cardHref(boardId, cardId),
  };
}

function accountTarget(
  location: AttentionLocation,
  section: AccountSection,
): AttentionLinkTarget {
  return {
    kind: "account",
    path: accountPath(location.pathname, location.search, section),
    href: accountHref(location.pathname, location.search, section),
  };
}

/**
 * Resolve one row to its real destination. `location` is the current page:
 * the account panel has no route of its own, so its link stays where the
 * bell is open and keeps that page's filters. `role` is the caller's role on
 * the row's board — only an ADMIN can open the approvals tab, because the
 * control dialog intentionally shows Pause to everyone else.
 */
export function attentionTarget(
  item: Pick<AttentionNotificationDto, "type" | "boardId" | "data">,
  location: AttentionLocation,
  role: BoardRole | undefined,
): AttentionLinkTarget | null {
  const boardId = item.boardId;
  const cardId = stringField(item.data, "cardId");

  if (
    item.type === "agent.blocked" ||
    item.type === "agent.needs_human" ||
    item.type === "claim.expired"
  ) {
    if (boardId === null || cardId === null) return null;
    return cardTarget(boardId, cardId);
  }

  if (item.type.startsWith("approval.")) {
    if (boardId === null) return null;
    if (role === "ADMIN") {
      const approvalId = stringField(item.data, "approvalId");
      const path = approvalPath(boardId, approvalId);
      return { kind: "approval", path, href: appPath(path) };
    }
    // `AgentControlDialog` opens Pause for a non-admin even when asked for
    // the approvals tab, so a non-admin gets the board (or the card the
    // approval is about) instead of a misleading approvals deep link.
    if (cardId !== null) return cardTarget(boardId, cardId);
    const path = routes.board(boardId);
    return { kind: "board", path, href: appPath(path) };
  }

  if (item.type === "quota.exceeded") {
    // A board/plan limit raised while creating a board has no board yet.
    if (boardId === null) return accountTarget(location, "profile");
    const path = routes.board(boardId);
    return { kind: "board", path, href: appPath(path) };
  }

  if (item.type === "token.revoked") return accountTarget(location, "tokens");

  return null;
}
