import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  AdminDetailSkeleton,
  BoardEditorSkeleton,
  DashboardSkeleton,
  EntityListSkeleton,
  SearchSkeleton,
  SettingsSkeleton,
} from "./skeletons";

/**
 * Master-panel skeleton compositions (SKELETON-AUDIT §4.10–4.13): the table
 * shell and page grids survive the swap instead of collapsing to a spinner.
 */

function renderAdmin(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("admin skeletons", () => {
  it("renders the entity table header plus eight body rows", () => {
    const { container } = renderAdmin(
      <EntityListSkeleton columns={5} bulk testId="admin-users-skeleton" />,
    );
    const region = screen.getByTestId("admin-users-skeleton");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector("thead")).not.toBeNull();
    expect(screen.getAllByTestId("admin-users-skeleton-row")).toHaveLength(8);
    // Bulk column reserves the select-all checkbox.
    expect(container.querySelectorAll("thead th")).toHaveLength(6);
  });

  it("renders the dashboard stat and chart grid", () => {
    renderAdmin(<DashboardSkeleton />);
    expect(screen.getByTestId("admin-dashboard-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getAllByTestId("dashboard-skeleton-stat")).toHaveLength(8);
    expect(screen.getAllByTestId("dashboard-skeleton-chart")).toHaveLength(2);
  });

  it("renders a detail page with the meta/count grids", () => {
    renderAdmin(<AdminDetailSkeleton variant="board" />);
    expect(screen.getByTestId("admin-board-detail-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders the requested settings panels under a specific test id", () => {
    renderAdmin(<SettingsSkeleton testId="admin-email-skeleton" panels={3} />);
    expect(screen.getByTestId("admin-email-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("settings-skeleton-panel")).toHaveLength(3);
  });

  it("renders four admin search rows", () => {
    const { container } = renderAdmin(<SearchSkeleton rows={4} />);
    expect(screen.getByTestId("admin-search-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelectorAll("[data-skeleton-bar]").length).toBe(8);
  });

  it("renders the board-content editor columns", () => {
    renderAdmin(<BoardEditorSkeleton />);
    expect(screen.getByTestId("admin-board-content-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
