import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bookmark,
  HelpCircle,
  KanbanSquare,
  MessageSquare,
  Moon,
  Paperclip,
  Rows3,
  Search,
  Settings,
  Users,
} from "lucide-react";
import type { AdminGlobalSearchDto } from "@janosik/shared";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { SearchSkeleton } from "./skeletons";
import { Badge } from "./ui";
import { ADMIN_HUBS, ADMIN_NAV_GROUPS } from "./layout/admin-nav";

/**
 * Command palette (redesigned omnibox): navigation, recent pages and actions
 * live next to the six cross-entity search groups. `admin-search-result-N`
 * indices still count entity results only, so existing deep-link tests and
 * keyboard flows keep their exact contract.
 */

const cardHref = (id: string) => `/admin/cards/${id}`;
const boardHref = (id: string) => `/admin/boards/${id}`;
const userHref = (id: string) => `/admin/users/${id}`;
const RECENT_KEY = "janosik.admin.recent";

export function rememberRecentPath(pathname: string): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const previous: string[] = raw === null ? [] : JSON.parse(raw);
    const next = [
      pathname,
      ...previous.filter((entry) => entry !== pathname),
    ].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage is optional; recents are a convenience */
  }
}

function readRecentPaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

interface ResultLine {
  key: string;
  icon: typeof Users;
  group: string;
  label: string;
  secondary?: string;
  href: string;
  badge?: string | null;
}

interface CommandLine {
  key: string;
  icon: typeof Users;
  label: string;
  hint?: string;
  testId: string;
  run: () => void;
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
  onOpenShortcuts,
  onToggleTheme,
  onToggleDensity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenShortcuts?: () => void;
  onToggleTheme?: () => void;
  onToggleDensity?: () => void;
}) {
  const t = useAdminT();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminGlobalSearchDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupLabels: Record<string, string> = {
    users: t("admin.search.group.users"),
    boards: t("admin.search.group.boards"),
    cards: t("admin.search.group.cards"),
    comments: t("admin.search.group.comments"),
    attachments: t("admin.search.group.attachments"),
    labels: t("admin.search.group.labels"),
  };

  useEffect(() => {
    if (!open) return;
    setRecent(readRecentPaths());
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults(null);
      setLoading(false);
      setSearchError(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      setSearchError(false);
      adminApi
        .globalSearch(q)
        .then((page) => {
          setResults(page);
          setActive(0);
        })
        .catch(() => {
          setResults(null);
          setSearchError(true);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, retryKey]);

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  const close = () => {
    setQuery("");
    setResults(null);
    setLoading(false);
    setSearchError(false);
    setActive(0);
    onOpenChange(false);
  };

  const entityLines = useMemo(
    () => (results ? buildLines(results, groupLabels) : []),
    // groupLabels is derived from the language; rebuilding on every render is
    // cheap and avoids a stale closure when the language flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, t],
  );

  const normalized = query.trim().toLowerCase();
  const matches = (value: string) =>
    normalized === "" || value.toLowerCase().includes(normalized);

  const navigateLines: CommandLine[] = ADMIN_NAV_GROUPS.flatMap((group) =>
    group.keys
      .map((key) => ADMIN_HUBS.find((hub) => hub.key === key))
      .filter((hub): hub is NonNullable<typeof hub> => hub !== undefined)
      .filter((hub) => matches(t(hub.labelKey)))
      .map((hub) => ({
        key: `nav-${hub.key}`,
        icon: hub.icon,
        label: t(hub.labelKey),
        hint: t(group.labelKey),
        testId: `admin-command-nav-${hub.key}`,
        run: () => go(hub.to),
      })),
  );

  const actions: CommandLine[] = [
    {
      key: "action-settings",
      icon: Settings,
      label: t("admin.palette.action.settings"),
      testId: "admin-command-action-settings",
      run: () => go("/admin/settings"),
    },
    ...(onToggleDensity
      ? [
          {
            key: "action-density",
            icon: Rows3,
            label: t("admin.palette.action.density"),
            testId: "admin-command-action-density",
            run: () => {
              onToggleDensity();
              onOpenChange(false);
            },
          },
        ]
      : []),
    ...(onToggleTheme
      ? [
          {
            key: "action-theme",
            icon: Moon,
            label: t("admin.palette.action.theme"),
            testId: "admin-command-action-theme",
            run: () => {
              onToggleTheme();
              onOpenChange(false);
            },
          },
        ]
      : []),
    ...(onOpenShortcuts
      ? [
          {
            key: "action-shortcuts",
            icon: HelpCircle,
            label: t("admin.palette.action.shortcuts"),
            testId: "admin-command-action-shortcuts",
            run: onOpenShortcuts,
          },
        ]
      : []),
    {
      key: "action-boards",
      icon: ArrowRight,
      label: t("admin.palette.action.boards"),
      testId: "admin-command-action-boards",
      run: () => {
        window.location.assign(routes.home);
      },
    },
  ].filter((action) => matches(action.label));

  const recentLines: CommandLine[] = recent
    .map((pathname): CommandLine | null => {
      const hub = ADMIN_HUBS.find(
        (entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`),
      );
      if (hub === undefined) return null;
      return {
        key: `recent-${pathname}`,
        icon: hub.icon,
        label: t(hub.labelKey),
        hint: pathname,
        testId: `admin-command-recent-${pathname.replace(/[^a-z0-9]+/gi, "-")}`,
        run: () => go(pathname),
      };
    })
    .filter((line): line is CommandLine => line !== null)
    .slice(0, 5);

  const commandLines = [...navigateLines, ...actions];
  const visibleRecent = query.trim() === "" ? recentLines : [];
  const allItems = [...commandLines, ...visibleRecent, ...entityLines];
  const activeItem = allItems[active];

  useEffect(() => {
    if (active >= allItems.length) setActive(Math.max(0, allItems.length - 1));
  }, [active, allItems.length]);

  useEffect(() => {
    if (allItems.length === 0) setActive(0);
  }, [allItems.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, allItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      if (activeItem === undefined) return;
      event.preventDefault();
      if ("href" in activeItem && activeItem.href !== undefined) {
        go(activeItem.href);
      } else {
        (activeItem as CommandLine).run();
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent
        className="max-h-[86vh] max-w-[620px] gap-0 overflow-hidden p-0 max-sm:h-screen max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
        data-testid="admin-command-palette"
      >
        <DialogTitle className="sr-only">{t("admin.search.title")}</DialogTitle>
        <label className="flex h-11 items-center gap-2 border-b border-border px-3">
          <Search
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            maxLength={200}
            data-testid="admin-global-search-input"
            placeholder={t("admin.search.placeholder")}
            role="combobox"
            aria-expanded
            aria-controls="admin-command-list"
            aria-activedescendant={
              activeItem === undefined
                ? undefined
                : `admin-command-${activeItem.key}`
            }
            aria-autocomplete="list"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border bg-hover/50 px-1 font-mono text-[10px] text-muted-foreground">
            esc
          </kbd>
        </label>

        <div
          id="admin-command-list"
          role="listbox"
          aria-busy={loading}
          className="max-h-[64vh] overflow-y-auto"
        >
          {loading && entityLines.length === 0 && query.trim() !== "" ? (
            <SearchSkeleton rows={4} />
          ) : null}

          {searchError ? (
            <div
              className="space-y-2 px-3 py-6 text-center"
              data-testid="admin-search-error"
            >
              <p className="text-xs text-danger">{t("admin.palette.error")}</p>
              <button
                type="button"
                className="text-[11px] text-primary underline-offset-2 hover:underline"
                onClick={() => setRetryKey((key) => key + 1)}
              >
                {t("admin.palette.retry")}
              </button>
            </div>
          ) : null}

          {query.trim() !== "" &&
          !loading &&
          !searchError &&
          allItems.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("admin.search.empty")}
            </p>
          ) : null}

          {query.trim() === "" ? (
            <p className="border-b border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
              {t("admin.palette.emptyQuery")}
            </p>
          ) : null}

          {commandLines.length > 0 ? (
            <section aria-label={t("admin.palette.navigate")}>
              <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {normalized === ""
                  ? t("admin.palette.navigate")
                  : t("admin.palette.actions")}
              </p>
              {commandLines.map((line) => {
                const index = allItems.indexOf(line);
                return (
                  <CommandRow
                    key={line.key}
                    line={line}
                    index={index}
                    active={index === active}
                    onHover={() => setActive(index)}
                  />
                );
              })}
            </section>
          ) : null}

          {visibleRecent.length > 0 ? (
            <section aria-label={t("admin.palette.recent")}>
              <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t("admin.palette.recent")}
              </p>
              {visibleRecent.map((line) => {
                const index = allItems.indexOf(line);
                return (
                  <CommandRow
                    key={line.key}
                    line={line}
                    index={index}
                    active={index === active}
                    onHover={() => setActive(index)}
                  />
                );
              })}
            </section>
          ) : null}

          {entityLines.map((line) => {
            const index = allItems.indexOf(line);
            return (
              <button
                key={line.key}
                type="button"
                role="option"
                id={`admin-command-${line.key}`}
                aria-selected={index === active}
                data-testid={`admin-search-result-${entityLines.indexOf(line)}`}
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
                    {line.badge === "deleted"
                      ? t("admin.status.deleted")
                      : line.badge === "archived"
                        ? t("admin.status.archived")
                        : t("admin.status.disabled")}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>{t("admin.palette.hint")}</span>
          <span className="font-mono">⌘K</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommandRow({
  line,
  index,
  active,
  onHover,
}: {
  line: CommandLine;
  index: number;
  active: boolean;
  onHover: () => void;
}) {
  const Icon = line.icon;
  return (
    <button
      type="button"
      role="option"
      id={`admin-command-${line.key}`}
      aria-selected={active ? "true" : "false"}
      data-testid={line.testId}
      data-index={index}
      onMouseEnter={onHover}
      onClick={line.run}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-hover/60",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {line.label}
      </span>
      {line.hint ? (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {line.hint}
        </span>
      ) : null}
    </button>
  );
}
