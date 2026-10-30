import * as React from "react";

// Calendar and table views are only rendered after the user switches views
// in the ViewSwitcher (the default view is the kanban board) — keep them out
// of the critical path and load each module on first switch (TASK-34; the
// pattern matches ui/calendar-lazy.tsx from TASK-19). A static import here
// would drag both views — and CalendarView's date-fns dependency — back into
// the eagerly loaded index chunk.
const CalendarViewImpl = React.lazy(() =>
  import("@/components/board/CalendarView").then((m) => ({
    default: m.CalendarView,
  })),
);
const TableViewImpl = React.lazy(() =>
  import("@/components/board/TableView").then((m) => ({
    default: m.TableView,
  })),
);
const WatchViewImpl = React.lazy(() =>
  import("@/components/board/WatchView").then((m) => ({
    default: m.WatchView,
  })),
);

type CalendarViewComponent =
  typeof import("@/components/board/CalendarView").CalendarView;
type CalendarViewProps = Parameters<CalendarViewComponent>[0];

type TableViewComponent =
  typeof import("@/components/board/TableView").TableView;
type TableViewProps = Parameters<TableViewComponent>[0];

type WatchViewComponent =
  typeof import("@/components/board/WatchView").WatchView;
type WatchViewProps = Parameters<WatchViewComponent>[0];

/**
 * Drop-in lazy replacements for `CalendarView` / `TableView`. While a chunk
 * loads, a skeleton fills the view area (first switch only — afterwards the
 * module is cached).
 */
function CalendarView(props: CalendarViewProps) {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-0 flex-1 animate-pulse rounded-lg bg-muted/40" />
      }
    >
      <CalendarViewImpl {...props} />
    </React.Suspense>
  );
}

function TableView(props: TableViewProps) {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-0 flex-1 animate-pulse rounded-lg bg-muted/40" />
      }
    >
      <TableViewImpl {...props} />
    </React.Suspense>
  );
}

function WatchView(props: WatchViewProps) {
  // The watch view is deliberately bare: no pulsing skeleton either.
  return (
    <React.Suspense fallback={<div className="min-h-0 flex-1 bg-muted/20" />}>
      <WatchViewImpl {...props} />
    </React.Suspense>
  );
}

export { CalendarView, TableView, WatchView };
