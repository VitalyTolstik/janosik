import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  KanbanSquare,
  MessageSquare,
  Paperclip,
  Search,
  Users,
} from "lucide-react";
import type { AdminGlobalSearchDto } from "@janosik/shared";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { Badge } from "./ui";

/**
 * Panel omnibox (TASK-48): one query against every core entity, grouped
 * results, Enter/click navigates straight into the detail pages. Cmd/Ctrl+K
 * opens it from anywhere in the panel.
 */

const cardHref = (id: string) => `/admin/cards/${id}`;
const boardHref = (id: string) => `/admin/boards/${id}`;
const userHref = (id: string) => `/admin/users/${id}`;

interface ResultLine {
  key: string;
  icon: typeof Users;
  group: string;
  label: string;
  secondary?: string;
  href: string;
  badge?: string | null;
}

function buildLines(
  results: AdminGlobalSearchDto,
  groupLabels: Record<string, string>,
): ResultLine[] {
  const lines: ResultLine[] = [];
  for (const user of results.users) {
    lines.push({
      key: `user-${user.id}`,
      icon: Users,
      group: groupLabels.users,
      label: user.displayName ?? user.email,
      secondary: user.email,
      href: userHref(user.id),
      badge: user.disabledAt !== null ? "disabled" : null,
    });
  }
  for (const board of results.boards) {
    lines.push({
      key: `board-${board.id}`,
      icon: KanbanSquare,
      group: groupLabels.boards,
      label: board.title,
      secondary: board.ownerEmail ?? undefined,
      href: boardHref(board.id),
      badge:
        board.deletedAt !== null
          ? "deleted"
          : board.archivedAt !== null
            ? "archived"
            : null,
    });
  }
  for (const card of results.cards) {
    lines.push({
      key: `card-${card.id}`,
      icon: KanbanSquare,
      group: groupLabels.cards,
      label: card.title,
      secondary: card.boardTitle,
      href: cardHref(card.id),
      badge:
        card.deletedAt !== null
          ? "deleted"
          : card.archivedAt !== null
            ? "archived"
            : null,
    });
  }
  for (const comment of results.comments) {
    lines.push({
      key: `comment-${comment.id}`,
      icon: MessageSquare,
      group: groupLabels.comments,
      label:
        comment.text.length > 90
          ? `${comment.text.slice(0, 90)}…`
          : comment.text,
      secondary: comment.authorEmail,
      href: cardHref(comment.cardId),
      badge: comment.deletedAt !== null ? "deleted" : null,
    });
  }
  for (const file of results.attachments) {
    lines.push({
      key: `attachment-${file.id}`,
      icon: Paperclip,
      group: groupLabels.attachments,
      label: file.fileName,
      secondary: file.cardTitle,
      href: cardHref(file.cardId),
      badge: file.deletedAt !== null ? "deleted" : null,
    });
  }
  for (const label of results.labels) {
    lines.push({
      key: `label-${label.id}`,
      icon: Bookmark,
      group: groupLabels.labels,
      label: label.name,
      secondary: label.boardTitle,
      href: boardHref(label.boardId),
      badge: label.deletedAt !== null ? "deleted" : null,
    });
  }
  return lines;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useAdminT();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminGlobalSearchDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q === "") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      adminApi
        .globalSearch(q)
        .then((page) => {
          setResults(page);
          setActive(0);
        })
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const groupLabels: Record<string, string> = {
    users: t("admin.search.group.users"),
    boards: t("admin.search.group.boards"),
    cards: t("admin.search.group.cards"),
    comments: t("admin.search.group.comments"),
    attachments: t("admin.search.group.attachments"),
    labels: t("admin.search.group.labels"),
  };

  const lines = results ? buildLines(results, groupLabels) : [];

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{t("admin.search.title")}</DialogTitle>
        <label className="flex h-11 items-center gap-2 px-3">
          <Search
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            data-testid="admin-global-search-input"
            placeholder={t("admin.search.placeholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim() === "") {
                setResults(null);
                setLoading(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, lines.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && lines[active]) {
                go(lines[active].href);
              }
            }}
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading ? (
            <span className="text-[11px] text-muted-foreground">…</span>
          ) : null}
        </label>
        <div className="max-h-80 overflow-y-auto border-t border-border">
          {query.trim() !== "" && lines.length === 0 && !loading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("admin.search.empty")}
            </p>
          ) : null}
          {lines.map((line, index) => (
            <button
              key={line.key}
              type="button"
              data-testid={`admin-search-result-${index}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(line.href)}
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0",
                index === active ? "bg-primary/10" : "hover:bg-hover/60",
              )}
            >
              <line.icon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {line.label}
                {line.secondary ? (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {line.secondary}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {line.group}
              </span>
              {line.badge ? (
                <Badge
                  variant={line.badge === "deleted" ? "danger" : "warning"}
                >
                  {line.badge}
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
