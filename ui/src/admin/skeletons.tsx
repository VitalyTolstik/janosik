import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useAdminT } from "./admin-i18n";
import { Table, Td, Th } from "./ui";

/**
 * Skeleton compositions for the master panel (SKELETON-AUDIT §4.10–4.13).
 * They keep the same outer paddings, grids and table shell as the real
 * pages, so the swap happens in place rather than by collapsing the page.
 */

export function EntityListSkeleton({
  columns,
  rows = 8,
  bulk = false,
  testId,
}: {
  columns: number;
  rows?: number;
  bulk?: boolean;
  testId: string;
}) {
  const t = useAdminT();
  // Width pattern taken from the audit: the id/name columns are widest.
  const widths = [80, 160, 120, 100, 80, 60, 120, 90, 70, 110, 100, 80];

  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId={testId}
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <Table>
        <thead>
          <tr>
            {bulk ? (
              <Th className="w-8">
                <Skeleton width={16} height={16} className="rounded-sm" />
              </Th>
            ) : null}
            {Array.from({ length: columns }, (_, index) => (
              <Th key={index}>
                <Skeleton width={widths[index % widths.length]} height={10} />
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} data-testid={`${testId}-row`}>
              {bulk ? (
                <Td className="w-8">
                  <Skeleton width={16} height={16} className="rounded-sm" />
                </Td>
              ) : null}
              {Array.from({ length: columns }, (_, column) => (
                <Td key={column}>
                  <Skeleton
                    width={widths[column % widths.length]}
                    height={12}
                  />
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </SkeletonRegion>
  );
}

export function DashboardSkeleton() {
  const t = useAdminT();
  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId="admin-dashboard-skeleton"
      className="flex h-full min-h-0 flex-col"
      contentClassName="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="space-y-1.5">
          <Skeleton width={180} height={20} />
          <Skeleton width={260} height={12} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              data-testid="dashboard-skeleton-stat"
              className="rounded-xl border border-border bg-card/70 p-3"
            >
              <Skeleton width={80} height={10} className="mb-2" />
              <Skeleton width={48} height={24} />
              <Skeleton width={100} height={10} className="mt-2" />
            </div>
          ))}
        </div>

        <div className="flex h-12 items-center gap-4 rounded-xl border border-border bg-card/70 px-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} width={96} height={12} />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              data-testid="dashboard-skeleton-chart"
              className="h-56 rounded-xl border border-border bg-card/70 p-3"
            >
              <Skeleton width={120} height={12} className="mb-3" />
              <Skeleton variant="chart" height={176} />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card/70 p-3">
          <Skeleton width={140} height={12} className="mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function AdminDetailSkeleton({
  variant,
}: {
  variant: "board" | "card" | "user";
}) {
  const t = useAdminT();
  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId={`admin-${variant}-detail-skeleton`}
      className="h-full w-full"
      contentClassName="h-full w-full"
    >
      <div className="w-full max-w-5xl space-y-4 p-4">
        <div className="flex items-center gap-3">
          <Skeleton width={28} height={28} className="rounded-md" />
          <div className="space-y-1.5">
            <Skeleton width={240} height={20} />
            <Skeleton width={180} height={12} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {Array.from({ length: 9 }, (_, index) => (
            <Skeleton key={index} className="h-12 rounded-lg" />
          ))}
        </div>
        {[0, 1].map((index) => (
          <Skeleton key={index} className="h-40 rounded-xl" />
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function SettingsSkeleton({
  testId = "admin-settings-skeleton",
  panels = 3,
  wide = false,
}: {
  testId?: string;
  panels?: number;
  wide?: boolean;
}) {
  const t = useAdminT();
  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId={testId}
      className="w-full"
      contentClassName="w-full"
    >
      <div
        className={
          wide
            ? "w-full max-w-4xl space-y-4 p-4"
            : "w-full max-w-3xl space-y-4 p-4"
        }
      >
        <div className="space-y-1.5">
          <Skeleton width={180} height={20} />
          <Skeleton width={280} height={12} />
        </div>
        {Array.from({ length: panels }, (_, index) => (
          <div
            key={index}
            data-testid="settings-skeleton-panel"
            className="space-y-3 rounded-xl border border-border bg-card/70 p-4"
          >
            <Skeleton width={140} height={14} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Skeleton width={120} height={12} />
                <Skeleton height={32} className="rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <Skeleton width={100} height={12} />
                <Skeleton height={32} className="rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function SearchSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useAdminT();
  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId="admin-search-skeleton"
      delayMs={150}
    >
      <div className="py-1">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-9 items-center gap-2.5 px-3">
            <Skeleton width={14} height={14} className="rounded-sm" />
            <Skeleton width={index % 2 === 0 ? 160 : 240} height={11} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function BoardEditorSkeleton() {
  const t = useAdminT();
  return (
    <SkeletonRegion
      label={t("admin.common.loading")}
      testId="admin-board-content-skeleton"
      className="flex h-full min-h-0 flex-col"
      contentClassName="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="space-y-1.5">
          <Skeleton width={220} height={20} />
          <Skeleton width={300} height={12} />
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-card/70"
            >
              <div className="flex h-10 items-center px-3">
                <Skeleton width={100} height={14} />
              </div>
              <div className="space-y-2 p-2">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
