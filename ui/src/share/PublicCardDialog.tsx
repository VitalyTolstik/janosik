import { useEffect, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";

import type {
  AttachmentDto,
  Board,
  BoardMemberDto,
  Card,
  CommentDto,
  PublicBoardMemberDto,
} from "@janosik/shared";
import { LABEL_COLOR_CHIP, LIMITS } from "@janosik/shared";
import { DueBadge } from "@/components/board/DueBadge";
import { PriorityBadge } from "@/components/board/PriorityBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { userAvatarColor, userInitials, userLabel } from "@/utils/avatar";
import {
  fetchPublicAttachments,
  fetchPublicComments,
  publicAttachmentUrl,
} from "@/share/share-api";

/**
 * Read-only card panel for the public share page (TASK-58). Deliberately a
 * small dedicated component rather than the app's `CardDialog`: the latter is
 * wired to the authenticated card REST client (comments/attachments), while
 * a public viewer must read them through the `/share/:token` endpoints (or
 * not at all, per the share's flags).
 */
export function PublicCardDialog({
  token,
  board,
  members,
  cardId,
  includeComments,
  includeAttachments,
  onClose,
}: {
  token: string;
  board: Board;
  members: BoardMemberDto[];
  cardId: string;
  includeComments: boolean;
  includeAttachments: boolean;
  onClose: () => void;
}) {
  const card = board.cards[cardId];

  if (card === undefined) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg">{card.title}</DialogTitle>
        </DialogHeader>

        <CardBody
          token={token}
          board={board}
          card={card}
          members={members}
          includeComments={includeComments}
          includeAttachments={includeAttachments}
        />
      </DialogContent>
    </Dialog>
  );
}

function CardBody({
  token,
  board,
  card,
  members,
  includeComments,
  includeAttachments,
}: {
  token: string;
  board: Board;
  card: Card;
  members: BoardMemberDto[];
  includeComments: boolean;
  includeAttachments: boolean;
}) {
  const { t } = useI18n();
  const labels = (card.labelIds ?? [])
    .map((id) => board.labels.find((label) => label.id === id))
    .filter((label): label is NonNullable<typeof label> => label !== undefined);
  const assignee = members.find((member) => member.userId === card.assigneeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {card.priority !== undefined ? (
          <PriorityBadge priority={card.priority} showLabel />
        ) : null}
        {card.dueDate !== undefined ? (
          <DueBadge dueDate={card.dueDate} />
        ) : null}
      </div>

      {assignee !== undefined ? (
        <div className="flex items-center gap-2 text-sm">
          <PublicAvatar member={assignee} />
          <span className="text-muted-foreground">
            {t("card.assigneeLabel")}
          </span>
        </div>
      ) : null}

      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={`rounded px-2 py-0.5 text-xs font-medium text-white ${LABEL_COLOR_CHIP[label.color]}`}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      {card.description !== undefined && card.description.trim() !== "" ? (
        <p
          className="whitespace-pre-wrap text-sm"
          data-testid="public-description"
        >
          {card.description}
        </p>
      ) : null}

      {(card.checklists ?? []).map((checklist) => {
        const items = checklist.items ?? [];
        const done = items.filter((item) => item.done).length;
        return (
          <div key={checklist.id} className="space-y-1">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{checklist.title}</span>
              <span className="text-xs text-muted-foreground">
                {done}/{items.length}
              </span>
            </div>
            <ul className="space-y-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-center gap-2 text-sm ${
                    item.done ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border"
                    aria-hidden
                  />
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {includeAttachments ? (
        <PublicAttachments token={token} cardId={card.id} />
      ) : null}

      {includeComments ? (
        <PublicComments token={token} cardId={card.id} members={members} />
      ) : null}
    </div>
  );
}

function PublicAvatar({
  member,
}: {
  member: PublicBoardMemberDto | BoardMemberDto;
}) {
  const displayName = member.displayName;
  const color = member.avatarColor;
  const id = "id" in member ? member.id : member.userId;
  const initials = userInitials(displayName, "");
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${userAvatarColor(
        id,
        color,
      )}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function PublicAttachments({
  token,
  cardId,
}: {
  token: string;
  cardId: string;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<AttachmentDto[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchPublicAttachments(token, cardId)
      .then((list) => active && setItems(list))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [token, cardId]);

  if (items === null || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t("card.attachments.title")}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={publicAttachmentUrl(token, item.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {item.fileName}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PublicComments({
  token,
  cardId,
  members,
}: {
  token: string;
  cardId: string;
  members: BoardMemberDto[];
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<CommentDto[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchPublicComments(token, cardId, undefined, 50)
      .then((page) => active && setItems(page.items))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [token, cardId]);

  if (items === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("activity.comments")}</p>
      <ul className="space-y-2" data-testid="public-comments">
        {items.map((comment) => {
          const author = members.find(
            (member) => member.userId === comment.authorId,
          );
          return (
            <li key={comment.id} className="flex gap-2">
              {author !== undefined ? <PublicAvatar member={author} /> : null}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  {author !== undefined
                    ? userLabel(author.displayName, "")
                    : t("share.public.anonymous")}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {comment.text.slice(0, LIMITS.comment)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
