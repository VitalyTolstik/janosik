import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { ChartProps } from "./chart-types";
import { readToken, withAlpha } from "./color";

/**
 * The uPlot-backed chart (TASK: admin charts). This module is the **lazy
 * chunk**: `chart.tsx` imports it with a dynamic `import()`, so uPlot (~15 KB
 * gzip) and its CSS load only when an admin chart actually mounts, never on
 * the critical path. Pure admin tooling — no board-rendering code here.
 *
 * Themed from the CSS tokens (`--primary`, `--border`, `--muted-foreground`),
 * live legend on cursor, integer y-axis and the caller-supplied x labels — so
 * the series are actually readable, unlike the old bar strips.
 */
export function UplotChart({
  x,
  series,
  xFormat,
  yFormat = (value) => String(Math.round(value)),
  xTicks,
  xLabel = "Time",
  height = 200,
  ariaLabel,
  testId,
}: ChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const data = useMemo<uPlot.AlignedData>(
    () => [x, ...series.map((entry) => entry.values)],
    [x, series],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const border = readToken("--border", "rgba(120,120,120,0.25)");
    const muted = readToken("--muted-foreground", "rgba(120,120,120,1)");
    const colors = series.map((entry) =>
      readToken(entry.colorToken, "hsl(258 90% 66%)"),
    );

    const options: uPlot.Options = {
      width: host.clientWidth > 0 ? host.clientWidth : 600,
      height,
      padding: [8, 8, 0, 0],
      legend: {
        show: true,
        live: true,
        isolate: false,
      },
      cursor: {
        show: true,
        points: { show: true, size: 6 },
        drag: { x: false, y: false },
      },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: muted,
          grid: { show: true, stroke: border, width: 1 },
          ticks: { stroke: border, width: 1 },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          size: 26,
          values: (_self, splits) => splits.map((value) => xFormat(value)),
          ...(xTicks ? { splits: () => xTicks } : {}),
        },
        {
          stroke: muted,
          grid: { show: true, stroke: border, width: 1 },
          ticks: { show: false },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          size: 44,
          values: (_self, splits) => splits.map((value) => yFormat(value)),
        },
      ],
      series: [
        {
          label: xLabel,
          value: (_self, raw) => (raw == null ? "" : xFormat(Number(raw))),
        },
        ...series.map((entry, index) => ({
          label: entry.label,
          stroke: colors[index],
          width: 1.75,
          points: { show: false },
          fill: (self: uPlot) => {
            const color = colors[index] ?? "#888";
            const { top, height: plotHeight } = self.bbox;
            // uPlot calls `fill` once while building the legend, before the
            // plot box exists (`bbox` is not finite yet) — a gradient there
            // throws; fall back to a flat tint until the real draw.
            if (!Number.isFinite(top) || !Number.isFinite(plotHeight)) {
              return withAlpha(color, 0.15);
            }
            const gradient = self.ctx.createLinearGradient(
              0,
              top,
              0,
              top + plotHeight,
            );
            gradient.addColorStop(0, withAlpha(color, 0.3));
            gradient.addColorStop(1, withAlpha(color, 0.02));
            return gradient;
          },
        })),
      ],
    };

    const chart = new uPlot(options, data, host);
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth > 0 ? host.clientWidth : 600;
      chart.setSize({ width, height });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [data, series, xFormat, yFormat, xTicks, xLabel, height]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? "admin-chart"}
      className="w-full select-none"
    />
  );
}
