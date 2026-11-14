import type { ApprovalImpactDto } from "@janosik/shared";

import type { PrismaService } from "@/common/prisma/prisma.service";

/** The fields an impact read needs; a full `ApprovalRequest` satisfies it. */
export interface ApprovalImpactRow {
  id: string;
  actionType: string;
  cardId: string | null;
}

type EligibleRow = ApprovalImpactRow & { cardId: string };

function eligible(row: ApprovalImpactRow): row is EligibleRow {
  return row.actionType === "DELETE_CARD" && row.cardId !== null;
}

function toMap(
  rows: ReadonlyArray<{ cardId: string; _count: { _all: number } }>,
): Map<string, number> {
  return new Map(rows.map((row) => [row.cardId, row._count._all]));
}

/**
 * Count the live comments and non-inline attachments of every distinct
 * `DELETE_CARD` card in one page. Two grouped reads, never one per row.
 *
 * These are current rows, not a snapshot taken when the approval was created:
 * a comment deleted in the meantime is already gone from the count. The
 * spec (§179.3) forbids fabricated impact numbers; the UI says "current"
 * only where it can count, and omits the count when it cannot.
 */
export async function approvalImpacts(
  prisma: PrismaService,
  rows: readonly ApprovalImpactRow[],
): Promise<Map<string, ApprovalImpactDto>> {
  const cardIds = [...new Set(rows.filter(eligible).map((row) => row.cardId))];
  if (cardIds.length === 0) return new Map();

  const [comments, attachments] = await Promise.all([
    prisma.comment.groupBy({
      by: ["cardId"],
      where: { cardId: { in: cardIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.attachment.groupBy({
      by: ["cardId"],
      where: { cardId: { in: cardIds }, deletedAt: null, isInline: false },
      _count: { _all: true },
    }),
  ]);
  const commentCounts = toMap(comments);
  const attachmentCounts = toMap(attachments);

  const result = new Map<string, ApprovalImpactDto>();
  for (const row of rows) {
    if (!eligible(row)) continue;
    result.set(row.id, {
      comments: commentCounts.get(row.cardId) ?? 0,
      attachments: attachmentCounts.get(row.cardId) ?? 0,
    });
  }
  return result;
}

/** One-card variant for the detail read. */
export async function approvalImpact(
  prisma: PrismaService,
  row: ApprovalImpactRow,
): Promise<ApprovalImpactDto | undefined> {
  const impacts = await approvalImpacts(prisma, [row]);
  return impacts.get(row.id);
}
