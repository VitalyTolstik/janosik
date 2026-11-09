import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ActivityCountSkeleton,
  CardDescriptionSkeleton,
  CardSectionSkeleton,
} from "@/components/board/CardSectionSkeleton";
import { SkeletonRegion } from "@/components/ui/skeleton";

/**
 * Card dialog partial skeletons (SKELETON-AUDIT §4.5/4.6): rows match the
 * real list rhythm and the description reserves the whole MDX editor.
 */

describe("CardSectionSkeleton", () => {
  it("renders three comment rows", () => {
    render(<CardSectionSkeleton kind="comments" rows={3} />);
    expect(
      screen.getByTestId("card-comments-skeleton-rows").children,
    ).toHaveLength(3);
  });

  it("renders four history rows", () => {
    render(<CardSectionSkeleton kind="history" rows={4} />);
    expect(
      screen.getByTestId("card-history-skeleton-rows").children,
    ).toHaveLength(4);
  });

  it("renders two attachment rows", () => {
    render(<CardSectionSkeleton kind="attachments" rows={2} />);
    expect(
      screen.getByTestId("card-attachments-skeleton-rows").children,
    ).toHaveLength(2);
  });

  it("reserves the description toolbar and body", () => {
    render(<CardDescriptionSkeleton />);
    const rows = screen.getByTestId("card-description-skeleton-rows");
    expect(rows.children).toHaveLength(2);
    expect(rows.firstElementChild).toHaveClass("h-9");
    expect(rows.children[1]).toHaveClass("min-h-32");
  });

  it("is hidden from assistive technology and lives in one region", () => {
    render(
      <SkeletonRegion label="Loading comments…" testId="card-comments-skeleton">
        <CardSectionSkeleton kind="comments" />
      </SkeletonRegion>,
    );
    expect(screen.getByTestId("card-comments-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen
        .getByTestId("card-comments-skeleton-rows")
        .closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  });

  it("renders a badge-sized activity placeholder", () => {
    render(<ActivityCountSkeleton />);
    const badge = screen.getByTestId("card-activity-count-skeleton");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveAttribute("style", "width: 24px; height: 16px;");
  });
});
