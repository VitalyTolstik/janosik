import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

/**
 * First-paint board shell (SKELETON-AUDIT §4.2). The geometry follows the
 * real shell — `Header` is h-14, `BoardSection` pads px-4/pt-4/sm:px-6,
 * `ColumnView` is w-[80vw]/sm:w-72 and a full card is h-[92px] — so replacing
 * this block with the board does not shift the page.
 */
export function BoardShellSkeleton() {
  const { t } = useI18n();
  const columns = [0, 1, 2, 3];

  return (
    <SkeletonRegion
      label={t("sync.loading")}
      testId="board-shell-skeleton"
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
      delayMs={150}
    >
      {/* Header: brand mark, title, then the right-hand action cluster. */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Skeleton variant="circle" width={32} height={32} />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              width={32}
              height={32}
              className="rounded-md"
            />
          ))}
        </div>
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col px-4 pb-4 pt-4 sm:px-6">
        <Skeleton className="mb-3 h-8 w-full max-w-3xl rounded-lg" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <Skeleton width={180} height={32} className="rounded-lg" />
          <Skeleton width={96} height={32} className="rounded-lg" />
        </div>

        <div
          className="flex min-h-0 flex-1 items-stretch gap-3 overflow-hidden pb-4"
          data-testid="board-skeleton-columns"
        >
          {columns.map((index) => (
            <div
              key={index}
              data-testid="board-skeleton-column"
              className={
                "flex max-h-full w-[80vw] max-w-72 shrink-0 flex-col rounded-xl border border-border sm:w-72 sm:max-w-none" +
                (index === 3 ? " hidden lg:flex" : " flex")
              }
            >
              <div className="flex h-10 items-center px-3">
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="space-y-2 px-2 pb-2">
                {[0, 1, 2].map((card) => (
                  <Skeleton
                    key={card}
                    variant="card"
                    data-testid="board-skeleton-card"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </SkeletonRegion>
  );
}

/**
 * Pending rows at the bottom of the board switcher while the background
 * hydration still streams the remaining aggregates in (SKELETON-AUDIT §4.3).
 * The row height mirrors a real `px-2 py-1.5` row plus its 28 px avatar.
 */
export function BoardListSkeleton({ pending }: { pending: number }) {
  const { t } = useI18n();
  const rows = Math.min(2, Math.max(0, pending));
  if (rows === 0) return null;

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("board.switcher.loading")}
      data-testid="board-switcher-skeleton"
      className="janosik-skeleton-region space-y-0.5 p-1.5"
    >
      <span className="sr-only">{t("board.switcher.loading")}</span>
      <div aria-hidden="true" className="space-y-0.5">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            data-testid="board-switcher-skeleton-row"
            className="flex h-10 items-center gap-2.5 rounded-lg px-2"
          >
            <Skeleton width={28} height={28} className="rounded-md" />
            <Skeleton className="h-3.5 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
