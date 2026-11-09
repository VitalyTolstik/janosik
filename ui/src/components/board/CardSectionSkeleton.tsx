import { Skeleton } from "@/components/ui/skeleton";

/**
 * Partial skeletons inside the card dialog (SKELETON-AUDIT §4.6).
 *
 * Each shape only reserves the list body; the section header/composer stays
 * mounted, so one late response cannot move the sections around it. The
 * parent owns the `SkeletonRegion` (one live region per data boundary).
 */

export type CardSectionKind = "comments" | "history" | "attachments";

export function CardSectionSkeleton({
  kind,
  rows = kind === "comments" ? 3 : kind === "history" ? 4 : 2,
}: {
  kind: CardSectionKind;
  rows?: number;
}) {
  if (kind === "attachments") {
    return (
      <div className="space-y-1" data-testid="card-attachments-skeleton-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-8 items-center gap-2 px-0.5">
            <Skeleton width={24} height={24} className="rounded" />
            <Skeleton width={160} height={12} />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton width={48} height={10} />
              <Skeleton width={32} height={10} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "history") {
    return (
      <div className="space-y-1" data-testid="card-history-skeleton-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-[52px] items-start gap-2.5 py-1">
            <Skeleton
              variant="circle"
              width={24}
              height={24}
              className="mt-1 shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1.5 pt-1">
              <Skeleton
                className={index === rows - 1 ? "h-3 w-4/5" : "h-3 w-3/5"}
              />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="card-comments-skeleton-rows">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-11 items-start gap-2.5 py-1">
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
          <Skeleton width={40} height={10} className="mt-1 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * The MDX editor footprint (toolbar + body) used while its lazy chunk loads.
 * The dialog's `Suspense` fallback previously reserved a shorter block, so
 * the editor used to push every section below it down on first open.
 */
export function CardDescriptionSkeleton() {
  return (
    <div className="space-y-1.5" data-testid="card-description-skeleton-rows">
      <Skeleton className="h-9 w-full rounded-md" />
      {/* `.janosik-md-content` reserves min-height 128 px inside the dialog. */}
      <div className="min-h-32 space-y-2 rounded-md border border-border/60 p-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/** Badge-sized placeholder while the activity counts are still loading. */
export function ActivityCountSkeleton() {
  return (
    <Skeleton
      width={24}
      height={16}
      className="rounded-full"
      data-testid="card-activity-count-skeleton"
    />
  );
}
