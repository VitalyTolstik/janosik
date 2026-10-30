/**
 * Markdown renderers for the domain objects. Kept in one place so `get_board`,
 * `get_card`, `search_cards` and the activity feeds speak the same visual
 * language (headers, id in parentheses, badges) instead of drifting apart.
 */

import type {
  ActivityFeedEntry,
  AttachmentDto,
  Board,
  BoardMemberDto,
  BoardShareDto,
  BoardSummary,
  Card,
  CommentDto,
  Label,
} from "@janosik/shared";
import { DEFAULT_CARD_PRIORITY, DEFAULT_COMMENT_KIND } from "@janosik/shared";

import { bullets, code, formatTimestamp } from "./format.js";

function labelsById(labels: Label[]): Map<string, Label> {
  return new Map(labels.map((label) => [label.id, label]));
}

/** The badges a card carries on its face, as a short bracketed suffix. */
function cardBadges(card: Card, labels: Map<string, Label>): string {
  const parts: string[] = [];
  const priority = card.priority ?? DEFAULT_CARD_PRIORITY;
  if (priority !== DEFAULT_CARD_PRIORITY) parts.push(priority);
  if (card.dueDate !== undefined) {
    parts.push(`due ${formatTimestamp(card.dueDate)}`);
  }
  if (card.assigneeId) parts.push(`@${card.assigneeId}`);
  if (card.claimedBy) parts.push(`claimed @${card.claimedBy}`);
  if (card.labelIds.length > 0) {
    const names = card.labelIds.map((id) => labels.get(id)?.name ?? id);
    parts.push(names.join(", "));
  }
  const checklist = checklistProgress(card);
  if (checklist) parts.push(checklist);
  if (card.archivedAt !== undefined) parts.push("archived");
  if (card.links && card.links.length > 0)
    parts.push(`${card.links.length} link(s)`);
  return parts.length > 0 ? ` [${parts.join("; ")}]` : "";
}

function checklistProgress(card: Card): string | null {
  if (!card.checklists || card.checklists.length === 0) return null;
  let done = 0;
  let total = 0;
  for (const list of card.checklists) {
    for (const item of list.items) {
      total += 1;
      if (item.done) done += 1;
    }
  }
  return total > 0 ? `${done}/${total}` : null;
}

/** One board-list row. */
export function renderBoardSummaries(boards: BoardSummary[]): string {
  if (boards.length === 0) return "No boards yet.";
  const lines = boards.map((board) => {
    const archived = board.archivedAt !== undefined ? " (archived)" : "";
    return `${board.title}${archived} — ${code(board.id)} · ${board.role} · ${board.counters.columns} col / ${board.counters.cards} cards`;
  });
  return `# Boards (${boards.length})\n\n${bullets(lines)}`;
}

/** A full board: columns, their cards, labels and a summary header. */
export function renderBoard(board: Board): string {
  const labels = labelsById(board.labels);
  const allCards = Object.values(board.cards);
  const archived = allCards.filter((card) => card.archivedAt !== undefined);
  const header =
    `# ${board.title}\n\n` +
    `${code(board.id)} · ${board.columns.length} column(s), ` +
    `${allCards.length - archived.length} card(s)` +
    (archived.length > 0 ? `, ${archived.length} archived` : "");

  const columns = board.columns.map((column) => {
    const wip =
      column.wipLimit !== undefined
        ? ` — WIP ${column.cardIds.length}/${column.wipLimit}`
        : "";
    const cards = column.cardIds
      .map((id) => board.cards[id])
      .filter((card): card is Card => card !== undefined)
      .map(
        (card) =>
          `- ${card.title}${cardBadges(card, labels)} — ${code(card.id)}`,
      );
    return `## ${column.title}${wip}\n${code(column.id)}\n\n${bullets(cards, "_(empty)_")}`;
  });

  const labelList =
    board.labels.length > 0
      ? `\n\n## Labels\n\n${bullets(
          board.labels.map(
            (label) => `${label.name} (${label.color}) — ${code(label.id)}`,
          ),
        )}`
      : "";

  const archive =
    archived.length > 0
      ? `\n\n## Archived (${archived.length})\n\n${bullets(
          archived.map((card) => `${card.title} — ${code(card.id)}`),
        )}`
      : "";

  return `${header}\n\n${columns.join("\n\n")}${labelList}${archive}`;
}

/** A single card in full: fields, description, checklists and links. */
export function renderCard(card: Card, labels: Label[]): string {
  const byId = labelsById(labels);
  const lines: string[] = [
    `# ${card.title}`,
    "",
    `${code(card.id)}`,
    `- priority: ${card.priority ?? DEFAULT_CARD_PRIORITY}`,
    `- due: ${formatTimestamp(card.dueDate)}`,
    `- assignee: ${card.assigneeId ?? "—"}`,
    `- claimed: ${
      card.claimedBy
        ? `@${card.claimedBy} until ${formatTimestamp(card.leaseUntil)}`
        : "—"
    }`,
    `- labels: ${
      card.labelIds.length > 0
        ? card.labelIds.map((id) => byId.get(id)?.name ?? id).join(", ")
        : "—"
    }`,
    `- created: ${formatTimestamp(card.createdAt)}`,
    `- updated: ${formatTimestamp(card.updatedAt)}`,
  ];
  if (card.archivedAt !== undefined) lines.push("- archived: yes");
  if (card.description) lines.push("", "## Description", "", card.description);

  if (card.acceptanceCriteria && card.acceptanceCriteria.length > 0) {
    lines.push("", "## Acceptance criteria");
    lines.push(bullets(card.acceptanceCriteria));
  }
  if (card.definitionOfDone && card.definitionOfDone.length > 0) {
    lines.push("", "## Definition of done");
    lines.push(bullets(card.definitionOfDone));
  }

  if (card.checklists && card.checklists.length > 0) {
    lines.push("", "## Checklists");
    for (const list of card.checklists) {
      lines.push("", `### ${list.title} — ${code(list.id)}`);
      lines.push(
        bullets(
          list.items.map(
            (item) =>
              `${item.done ? "[x]" : "[ ]"} ${item.text} — ${code(item.id)}`,
          ),
          "_(no items)_",
        ),
      );
    }
  }
  if (card.links && card.links.length > 0) {
    lines.push("", "## Links");
    lines.push(
      bullets(
        card.links.map(
          (link) =>
            `${link.type} → ${code(link.targetCardId)} — ${code(link.id)}`,
        ),
      ),
    );
  }
  return lines.join("\n");
}

export function renderMembers(members: BoardMemberDto[]): string {
  if (members.length === 0) return "No members.";
  return `# Members (${members.length})\n\n${bullets(
    members.map(
      (member) =>
        `${member.displayName ?? member.email} <${member.email}> — ${member.role}` +
        (member.expiresAt
          ? ` (expires ${formatTimestamp(member.expiresAt)})`
          : "") +
        ` — ${code(member.userId)}`,
    ),
  )}`;
}

export function renderComments(
  comments: CommentDto[],
  nextCursor: string | null,
): string {
  if (comments.length === 0) return "No comments.";
  const lines = comments.map((comment) => {
    const kind =
      comment.kind !== DEFAULT_COMMENT_KIND ? ` [${comment.kind}]` : "";
    return `${formatTimestamp(comment.createdAt)} · ${comment.authorId} · ${code(comment.id)}${kind}\n  ${comment.text}`;
  });
  const more = nextCursor
    ? `\n\n_more: next_cursor = ${code(nextCursor)}_`
    : "";
  return `# Comments (${comments.length})\n\n${bullets(lines)}${more}`;
}

export function renderActivity(
  entries: ActivityFeedEntry[],
  nextCursor: string | null,
): string {
  if (entries.length === 0) return "No activity.";
  const lines = entries.map((entry) => {
    const changes = entry.changes
      ?.map(
        (change) =>
          `${change.field}: ${change.from ?? "—"} → ${change.to ?? "—"}`,
      )
      .join("; ");
    const detail = changes
      ? ` (${changes})`
      : entry.detail
        ? ` — ${entry.detail}`
        : "";
    const card = entry.cardId ? ` card ${code(entry.cardId)}` : "";
    return `${formatTimestamp(entry.at)} · ${entry.actorId} · ${entry.type}${card}${detail}`;
  });
  const more = nextCursor
    ? `\n\n_more: next_cursor = ${code(nextCursor)}_`
    : "";
  return `# Activity (${entries.length})\n\n${bullets(lines)}${more}`;
}

export function renderShares(shares: BoardShareDto[]): string {
  if (shares.length === 0) return "No share links.";
  return `# Share links (${shares.length})\n\n${bullets(
    shares.map((share) => {
      const state = share.revokedAt ? "revoked" : "active";
      return `${share.mode} · ${state} · ${share.views} views · ${code(share.token)} — ${code(share.id)}`;
    }),
  )}`;
}

export function renderAttachments(attachments: AttachmentDto[]): string {
  if (attachments.length === 0) return "No attachments.";
  return `# Attachments (${attachments.length})\n\n${bullets(
    attachments.map(
      (file) =>
        `${file.fileName} (${file.mimeType}, ${file.sizeBytes} bytes)` +
        `${file.transcodeStatus !== "none" ? ` · ${file.transcodeStatus}` : ""} — ${code(file.id)}`,
    ),
  )}`;
}
