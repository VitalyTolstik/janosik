import { useEffect, useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { adminApi } from "./admin-client";
import { adminCardsHref } from "./admin-navigation";
import { useAdminT } from "./admin-i18n";
import { SearchSkeleton } from "./skeletons";
import { Badge } from "./ui";
import {
  ADMIN_HUBS,
  ADMIN_NAV_GROUPS,
  adminDestination,
  hubTabHref,
} from "./layout/admin-nav";

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

export function rememberRecentPath(pathname: string, search = ""): void {
  const destination = adminDestination(pathname, search);
  if (!destination) return;
  const path = destination.tab
    ? pathname + `?tab=${encodeURIComponent(destination.tab.key)}`
    : pathname;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const previous: string[] = raw === null ? [] : JSON.parse(raw);
    const next = [path, ...previous.filter((entry) => entry !== path)].slice(
      0,
      5,
    );
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

/** Pure result mapping; exported for the exact-target tests. */
export function buildSearchLines(
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
      secondary: comment.cardTitle
        ? `${comment.cardTitle} · ${comment.authorEmail}`
        : comment.authorEmail,
      href: `${cardHref(comment.cardId)}?comment=${encodeURIComponent(comment.id)}`,
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
      href: `${cardHref(file.cardId)}?attachment=${encodeURIComponent(file.id)}`,
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
      href: adminCardsHref({ labelId: label.id }),
      badge: label.deletedAt !== null ? "deleted" : null,
    });
  }
  return lines;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenShortcuts?: () => void;
  onToggleTheme?: () => void;
  onToggleDensity?: () => void;
}

export function GlobalSearchDialog({
  open,
  ...props
}: GlobalSearchDialogProps) {
  const t = useAdminT();
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="max-h-[86vh] max-w-[620px] gap-0 overflow-hidden p-0 max-sm:h-screen max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pl-[env(safe-area-inset-left)] max-sm:pr-[env(safe-area-inset-right)] max-sm:pt-[env(safe-area-inset-top)]"
        data-testid="admin-command-palette"
      >
        <DialogTitle className="sr-only">{t("admin.search.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("admin.palette.hint")}
        </DialogDescription>
        {open ? <GlobalSearchPanel {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function GlobalSearchPanel({
  onOpenChange,
  onOpenShortcuts,
  onToggleTheme,
  onToggleDensity,
}: Omit<GlobalSearchDialogProps, "open">) {
  const t = useAdminT();
  const navigate = useNavigate();
  const [{ query, generation }, setSearch] = useState({
    query: "",
    generation: 0,
  });
  const [response, setResponse] = useState<{
    generation: number;
    results: AdminGlobalSearchDto | null;
  } | null>(null);
  const [recent] = useState(readRecentPaths);
  const [cursor, setActive] = useState(0);
  const input = query.trim();
  const current = response?.generation === generation ? response : null;
  const results = current?.results;
  const loading = input !== "" && current === null;
  const searchError = current !== null && current.results === null;

  const groupLabels: Record<string, string> = {
    users: t("admin.search.group.users"),
    boards: t("admin.search.group.boards"),
    cards: t("admin.search.group.cards"),
    comments: t("admin.search.group.comments"),
    attachments: t("admin.search.group.attachments"),
    labels: t("admin.search.group.labels"),
  };

  useEffect(() => {
    if (input === "") return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      void adminApi.globalSearch(input, signal).then(
        (results) => {
          if (signal.aborted) return;
          setResponse({ generation, results });
          setActive(0);
        },
        () => {
          if (!signal.aborted) setResponse({ generation, results: null });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, generation]);

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  const entityLines = useMemo(
    () => (results ? buildSearchLines(results, groupLabels) : []),
    // groupLabels is derived from the language; rebuilding on every render is
    // cheap and avoids a stale closure when the language flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, t],
  );

  const normalized = input.toLowerCase();
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
      run: () => go(routes.home),
    },
  ].filter((action) => matches(action.label));

  const recentLines: CommandLine[] = recent
    .map((pathname): CommandLine | null => {
      const [path, search] = pathname.split("?", 2);
      const destination = adminDestination(path, search);
      if (destination === null) return null;
      const { hub, tab, detail } = destination;
      return {
        key: `recent-${pathname}`,
        icon: detail?.icon ?? tab?.icon ?? hub.icon,
        label: t(detail?.labelKey ?? tab?.labelKey ?? hub.labelKey),
        hint: pathname,
        testId: `admin-command-recent-${pathname.replace(/[^a-z0-9]+/gi, "-")}`,
        run: () => go(tab && !detail ? hubTabHref(hub.key, tab.key) : pathname),
      };
    })
    .filter((line): line is CommandLine => line !== null)
    .slice(0, 5);

  const commandLines = [...navigateLines, ...actions];
  const visibleRecent = query.trim() === "" ? recentLines : [];
  const allItems = [...commandLines, ...visibleRecent, ...entityLines];
  const active = Math.min(cursor, allItems.length - 1);
  const activeItem = allItems[active];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || allItems.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(active + 1, allItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, active - 1));
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
    <>
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
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
          aria-label={t("admin.search.title")}
          aria-expanded
          aria-controls="admin-command-list"
          aria-activedescendant={
            activeItem === undefined
              ? undefined
              : `admin-command-${activeItem.key}`
          }
          aria-autocomplete="list"
          onChange={(event) => {
            const value = event.target.value;
            setSearch((previous) => ({
              query: value,
              generation:
                value.trim() === previous.query.trim()
                  ? previous.generation
                  : previous.generation + 1,
            }));
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border border-border bg-hover/50 px-1 font-mono text-[10px] text-muted-foreground">
          esc
        </kbd>
      </div>

      <div className="max-h-[64vh] overflow-y-auto">
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
              onClick={() =>
                setSearch(({ query, generation }) => ({
                  query,
                  generation: generation + 1,
                }))
              }
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

        <div
          id="admin-command-list"
          role="listbox"
          aria-label={t("admin.search.title")}
          aria-busy={loading}
        >
          {commandLines.length > 0 ? (
            <div role="group" aria-label={t("admin.palette.navigate")}>
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
            </div>
          ) : null}

          {visibleRecent.length > 0 ? (
            <div role="group" aria-label={t("admin.palette.recent")}>
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
            </div>
          ) : null}

          {entityLines.map((line) => {
            const index = allItems.indexOf(line);
            return (
              <button
                key={line.key}
                type="button"
                role="option"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
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
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>{t("admin.palette.hint")}</span>
        <span className="font-mono">⌘K</span>
      </div>
    </>
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
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
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
