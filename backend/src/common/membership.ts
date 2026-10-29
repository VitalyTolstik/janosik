import type { Prisma } from "@prisma/client";

/**
 * The single definition of "still a member" (TASK-147, findings B4/B5).
 *
 * A `BoardMember` row is active when its invitation was accepted *and* its
 * optional time budget (a VIEWER's `expiresAt`) has not elapsed. Approval
 * alone is not enough: an expired VIEWER could still read the board from a
 * listing and keep receiving its digest, because only `MembershipGuard` knew
 * about expiry. Lists, listings, digests and reminders must all agree, so the
 * predicate lives here once instead of being re-spelled (and forgotten) in
 * each query.
 *
 * `now` is a parameter, not `new Date()` at module load, so a long batch
 * (a digest over many boards) evaluates every row against one instant.
 */
export function activeMembershipWhere(
  now: Date = new Date(),
): Prisma.BoardMemberWhereInput {
  return {
    acceptedAt: { not: null },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** The in-memory twin of {@link activeMembershipWhere}, for filtered rows. */
export function isActiveMembership(
  member: { acceptedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (member.acceptedAt === null) return false;
  return (
    member.expiresAt === null || member.expiresAt.getTime() > now.getTime()
  );
}
