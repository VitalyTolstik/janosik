import * as React from "react";

// react-day-picker is only needed when a date popover opens (due date in the
// card dialog / table row, created-date filter) — keep it out of the critical
// path and load the module on first mount (TASK-19). The `ru` locale lives in
// the same chunk, so it is resolved on demand too (a static
// `react-day-picker/locale` import here would eagerly pull the chunk).
const CalendarImpl = React.lazy(() =>
  import("@/components/ui/calendar").then((m) => ({ default: m.Calendar })),
);

// Type-only (erased at runtime). DayPicker's props are a discriminated union
// on `mode` — ComponentProps collapses it, so derive the parameter type and
// keep the wrapper generic to preserve `mode`/`selected` at call sites.
type CalendarComponent = typeof import("@/components/ui/calendar").Calendar;
type CalendarProps = Parameters<CalendarComponent>[0];

function useRdpLocale(tag?: string): CalendarProps["locale"] {
  const [locale, setLocale] = React.useState<CalendarProps["locale"]>();
  React.useEffect(() => {
    if (!tag || !tag.startsWith("ru")) return;
    let alive = true;
    import("react-day-picker/locale").then((m) => {
      if (alive) setLocale(m.ru);
    });
    return () => {
      alive = false;
    };
  }, [tag]);
  return locale;
}

/**
 * Drop-in lazy replacement for `@/components/ui/calendar`'s `Calendar`.
 * While the chunk loads, a skeleton with the calendar's footprint keeps the
 * popover from collapsing (first open only — afterwards the module is cached).
 */
function Calendar<P extends CalendarProps>(props: P & { localeTag?: string }) {
  const { localeTag, ...rest } = props;
  const resolvedLocale = useRdpLocale(localeTag);
  return (
    <React.Suspense
      fallback={
        <div className="h-80 w-72 animate-pulse rounded-md bg-muted/40" />
      }
    >
      <CalendarImpl
        {...(rest as CalendarProps)}
        locale={(rest as CalendarProps).locale ?? resolvedLocale}
      />
    </React.Suspense>
  );
}

export { Calendar };
