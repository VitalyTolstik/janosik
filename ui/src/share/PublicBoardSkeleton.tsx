import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

/**
 * Public-board placeholders (SKELETON-AUDIT §4.8). The header chrome is
 * already on screen; this only fills the `<main>` with the same column strip
 * the read-only `DndBoard` renders, so the first shared paint does not jump.
 */

export function PublicBoardSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("share.public.loading")}
      testId="public-board-skeleton"
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
      delayMs={200}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden pb-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            data-testid="public-board-skeleton-column"
            className="flex max-h-full w-[80vw] max-w-72 shrink-0 flex-col rounded-xl border border-border sm:w-72 sm:max-w-none"
          >
            <div className="flex h-10 items-center px-3">
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="space-y-2 px-2 pb-2">
              <Skeleton variant="card" />
              <Skeleton variant="card" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function PublicCommentsSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("comment.loading")}
      testId="public-comments-skeleton"
    >
      <div className="space-y-2" data-testid="public-comments-skeleton-rows">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex h-12 items-start gap-2.5 py-1">
            <Skeleton
              variant="circle"
              width={24}
              height={24}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-11/12" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function PublicAttachmentsSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("card.attachments.loading")}
      testId="public-attachments-skeleton"
    >
      <div className="space-y-1" data-testid="public-attachments-skeleton-rows">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex h-7 items-center gap-2">
            <Skeleton width={14} height={14} className="rounded-sm" />
            <Skeleton width={140} height={12} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
