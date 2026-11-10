import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Loading placeholders (SKELETON-AUDIT §4.1).
 *
 * The primitive is deliberately dumb: it renders bars only and never owns a
 * live region. `SkeletonRegion` wraps a group of bars in one `role="status"`
 * so a screen reader hears "Loading" once per boundary instead of once per
 * rectangle. The delay lives in CSS (`opacity 0 → 1`), so the layout is
 * reserved from the first frame and a fast response never flashes a skeleton.
 */

export type SkeletonVariant =
  "text" | "circle" | "card" | "row" | "chart" | "block";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape preset; defaults to a generic block. */
  variant?: SkeletonVariant;
  /** Text variant only: number of stacked lines. */
  lines?: number;
  width?: number | string;
  height?: number | string;
}

const VARIANT_CLASS: Record<Exclude<SkeletonVariant, "text">, string> = {
  block: "h-4 w-full rounded-md",
  circle: "h-8 w-8 rounded-full",
  card: "h-[92px] w-full rounded-xl",
  row: "h-10 w-full rounded-md",
  chart: "h-40 w-full rounded-lg",
};

function dimension(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** One shimmering bar. Always hidden from assistive technology. */
function SkeletonBar({
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-skeleton-bar=""
      className={cn(
        "janosik-skeleton bg-skeleton motion-reduce:animate-none",
        className,
      )}
      style={style}
      {...rest}
    />
  );
}

export function Skeleton({
  variant = "block",
  lines = 1,
  width,
  height,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (variant === "text") {
    const count = Math.max(1, Math.floor(lines));
    return (
      <div
        aria-hidden="true"
        className={cn("space-y-1.5", className)}
        style={{ width: dimension(width), ...style }}
        {...rest}
      >
        {Array.from({ length: count }, (_, index) => (
          <SkeletonBar
            key={index}
            className={cn(
              "h-3 rounded-sm",
              count > 1 && index === count - 1 ? "w-3/5" : "w-full",
            )}
            style={
              height === undefined ? undefined : { height: dimension(height) }
            }
          />
        ))}
      </div>
    );
  }

  return (
    <SkeletonBar
      className={cn(VARIANT_CLASS[variant], className)}
      style={{
        width: dimension(width),
        height: dimension(height),
        ...style,
      }}
      {...rest}
    />
  );
}

export interface SkeletonRegionProps {
  /** Localized "Loading…" text read once by assistive technology. */
  label: string;
  /** Convention: `skeleton-*` or the surface-specific id from the audit. */
  testId: string;
  children: ReactNode;
  className?: string;
  /** Layout classes for the aria-hidden content wrapper (flex/grid cases). */
  contentClassName?: string;
  /** Reveal delay; the layout is reserved immediately either way. */
  delayMs?: number;
}

/**
 * One data boundary, one live region. The region unmounts when the data
 * arrives (the audit's rule), so a screen reader never reads a stale empty
 * state from a skeleton that is no longer loading.
 */
export function SkeletonRegion({
  label,
  testId,
  children,
  className,
  contentClassName,
  delayMs = 180,
}: SkeletonRegionProps) {
  return (
    <div
      aria-busy="true"
      data-testid={testId}
      className={cn("janosik-skeleton-region", className)}
      style={{ "--janosik-skeleton-delay": `${delayMs}ms` } as CSSProperties}
    >
      {/* The busy flag lives on the outer layout box; the live region itself
          stays un-busy so the "Loading…" text is announced. */}
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className={contentClassName}>
        {children}
      </div>
    </div>
  );
}

export interface SkeletonBoundaryProps {
  /** Still waiting for the first successful response. */
  loading: boolean;
  label: string;
  testId: string;
  children: ReactNode;
  fallback: ReactNode;
  className?: string;
  contentClassName?: string;
  delayMs?: number;
}

/**
 * The common "skeleton until the first answer" branch. Refresh-with-data is
 * deliberately not handled here: callers keep the previous rows and mark the
 * container `aria-busy` instead of swapping it for a skeleton.
 */
export function SkeletonBoundary({
  loading,
  label,
  testId,
  children,
  fallback,
  className,
  contentClassName,
  delayMs,
}: SkeletonBoundaryProps) {
  if (!loading) return <>{children}</>;
  return (
    <SkeletonRegion
      label={label}
      testId={testId}
      className={className}
      contentClassName={contentClassName}
      {...(delayMs === undefined ? {} : { delayMs })}
    >
      {fallback}
    </SkeletonRegion>
  );
}
