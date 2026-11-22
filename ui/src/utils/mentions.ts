import type { BoardMemberDto } from "@janosik/shared";

/** How many roster rows the mention picker renders at once. */
export const MENTION_PICKER_LIMIT = 8;

/**
 * Only a word boundary opens the picker: an email (`alice@example.com`), a
 * handle-like `a.b+tag@` or a second `@` stays literal text.
 */
export function canOpenMentionAt(previous: string | null): boolean {
  if (previous === null) return true;
  return !/[\p{L}\p{N}_@.+-]/u.test(previous);
}

/**
 * `@` opens the picker on a plain layout, AltGr (`Ctrl+Alt+@`) and macOS
 * Option; Ctrl/Meta shortcuts and IME composition do not. AltGr `@` must not
 * be swallowed as a browser shortcut.
 */
export function isMentionTrigger(event: {
  key: string;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.key !== "@" || event.isComposing) return false;
  if (event.metaKey) return false;
  if (event.ctrlKey && !event.altKey) return false;
  return true;
}

/** Smallest usable picker width, matching the phone composer. */
const MENTION_PICKER_MIN_WIDTH = 288;
const MENTION_PICKER_MAX_WIDTH = 384;
const MENTION_PICKER_MARGIN = 8;

export interface MentionAnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface MentionPickerPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/**
 * TASK-177.12 — the picker is portalled so the dialog's scroll container
 * cannot clip it. Pick the side with more room when a full-height list does
 * not fit below the anchor, and clamp it inside the viewport at 390 px.
 */
export function mentionPickerPlacement(
  anchor: MentionAnchorRect,
  viewport: { width: number; height: number },
  desiredHeight = 320,
): MentionPickerPlacement {
  const width = Math.max(
    1,
    Math.min(
      MENTION_PICKER_MAX_WIDTH,
      viewport.width - MENTION_PICKER_MARGIN * 2,
      Math.max(MENTION_PICKER_MIN_WIDTH, anchor.width),
    ),
  );
  const left = Math.min(
    Math.max(MENTION_PICKER_MARGIN, anchor.left),
    Math.max(
      MENTION_PICKER_MARGIN,
      viewport.width - width - MENTION_PICKER_MARGIN,
    ),
  );
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - MENTION_PICKER_MARGIN,
  );
  const above = Math.max(0, anchor.top - MENTION_PICKER_MARGIN);
  const openAbove = below < desiredHeight && above > below;
  const maxHeight = Math.max(
    1,
    Math.min(desiredHeight, openAbove ? above : below),
  );
  return openAbove
    ? {
        left,
        width,
        maxHeight,
        bottom: Math.max(0, viewport.height - anchor.top + 4),
      }
    : { left, width, maxHeight, top: anchor.bottom + 4 };
}

/** Human label for one picker row (display name, else email local part). */
export function mentionMemberLabel(member: BoardMemberDto): string {
  const name = member.displayName?.trim();
  if (name) return name;
  return member.email.split("@")[0] || member.email;
}

/**
 * Case-insensitive name/email filter for the mention picker. The roster is
 * already the board's accepted, unexpired member directory; this helper only
 * narrows it and never invents a candidate from free text.
 */
export function filterMentionMembers(
  members: readonly BoardMemberDto[],
  query: string,
  limit = MENTION_PICKER_LIMIT,
): BoardMemberDto[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches =
    needle === ""
      ? [...members]
      : members.filter((member) =>
          `${member.displayName ?? ""} ${member.email}`
            .toLocaleLowerCase()
            .includes(needle),
        );
  return matches.slice(0, limit);
}

/** The secondary line always carries the full address for disambiguation. */
export function mentionMemberHint(member: BoardMemberDto): string {
  return member.email;
}
