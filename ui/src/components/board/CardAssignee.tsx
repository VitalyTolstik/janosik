import { CircleUserRound, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { useBoardMembersList } from "@/store/board-live";
import { splitHighlight } from "@/utils/filter";
import { userLabel } from "@/utils/avatar";
import type { BoardMemberDto } from "@janosik/shared";

/** Cap the visible roster (TASK-46's suggestion budget — scrollable after). */
const SUGGESTION_LIMIT = 8;

/**
 * Jira-style assignee row in the card dialog (TASK-49): a popover with a
 * live search over the board's accepted members (avatars included) and an
 * "Unassigned" escape hatch. Applying is immediate — like the label and
 * priority pickers; the server re-checks membership on apply. VIEWER mode
 * renders plain text instead of the popover.
 */
export function CardAssignee({
  boardId,
  cardId,
  assigneeId,
  readOnly = false,
}: {
  /** The board whose roster the search runs over. */
  boardId: string;
  cardId: string;
  /** Current assignee's user id; absent = unassigned. */
  assigneeId?: string;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const { setCardAssign } = useBoardActions();
  const [open, setOpen] = useState(false);
  const members = useBoardMembersList(boardId);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = members.find((member) => member.userId === assigneeId);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = members.filter(
      (member) =>
        q === "" ||
        (member.displayName ?? "").toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q),
    );
    const rank = (member: BoardMemberDto): number => {
      const label = userLabel(member.displayName, member.email).toLowerCase();
      return label.startsWith(q) ? 0 : 1;
    };
    return [...pool]
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          userLabel(a.displayName, a.email).localeCompare(
            userLabel(b.displayName, b.email),
          ),
      )
      .slice(0, SUGGESTION_LIMIT);
  }, [members, query]);

  // The combined option list: "Unassigned" pinned on top (Jira-style),
  // then the roster. The cursor indexes this list.
  const optionCount = suggestions.length + 1;
  const safeCursor = Math.min(cursor, optionCount - 1);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const pick = (userId: string | null) => {
    setCardAssign(cardId, userId);
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setCursor((prev) => (prev + delta + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (safeCursor === 0) {
        pick(null);
      } else {
        pick(suggestions[safeCursor - 1]?.userId ?? null);
      }
    }
  };

  const label = current
    ? userLabel(current.displayName, current.email)
    : t("card.assignee.unassigned");

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("card.assigneeLabel")}
      </span>
      {readOnly ? (
        <span
          className="flex items-center gap-1.5 text-sm text-foreground"
          data-testid="card-assignee-readout"
        >
          {current ? (
            <UserAvatar
              userId={current.userId}
              displayName={current.displayName}
              email={current.email}
              color={current.avatarColor}
              avatarPath={current.avatarPath}
              size="xs"
            />
          ) : (
            <CircleUserRound className="h-4 w-4 text-muted-foreground" />
          )}
          {label}
        </span>
      ) : (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              data-testid="card-assignee-trigger"
              className="min-w-0 font-normal"
            >
              {current ? (
                <UserAvatar
                  userId={current.userId}
                  displayName={current.displayName}
                  email={current.email}
                  color={current.avatarColor}
                  avatarPath={current.avatarPath}
                  size="xs"
                  className="shrink-0"
                />
              ) : (
                <CircleUserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{label}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-0"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("card.assignee.searchPlaceholder")}
                role="combobox"
                aria-expanded
                aria-autocomplete="list"
                aria-controls="card-assignee-options"
                data-testid="card-assignee-input"
                className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul
              id="card-assignee-options"
              role="listbox"
              className="max-h-64 overflow-y-auto p-1"
            >
              <li role="option" aria-selected={assigneeId === undefined}>
                <button
                  type="button"
                  data-testid="card-assignee-unassign"
                  aria-selected={assigneeId === undefined}
                  onMouseEnter={() => setCursor(0)}
                  onClick={() => pick(null)}
                  className={
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors " +
                    (safeCursor === 0
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60")
                  }
                >
                  <CircleUserRound className="h-4 w-4 shrink-0" />
                  {t("card.assignee.unassigned")}
                </button>
              </li>
              {suggestions.map((member, index) => {
                const optionIndex = index + 1;
                const active = optionIndex === safeCursor;
                const selected = member.userId === assigneeId;
                return (
                  <li
                    key={member.userId}
                    role="option"
                    aria-selected={selected}
                  >
                    <button
                      type="button"
                      data-testid={`card-assignee-option-${member.userId}`}
                      onMouseEnter={() => setCursor(optionIndex)}
                      onClick={() => pick(member.userId)}
                      className={
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors " +
                        (active
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60")
                      }
                    >
                      <UserAvatar
                        userId={member.userId}
                        displayName={member.displayName}
                        email={member.email}
                        color={member.avatarColor}
                        avatarPath={member.avatarPath}
                        size="xs"
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-left">
                        <HighlightedName
                          name={userLabel(member.displayName, member.email)}
                          query={query}
                        />
                        <span className="block truncate text-xs text-muted-foreground">
                          {member.email}
                        </span>
                      </span>
                      {selected ? (
                        <span
                          aria-hidden
                          className="text-xs font-semibold text-primary"
                        >
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {suggestions.length === 0 && query.trim() !== "" ? (
                <li
                  className="px-2 py-3 text-center text-xs text-muted-foreground"
                  data-testid="card-assignee-empty"
                >
                  {t("card.assignee.empty")}
                </li>
              ) : null}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query.trim()) return <span>{name}</span>;
  return (
    <span>
      {splitHighlight(name, query).map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <mark key={index} className="rounded-sm bg-primary/20">
            {segment.text}
          </mark>
        ),
      )}
    </span>
  );
}
