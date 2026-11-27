import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { BoardMemberDto } from "@janosik/shared";

import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  filterMentionMembers,
  mentionMemberHint,
  mentionMemberLabel,
  mentionPickerPlacement,
  MENTION_PICKER_LIMIT,
  type MentionPickerPlacement,
} from "@/utils/mentions";

interface MentionPickerProps {
  /** The board's accepted, unexpired roster (never a free-text guess). */
  members: readonly BoardMemberDto[];
  /** The composer box the portalled list anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Shared with the editor's `aria-controls`/`aria-activedescendant`. */
  idPrefix: string;
  /** Insert the chosen member's explicit mention token. */
  onSelect: (member: BoardMemberDto) => void;
  /**
   * Dismiss without a selection. A string restores `@query`; `undefined`
   * discards it because the click was an explicit Send.
   */
  onCancel: (query: string | undefined) => void;
  /** The active option id for the editor's `aria-activedescendant`. */
  onActiveChange: (optionId: string | null) => void;
}

/**
 * TASK-177.12 — the `@` autocomplete for comments.
 *
 * The editor keeps focus: a window-level capture listener owns the keys while
 * the list is open, so typing filters the roster without leaving the caret,
 * `↑/↓` move, `Enter`/`Tab` insert, `Escape` restores the literal `@query`.
 * The list is portalled to `document.body` and flips above the composer when
 * the dialog's scroll container leaves no room below; every row is at least
 * 44 px tall on touch widths.
 */
export function MentionPicker({
  members,
  anchorRef,
  idPrefix,
  onSelect,
  onCancel,
  onActiveChange,
}: MentionPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<MentionPickerPlacement | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  // Filter the whole roster for the honest count, but cap the rendered rows.
  const matches = useMemo(
    () => filterMentionMembers(members, query, Number.MAX_SAFE_INTEGER),
    [members, query],
  );
  const candidates = matches.slice(0, MENTION_PICKER_LIMIT);
  const activeIndex =
    candidates.length === 0 ? 0 : Math.min(active, candidates.length - 1);
  const activeMember = candidates[activeIndex];
  const listboxId = `${idPrefix}-listbox`;
  const activeOptionId =
    activeMember === undefined
      ? null
      : `${idPrefix}-option-${activeMember.userId}`;

  useEffect(() => {
    onActiveChange(activeOptionId);
  }, [activeOptionId, onActiveChange]);

  useEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (anchor === null) return;
      const rect = anchor.getBoundingClientRect();
      setPlacement(
        mentionPickerPlacement(rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    update();
    window.addEventListener("resize", update);
    // Capture catches the dialog's own scroll container, not only window.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    if (activeOptionId === null) return;
    rowRefs.current.get(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

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
      if (key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        if (candidates.length === 0) return;
        const direction = event.shiftKey ? -1 : 1;
        setActive(
          (activeIndex + direction + candidates.length) % candidates.length,
        );
        return;
      }
      if (key === "Enter") {
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
        setActive(0);
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
        setActive(0);
        setQuery((current) => `${current}${key}`);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeIndex, candidates, onCancel, onSelect, query]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && rootRef.current?.contains(target) === true) {
        // The picker is portalled outside the card dialog. Radix's
        // DismissableLayer listens on the document; swallow the pointerdown
        // on the window capture path so choosing a row cannot close the
        // dialog before the click reaches the option.
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      // Send is an explicit submit: discard the query instead of injecting
      // `@query` into the draft. Any other dismissal restores what was typed.
      const element = target instanceof Element ? target : null;
      const submitted =
        element?.closest(
          '[data-testid="comment-send"], [data-testid="comment-edit-save"]',
        ) !== null;
      onCancel(submitted ? undefined : query);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onCancel, query]);

  if (placement === null) return null;

  return createPortal(
    <div
      ref={rootRef}
      data-testid="mention-picker"
      role="region"
      aria-label={t("comment.mention.label")}
      style={{
        position: "fixed",
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        ...(placement.top === undefined ? {} : { top: placement.top }),
        ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
      }}
      className="pointer-events-auto z-[60] flex flex-col overflow-hidden rounded-lg border bg-popover shadow-xl"
    >
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-ui-label font-medium text-foreground">
          {t("comment.mention.label")}
        </p>
        <p className="mt-0.5 text-ui-meta text-muted-foreground">
          {t("comment.mention.hint")}
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {matches.length === 0
          ? t("comment.mention.empty")
          : `${t("comment.mention.matches", { count: matches.length })}. ${
              activeMember === undefined
                ? ""
                : t("comment.mention.active", {
                    name: mentionMemberLabel(activeMember),
                  })
            }`}
      </p>
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-ui-body text-muted-foreground">
          {t("comment.mention.empty")}
        </p>
      ) : (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("comment.mention.listbox")}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {candidates.map((member, index) => {
            const label = mentionMemberLabel(member);
            const selected = index === activeIndex;
            const optionId = `${idPrefix}-option-${member.userId}`;
            return (
              <li
                key={member.userId}
                id={optionId}
                ref={(node) => {
                  if (node === null) rowRefs.current.delete(optionId);
                  else rowRefs.current.set(optionId, node);
                }}
                role="option"
                aria-selected={selected}
                data-testid={`mention-option-${member.userId}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(member)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-ui-body",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/90 hover:bg-hover",
                )}
              >
                <span aria-hidden="true" className="shrink-0">
                  <UserAvatar
                    userId={member.userId}
                    displayName={member.displayName}
                    email={member.email}
                    color={member.avatarColor}
                    avatarPath={member.avatarPath}
                    size="xs"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label}</span>
                  <span className="block truncate text-ui-meta text-muted-foreground">
                    {mentionMemberHint(member)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
