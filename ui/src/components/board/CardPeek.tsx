import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  commentPlainExcerpt,
  DEFAULT_CARD_PRIORITY,
  LABEL_COLOR_DOT,
  type Board,
  type Card,
} from "@janosik/shared";

import { Button } from "@/components/ui/button";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardActions, useBoardState } from "@/store/BoardContext";
import { useBoardMember } from "@/store/board-live";
import {
  cardById,
  cardChecklistProgress,
  cardHasDescription,
  hasCardDetail,
} from "@/store/read-model";
import { userLabel } from "@/utils/avatar";
import { priorityLabel } from "@/utils/priority";

type CardPeekProps = {
  boardId: string;
  cardId: string | null;
  onOpenCard: (cardId: string) => void;
};

export function CardPeek({ boardId, cardId, onOpenCard }: CardPeekProps) {
  const { board } = useBoardState();
  const { t } = useI18n();
  const card = cardById(board?.cards, cardId);
  if (
    !board ||
    board.id !== boardId ||
    !card ||
    card.archivedAt !== undefined
  ) {
    return (
      <p className="p-4 text-ui-body text-muted-foreground">
        {t(cardId ? "inspector.cardMissing" : "inspector.selectCard")}
      </p>
    );
  }

  return (
    <CardSummary
      key={card.id}
      board={board}
      card={card}
      onOpenCard={onOpenCard}
    />
  );
}

function CardSummary({
  board,
  card,
  onOpenCard,
}: {
  board: Board;
  card: Card;
  onOpenCard: CardPeekProps["onOpenCard"];
}) {
  const boardId = board.id;
  const { loadCardDetail } = useBoardActions();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const member = useBoardMember(boardId, card.assigneeId);
  const [detailState, setDetailState] = useState<
    "loading" | "missing" | "error"
  >("loading");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const needsDescription = !hasCardDetail(card) && cardHasDescription(card);

  useEffect(() => {
    if (!needsDescription) return;
    let cancelled = false;
    void loadCardDetail(boardId, card.id).then(
      (result) => {
        if (!result && !cancelled) setDetailState("missing");
      },
      () => {
        if (!cancelled) setDetailState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    boardId,
    card.id,
    card.updatedAt,
    needsDescription,
    loadCardDetail,
    detailAttempt,
  ]);

  function retryDescription() {
    setDetailState("loading");
    setDetailAttempt((attempt) => attempt + 1);
  }

  if (needsDescription && detailState === "missing") {
    return (
      <p className="p-4 text-ui-body text-muted-foreground">
        {t("inspector.cardMissing")}
      </p>
    );
  }

  const column = board.columns.find(({ cardIds }) => cardIds.includes(card.id));
  const labels = board.labels.filter(({ id }) => card.labelIds.includes(id));
  const { done, total } = cardChecklistProgress(card);
  const description = card.description
    ? commentPlainExcerpt(card.description, 320)
    : "";

  return (
    <section className="space-y-5 p-4 [overflow-wrap:anywhere]">
      <div className="space-y-2">
        <h3 className="text-ui-title font-semibold">{card.title}</h3>
        {labels.length > 0 ? (
          <ul
            aria-label={t("view.table.labels")}
            className="flex flex-wrap gap-1.5"
          >
            {labels.map((label) => (
              <li
                key={label.id}
                className="flex min-w-0 max-w-full items-start gap-1.5 rounded-md border bg-muted px-2 py-1 text-ui-label"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    LABEL_COLOR_DOT[label.color],
                  )}
                />
                <span className="min-w-0">{label.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/40 p-3 text-ui-body">
        {[
          [t("view.table.column"), column?.title ?? "—"],
          [
            t("history.field.dueDate"),
            card.dueDate === undefined
              ? "—"
              : formatDate(card.dueDate, lang, hour12),
          ],
          [
            t("card.assigneeLabel"),
            card.assigneeId
              ? userLabel(member?.displayName, member?.email ?? card.assigneeId)
              : t("card.assignee.unassigned"),
          ],
          [
            t("history.field.priority"),
            priorityLabel(card.priority ?? DEFAULT_CARD_PRIORITY, lang),
          ],
          [
            t("view.table.checklists"),
            total ? t("checklist.badgeTooltip", { done, total }) : "—",
          ],
          [t("card.attachments.title"), card.attachmentCount ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="mb-0.5 text-ui-label text-muted-foreground">
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <h4 className="text-ui-label font-semibold">
          {t("card.descriptionLabel")}
        </h4>
        {needsDescription && detailState === "error" ? (
          <div className="flex flex-wrap items-center gap-2 text-ui-body text-muted-foreground">
            <span>{t("card.description.loadFailed")}</span>
            <Button
              variant="outline"
              size="sm"
              className="inspector-action"
              onClick={retryDescription}
            >
              {t("sync.retry")}
            </Button>
          </div>
        ) : (
          <p className="line-clamp-5 text-ui-body text-muted-foreground">
            {needsDescription
              ? t("card.description.loading")
              : description || "—"}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        className="inspector-action w-full"
        onClick={() => onOpenCard(card.id)}
      >
        {t("inspector.openCard")}
        <ArrowUpRight aria-hidden />
      </Button>
    </section>
  );
}
