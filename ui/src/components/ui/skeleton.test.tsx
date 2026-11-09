import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Skeleton,
  SkeletonBoundary,
  SkeletonRegion,
} from "@/components/ui/skeleton";

/**
 * The shared loading primitive (SKELETON-AUDIT §4.1): variants, the
 * aria-hidden bars and the single busy status region per boundary.
 */

describe("Skeleton", () => {
  it("renders text lines with a shortened last line", () => {
    const { container } = render(<Skeleton variant="text" lines={3} />);
    const bars = container.querySelectorAll("[data-skeleton-bar]");
    expect(bars).toHaveLength(3);
    expect(bars[2]).toHaveClass("w-3/5");
    expect(bars[0]).toHaveClass("w-full");
  });

  it("maps variants to their geometry and hides every bar from AT", () => {
    const { container } = render(
      <>
        <Skeleton variant="circle" width={32} height={32} />
        <Skeleton variant="card" />
        <Skeleton variant="row" />
        <Skeleton variant="chart" />
      </>,
    );
    const bars = container.querySelectorAll("[data-skeleton-bar]");
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(bar).toHaveClass("janosik-skeleton");
    }
    expect(bars[0]).toHaveAttribute("style", "width: 32px; height: 32px;");
    expect(bars[1]).toHaveClass("h-[92px]", "rounded-xl");
    expect(bars[2]).toHaveClass("h-10");
    expect(bars[3]).toHaveClass("h-40");
  });

  it("wraps a group in one busy status region with an sr-only label", () => {
    render(
      <SkeletonRegion label="Loading comments…" testId="skeleton-test">
        <Skeleton variant="text" />
      </SkeletonRegion>,
    );
    const region = screen.getByTestId("skeleton-test");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-label", "Loading comments…");
    expect(screen.getByText("Loading comments…")).toHaveClass("sr-only");
  });

  it("unmounts the fallback once the boundary has data", () => {
    const { rerender } = render(
      <SkeletonBoundary
        loading
        label="Loading"
        testId="skeleton-boundary"
        fallback={<Skeleton variant="row" />}
      >
        <p>Loaded rows</p>
      </SkeletonBoundary>,
    );
    expect(screen.getByTestId("skeleton-boundary")).toBeInTheDocument();
    rerender(
      <SkeletonBoundary
        loading={false}
        label="Loading"
        testId="skeleton-boundary"
        fallback={<Skeleton variant="row" />}
      >
        <p>Loaded rows</p>
      </SkeletonBoundary>,
    );
    expect(screen.queryByTestId("skeleton-boundary")).not.toBeInTheDocument();
    expect(screen.getByText("Loaded rows")).toBeInTheDocument();
  });
});
