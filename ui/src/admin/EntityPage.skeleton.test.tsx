import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserRowDto } from "@janosik/shared";

import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { adminApi } from "./admin-client";
import { EntityPage, type EntityListConfig } from "./EntityPage";

/**
 * The page-level skeleton must have exactly the real table's columns
 * (SKELETON-AUDIT §4.11): the bulk checkbox is owned by EntityListSkeleton,
 * not counted again by EntityPage.
 */

const config: EntityListConfig<AdminUserRowDto> = {
  entity: "users",
  title: "Users",
  columns: [{ label: "Email", render: (row) => row.email }],
  bulk: true,
  skipActions: true,
};

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <TooltipProvider>
            <EntityPage<"users"> config={config} />
          </TooltipProvider>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(adminApi, "listEntity").mockImplementation(
    () => new Promise(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntityPage skeleton", () => {
  it("renders one header per real column, including the single bulk cell", async () => {
    const { container } = renderPage();

    const skeleton = await screen.findByTestId("admin-users-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("admin-users-skeleton-row")).toHaveLength(8);

    // Email + the bulk checkbox column. A double-counted bulk column would
    // make this 3 and force a horizontal jump when the table mounts.
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
  });
});
