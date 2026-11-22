import { useState } from "react";
import { LockKeyhole } from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { useBoardMembersList } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { canReleaseCardClaim } from "@/utils/card-permissions";
import type { BoardRole } from "@janosik/shared";

/**
 * The card's agent work claim (TASK-157): who holds the lease and when it
 * lapses. Releasing clears the claim only — an agent session keeps running,
 * so ending it stays a separate, explicit control-plane action.
 */
export function CardClaim({
  boardId,
  cardId,
  claimedBy,
  leaseUntil,
  role,
  userId,
  readOnly = false,
}: {
  boardId: string;
  cardId: string;
  claimedBy?: string;
  /** Unix ms; absent on a malformed legacy claim, rendered as unknown. */
  leaseUntil?: number;
  role: BoardRole | undefined;
  userId: string | null | undefined;
  readOnly?: boolean;
}) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const { releaseCardClaim } = useBoardActions();
  const members = useBoardMembersList(boardId);
  const [confirm, setConfirm] = useState(false);
  // Freeze the clock for this render; the pill is reopened with the card, and
  // an expiry that lapses while the dialog is open can wait for the next open.
  const [mountedAt] = useState(() => Date.now());

  if (claimedBy === undefined) return null;

  const member = members.find((entry) => entry.userId === claimedBy);
  const name = member ? userLabel(member.displayName, member.email) : claimedBy;
  const expired = leaseUntil !== undefined && leaseUntil <= mountedAt;
  const date =
    leaseUntil !== undefined
      ? formatDate(leaseUntil, lang, hour12)
      : t("card.claim.unknownLease");
  const canRelease = canReleaseCardClaim({
    role,
    userId,
    claimedBy,
    readOnly,
  });

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-xs text-foreground"
        data-testid="card-claim"
      >
        <LockKeyhole
          className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <span className="font-medium">
          {t("card.claim.claimedBy", { name })}
        </span>
        <span className="text-muted-foreground">
          {expired
            ? t("card.claim.expired", { date })
            : t("card.claim.until", { date })}
        </span>
        {canRelease ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 shrink-0 px-2 text-xs max-md:min-h-11 no-hover:min-h-11"
            data-testid="card-claim-release"
            onClick={() => setConfirm(true)}
          >
            {t("card.claim.release")}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("card.claim.releaseTitle")}
        description={t("card.claim.releaseDescription", { name })}
        confirmLabel={t("card.claim.release")}
        onConfirm={() => releaseCardClaim(cardId)}
      />
    </>
  );
}
