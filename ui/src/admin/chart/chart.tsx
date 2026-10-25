import { lazy, Suspense } from "react";

import type { ChartProps } from "./chart-types";

/**
 * Eager, tiny entry point for the admin charts. uPlot lives behind the
 * dynamic import below, so the admin bundle stays small; this file only
 * decides whether a canvas chart is usable and, if not (jsdom in tests, an
 * environment without 2d canvas), renders a lightweight SVG fallback.
 */
const UplotChart = lazy(() =>
  import("./uplot-chart").then((module) => ({ default: module.UplotChart })),
);

let canvasSupport: boolean | null = null;
function canvasAvailable(): boolean {
  if (canvasSupport !== null) return canvasSupport;
  try {
    const probe = document.createElement("canvas");
    canvasSupport = probe.getContext("2d") !== null;
  } catch {
    canvasSupport = false;
  }
  return canvasSupport;
}

export function Chart(props: ChartProps) {
  const { height = 200 } = props;
  if (import.meta.env.MODE === "test" || !canvasAvailable()) {
    return <ChartFallback {...props} height={height} />;
  }
  return (
    <Suspense fallback={<ChartFallback {...props} height={height} />}>
      <UplotChart {...props} height={height} />
    </Suspense>
  );
}

/**
 * Readable fallback: a small SVG sparkline with the series max labelled. It
 * is what jsdom tests render, and what any canvas-less client gets instead of
 * a blank box.
 */
function ChartFallback({
  series,
  height = 200,
  ariaLabel,
  testId,
}: ChartProps) {
  const width = 300;
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? "admin-chart-fallback"}
      className="relative w-full"
      style={{ height }}
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {series.map((entry, seriesIndex) => {
          const step =
            entry.values.length > 1 ? width / (entry.values.length - 1) : width;
          const points = entry.values
            .map((value, index) => {
              const px = index * step;
              const py = height - (value / max) * (height - 8) - 4;
              return `${px.toFixed(1)},${py.toFixed(1)}`;
            })
            .join(" ");
          return (
            <polyline
              key={seriesIndex}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-primary"
            />
          );
        })}
      </svg>
      <span className="absolute right-1 top-0 text-[10px] tabular-nums text-muted-foreground">
        {max}
      </span>
    </div>
  );
}
