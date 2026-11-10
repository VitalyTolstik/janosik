import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { I18nProvider } from "@/i18n";
import { EmptyState, ErrorState, ForbiddenState, Pagination } from "./ui";

function renderPrimitive(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("admin primitives", () => {
  it("offers 25 / 50 / 100 rows per page and reports the choice", () => {
    const onLimitChange = vi.fn();
    renderPrimitive(
      <Pagination
        total={120}
        limit={50}
        offset={0}
        onChange={() => undefined}
        onLimitChange={onLimitChange}
      />,
    );

    fireEvent.change(screen.getByTestId("admin-page-size"), {
      target: { value: "100" },
    });
    expect(onLimitChange).toHaveBeenCalledWith(100);
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 3",
    );
  });

  it("distinguishes a filtered empty state and exposes a clear action", () => {
    const onClear = vi.fn();
    renderPrimitive(<EmptyState filtered onClear={onClear} />);
    expect(screen.getByTestId("admin-empty-state")).toHaveTextContent(
      "No rows match this search or filter.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("renders a retryable error with a support reference", () => {
    const onRetry = vi.fn();
    renderPrimitive(<ErrorState onRetry={onRetry} reference="users:now" />);
    expect(screen.getByTestId("admin-error-reference")).toHaveTextContent(
      "users:now",
    );
    fireEvent.click(screen.getByTestId("admin-error-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows an explicit forbidden state for an owner-only screen", () => {
    const onBack = vi.fn();
    renderPrimitive(<ForbiddenState onBack={onBack} />);
    expect(screen.getByTestId("admin-forbidden-state")).toHaveTextContent(
      "Owner rights required",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to the panel" }));
    expect(onBack).toHaveBeenCalled();
  });
});
