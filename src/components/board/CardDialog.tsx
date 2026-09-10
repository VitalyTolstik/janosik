import { useState } from "react";
import { ArrowRightLeft, CalendarClock, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { CardChecklists } from "@/components/board/CardChecklists";
import { CardDueDate } from "@/components/board/CardDueDate";
import { CardCoverPicker } from "@/components/board/CardCoverPicker";
import { LabelPicker } from "@/components/board/LabelPicker";
import { DescriptionEditor } from "@/components/editor/DescriptionEditor";
import { formatDate, useI18n } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBoard } from "@/store/BoardContext";
import { createId } from "@/utils/id";
import type { LabelColor } from "@/types/kanban";

interface CardDialogProps {
  cardId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Card detail popover: edit the title, pick a label, move the card to another
 * column and delete it (with confirmation). Title changes are saved live.
 */
export function CardDialog({ cardId, open, onOpenChange }: CardDialogProps) {
  const {
    board,
    updateCard,
    toggleCardLabel,
    addLabel,
    renameLabel,
    setLabelColor,
    deleteLabel,
    moveCard,
    deleteCard,
  } = useBoard();
  const { t, lang } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!board || !cardId) {
    // Dialog stays closed when there's nothing to show.
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("card.notFoundTitle")}</DialogTitle>
            <DialogDescription>{t("card.notFoundDesc")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const card = board.cards[cardId];
  // Card may have been deleted while the dialog was open.
  if (!card) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("card.notFoundTitle")}</DialogTitle>
            <DialogDescription>{t("card.deletedDesc")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const currentColumn = board.columns.find((col) =>
    col.cardIds.includes(card.id),
  );

  const handleDelete = () => {
    deleteCard(card.id);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  const handleCreateLabel = (name: string, color: LabelColor) => {
    const label = { id: createId(), name, color };
    addLabel(label);
    if (card) toggleCardLabel(card.id, label.id);
  };

  const handleMove = (columnId: string) => {
    const target = board.columns.find((col) => col.id === columnId);
    if (!target) return;
    moveCard(
      card.id,
      currentColumn?.id ?? target.id,
      columnId,
      target.cardIds.length,
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">
              {t("card.detailsTitle")}
            </DialogTitle>
            <DialogDescription>{t("card.detailsSubtitle")}</DialogDescription>
          </DialogHeader>

          {/* Scrollable body: the dialog caps itself to the viewport height
              (see ui/dialog.tsx), so tall cards (long descriptions, many
              checklists) scroll here while the header and the action footer
              below stay reachable. The negative/positive margin pair keeps
              the scrollbar at the dialog edge instead of inside the padding. */}
          <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">
            <div className="space-y-1.5">
              <label
                htmlFor="card-title-input"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.titleLabel")}
              </label>
              <Textarea
                id="card-title-input"
                autoFocus
                value={card.title}
                onChange={(e) => updateCard(card.id, { title: e.target.value })}
                onFocus={(e) => e.target.select()}
                rows={3}
                className="resize-none break-words"
                placeholder={t("card.titlePlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="card-description-input"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.descriptionLabel")}
              </label>
              {/* WYSIWYG Markdown (MDXEditor) — formatting lives in the
                  editor toolbar; no separate preview toggle needed. */}
              <DescriptionEditor
                key={card.id}
                value={card.description ?? ""}
                onChange={(description) =>
                  updateCard(card.id, { description })
                }
                placeholder={t("card.descriptionPlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("card.labelLabel")}
              </span>
              <LabelPicker
                labels={board.labels}
                selected={card.labelIds}
                onToggle={(labelId) => toggleCardLabel(card.id, labelId)}
                onCreate={handleCreateLabel}
                onRename={renameLabel}
                onRecolor={setLabelColor}
                onDelete={deleteLabel}
              />
            </div>

            <CardDueDate cardId={card.id} dueDate={card.dueDate} />

            <CardCoverPicker cardId={card.id} cover={card.cover} />

            <CardChecklists cardId={card.id} checklists={card.checklists ?? []} />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("card.columnLabel")}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    {currentColumn?.title ?? "—"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>{t("card.moveTo")}</DropdownMenuLabel>
                  {board.columns.map((column) => (
                    <DropdownMenuItem
                      key={column.id}
                      disabled={column.id === currentColumn?.id}
                      onClick={() => handleMove(column.id)}
                    >
                      {column.id === currentColumn?.id ? "✓ " : ""}
                      {column.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("card.created", { date: formatDate(card.createdAt, lang) })}
              {card.updatedAt > card.createdAt
                ? ` · ${t("card.updated", { date: formatDate(card.updatedAt, lang) })}`
                : ""}
            </div>
          </div>

          <DialogFooter className="mt-2 shrink-0">
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t("card.delete")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("card.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("card.deleteTitle")}
        description={t("card.deleteDescription", { title: card.title })}
        confirmLabel={t("card.deleteConfirm")}
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
