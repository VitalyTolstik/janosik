import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CalendarSkeleton,
  TableSkeleton,
  WatchFeedSkeleton,
  WatchSkeleton,
} from "@/components/board/ViewSkeleton";
import { I18nProvider } from "@/i18n";

/**
 * Lazy view fallbacks (SKELETON-AUDIT §4.4): each one matches the view it
 * replaces, so the chunk landing does not reflow the surface.
 */

function renderWithI18n(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("ViewSkeleton", () => {
  it("renders a 7×5 calendar grid with an unscheduled rail", () => {
    const { container } = renderWithI18n(<CalendarSkeleton />);
    const region = screen.getByTestId("calendar-view-skeleton");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".grid-cols-7")).toHaveLength(2);
    expect(container.querySelectorAll(".min-h-24")).toHaveLength(35);
  });

  it("renders a table header and ten placeholder rows", () => {
    const { container } = renderWithI18n(<TableSkeleton />);
    expect(screen.getByTestId("table-view-skeleton")).toBeInTheDocument();
    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("renders a watch feed with eight rows", () => {
    renderWithI18n(<WatchFeedSkeleton rows={8} />);
    expect(screen.getAllByTestId("watch-skeleton-row")).toHaveLength(8);
  });

  it("renders the full watch view shell", () => {
    renderWithI18n(<WatchSkeleton />);
    expect(screen.getByTestId("watch-view-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getAllByTestId("watch-skeleton-row")).toHaveLength(8);
  });
});
