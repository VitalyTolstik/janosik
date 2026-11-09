import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

/**
 * Lazy-view fallbacks (SKELETON-AUDIT §4.4). Each skeleton mirrors the first
 * paint of the real view — the same outer panel, toolbar height, calendar
 * cell grid and table row rhythm — so the chunk landing does not reflow the
 * board surface.
 */

export function CalendarSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("common.loading")}
      testId="calendar-view-skeleton"
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Skeleton width={112} height={20} />
          <Skeleton width={96} height={24} className="rounded-md" />
          <Skeleton width={28} height={28} className="ml-auto rounded-md" />
          <Skeleton width={28} height={28} className="rounded-md" />
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 lg:flex">
            <div className="border-b border-border/60 px-2 py-2">
              <Skeleton width={120} height={14} />
            </div>
            <div className="space-y-2 p-2">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-7" />
              ))}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border/60">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="flex justify-center px-2 py-1.5">
                  <Skeleton width={24} height={10} />
                </div>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-7 auto-rows-fr">
              {Array.from({ length: 35 }, (_, index) => (
                <div
                  key={index}
                  className="min-h-24 border-b border-r border-border/40 p-2"
                >
                  <Skeleton width={20} height={10} className="mb-2" />
                  <Skeleton className="mb-1 h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function TableSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("common.loading")}
      testId="table-view-skeleton"
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Skeleton width={96} height={25} className="rounded-md" />
          <Skeleton width={80} height={25} className="ml-auto rounded-md" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60">
                {[140, 80, 120, 100, 80, 60].map((width, index) => (
                  <th key={index} className="px-3 py-2 text-left">
                    <Skeleton width={width} height={10} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, row) => (
                <tr key={row} className="border-b border-border/40">
                  <td className="px-3 py-2">
                    <Skeleton className="h-3 w-40" />
                  </td>
                  {[80, 120, 100, 80].map((width, cell) => (
                    <td key={cell} className="px-3 py-2">
                      <Skeleton width={width} height={12} />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <Skeleton width={56} height={18} className="rounded-md" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The feed half of the watch view; also used for its first network load. */
export function WatchFeedSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ol className="space-y-1" data-testid="watch-feed-skeleton-rows">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="flex h-14 items-center gap-3 border-b border-border/40 px-5"
          data-testid="watch-skeleton-row"
        >
          <Skeleton variant="circle" width={24} height={24} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
          <Skeleton width={48} height={10} className="shrink-0" />
        </li>
      ))}
    </ol>
  );
}

export function WatchSkeleton() {
  const { t } = useI18n();
  return (
    <SkeletonRegion
      label={t("watch.feedLoading")}
      testId="watch-view-skeleton"
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-muted-foreground/40">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-muted-foreground/40 px-5 py-4">
          <Skeleton width={90} height={12} />
          <div className="flex gap-8">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} width={56} height={24} />
            ))}
          </div>
          <Skeleton width={48} height={12} className="ml-auto" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,20rem)_1fr]">
          <aside className="hidden min-h-0 border-r border-muted-foreground/40 p-5 md:block">
            <Skeleton className="mb-2 h-3 w-24" />
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="mb-2 h-6" />
            ))}
          </aside>
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-muted-foreground/40 px-5 py-2">
              <Skeleton width={64} height={10} />
            </div>
            <WatchFeedSkeleton />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}
