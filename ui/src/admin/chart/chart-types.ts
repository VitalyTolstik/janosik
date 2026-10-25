/**
 * Chart contract shared by the eager wrapper and the lazily imported uPlot
 * chunk (TASK: admin charts). Kept dependency-free so the wrapper — which is
 * part of the admin bundle — never pulls uPlot onto that path.
 */

/** One plotted series. */
export interface ChartSeries {
  /** Legend label. */
  label: string;
  /** One value per `x` entry. */
  values: number[];
  /**
   * CSS custom-property name of the colour (e.g. `--primary`) — resolved to a
   * canvas colour at mount, so the chart follows the theme tokens instead of
   * hard-coded hexes.
   */
  colorToken: string;
}

export interface ChartProps {
  /** X positions (numeric: day index, seconds, …). */
  x: number[];
  series: ChartSeries[];
  /** Format an x value for the axis labels. */
  xFormat: (value: number) => string;
  /** Format a y value for the axis labels (default: rounded integer). */
  yFormat?: (value: number) => string;
  /** Which x ticks to draw; omitting lets uPlot pick. */
  xTicks?: number[];
  /** Legend label for the x series (default "Time"). */
  xLabel?: string;
  height?: number;
  /** Accessible description (the chart is exposed as a single image). */
  ariaLabel?: string;
  testId?: string;
}
