import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardMemberDto } from "@janosik/shared";

import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  filterMentionMembers,
  mentionMemberHint,
  mentionMemberLabel,
} from "@/utils/mentions";

interface MentionPickerProps {
  /** The board's accepted, unexpired roster (never a free-text guess). */
  members: readonly BoardMemberDto[];
  /** Insert the chosen member's explicit `https://janosik.invalid/mention/<userId>` token. */
  onSelect: (member: BoardMemberDto) => void;
  /**
   * Dismiss without a selection. A string means "restore the literal
   * `@query` the user typed"; `undefined` means the query is discarded
   * (outside click / send).
   */
  onCancel: (query: string | undefined) => void;
}

/**
 * TASK-177.12 — the `@` autocomplete for comments.
 *
 * The editor keeps focus: a window-level capture listener owns the keys while
 * the list is open, so typing filters the roster without leaving the caret,
 * `↑/↓` move, `Enter`/`Tab` insert, `Escape` restores the literal `@query`.
 * Clicking a row is the pointer/touch equivalent; every row is at least 44 px
 * tall on touch widths.
 */
export function MentionPicker({
  members,
  onSelect,
  onCancel,
}: MentionPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const candidates = useMemo(
    () => filterMentionMembers(members, query),
    [members, query],
  );
  // The filtered list can shrink under the cursor; clamp at read time instead
  // of writing state from an effect.
  const activeIndex =
    candidates.length === 0 ? 0 : Math.min(active, candidates.length - 1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel(query);
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (candidates.length === 0) return;
        const delta = key === "ArrowDown" ? 1 : -1;
        setActive(
          (activeIndex + delta + candidates.length) % candidates.length,
        );
        return;
      }
      if (
        key === "Home" ||
        key === "End" ||
        key === "PageUp" ||
        key === "PageDown"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (candidates.length === 0) return;
        setActive(
          key === "Home" || key === "PageUp" ? 0 : candidates.length - 1,
        );
        return;
      }
      if (key === "Enter" || key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const member = candidates[activeIndex];
        if (member !== undefined) onSelect(member);
        else onCancel(query);
        return;
      }
      if (key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        if (query.length === 0) {
          onCancel("");
          return;
        }
        setQuery((current) => current.slice(0, -1));
        return;
      }
      if (key.length === 1) {
        // Printable characters belong to the picker, not the editor: the
        // visible draft stays at the `@` until a member is chosen.
        event.preventDefault();
        event.stopPropagation();
        setQuery((current) => `${current}${key}`);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeIndex, candidates, onCancel, onSelect, query]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && rootRef.current?.contains(target) === true) return;
      onCancel(undefined);
    };
    // Capture: a click on Send/another control dismisses first, then the
    // control receives its normal click.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      data-testid="mention-picker"
      className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-xl"
    >
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-xs font-medium text-foreground">
          {t("comment.mention.label")}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("comment.mention.hint")}
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {candidates.length === 0
          ? t("comment.mention.empty")
          : t("comment.mention.matches", { count: candidates.length })}
      </p>
      {candidates.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {t("comment.mention.empty")}
        </p>
      ) : (
        <ul
          role="listbox"
          aria-label={t("comment.mention.listbox")}
          className="max-h-64 overflow-y-auto py-1"
        >
          {candidates.map((member, index) => {
            const label = mentionMemberLabel(member);
            const selected = index === activeIndex;
            return (
              <li
                key={member.userId}
                role="option"
                aria-selected={selected}
                data-testid={`mention-option-${member.userId}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(member)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/90 hover:bg-hover",
                )}
              >
                <UserAvatar
                  userId={member.userId}
                  displayName={member.displayName}
                  email={member.email}
                  color={member.avatarColor}
                  avatarPath={member.avatarPath}
                  size="xs"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {mentionMemberHint(member)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
