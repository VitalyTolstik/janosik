import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArchiveRestore, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import type { Card } from "@/types/kanban";

interface ArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Board card archive (TASK-18.1): search, restore to a picked column and
 * delete-forever for the active board's archived cards. Opened from the
 * data menu — a full dialog keeps the dropdown light even with hundreds
 * of archived cards.
 */
export function ArchiveDialog({ open, onOpenChange }: ArchiveDialogProps) {
  const { board, unarchiveCard, deleteCard } = useBoard();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // A fresh open starts with a clean search and no pending confirmation.
  useEffect(() => {
    if (open) {
      setQuery("");
      setConfirmDeleteId(null);
    }
  }, [open]);

  if (!board) return null;

  const archived = Object.values(board.cards)
    .filter((card): card is Card => card.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? archived.filter((card) => card.title.toLowerCase().includes(needle))
    : archived;

  const openCard = (cardId: string) => {
    onOpenChange(false);
    navigate(`${routes.board(board.id)}?card=${cardId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("archive.title")}</DialogTitle>
          <DialogDescription>
            {t("archive.subtitle", { board: board.title, count: archived.length })}
          </DialogDescription>
        </DialogHeader>

        {archived.length > 0 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("archive.searchPlaceholder")}
              data-testid="archive-search"
              className="h-8 pl-8 text-sm"
            />
          </div>
        ) : null}

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6" data-testid="archive-list">
          {archived.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("archive.empty")}
            </p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("archive.noMatches")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((card) => {
                const confirming = confirmDeleteId === card.id;
                return (
                  <li
                    key={card.id}
                    data-testid="archive-row"
                    className="flex items-start gap-1 rounded-lg border border-border/60 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        data-testid="archive-row-title"
                        onClick={() => openCard(card.id)}
                        className="block w-full truncate text-left text-sm text-foreground/90 transition-colors hover:text-primary"
                        title={card.title}
                      >
                        {card.title}
                      </button>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {t("archive.created", {
                          date: formatDate(card.createdAt, lang, hour12),
                        })}
                        {" · "}
                        {t("archive.archivedAt", {
                          date: formatDate(card.archivedAt ?? 0, lang, hour12),
                        })}
                      </div>
                    </div>
                    {confirming ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <span className="text-xs text-muted-foreground">
                          {t("archive.deleteConfirm")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-success hover:text-success"
                          aria-label={t("archive.deleteConfirmYes")}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            deleteCard(card.id);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          aria-label={t("archive.deleteConfirmCancel")}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              aria-label={t("card.unarchive")}
                              data-testid="archive-restore"
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuLabel>
                              {t("card.restoreTo")}
                            </DropdownMenuLabel>
                            {board.columns.map((column) => (
                              <DropdownMenuItem
                                key={column.id}
                                onSelect={() => unarchiveCard(card.id, column.id)}
                              >
                                {column.title}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          aria-label={t("archive.delete")}
                          data-testid="archive-delete"
                          onClick={() => setConfirmDeleteId(card.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
