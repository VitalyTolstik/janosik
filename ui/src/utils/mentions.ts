import type { BoardMemberDto } from "@janosik/shared";

/** How many roster rows the mention picker renders at once. */
export const MENTION_PICKER_LIMIT = 8;

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
