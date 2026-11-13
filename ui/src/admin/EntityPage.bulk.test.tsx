import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBoardRowDto } from "@janosik/shared";

import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { adminApi, type AdminListParams } from "./admin-client";
import { EntityPage, type EntityListConfig } from "./EntityPage";

/**
 * Bulk-selection contract (TASK-176.1): the counter, the confirmation and the
 * request all describe the same saved set. Selection survives pagination,
 * is dropped when a filter changes, and a partial failure keeps exactly the
 * refused ids that were sent.
 */

const config: EntityListConfig<AdminBoardRowDto> = {
  entity: "boards",
  title: "Boards",
  statuses: [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "deleted", label: "Deleted" },
  ],
  periods: true,
  columns: [{ label: "Board", render: (row) => row.title }],
  rowTestId: (row) => `admin-row-${row.id}`,
  bulk: true,
  skipActions: true,
};

function rows(count: number): AdminBoardRowDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `board-${String(index).padStart(3, "0")}`,
    title: `Board ${String(index).padStart(3, "0")}`,
    userId: null,
    ownerEmail: null,
    createdAt: 1,
    updatedAt: index,
    archivedAt: null,
    deletedAt: null,
  }));
}

function mockList(allRows: AdminBoardRowDto[]) {
  const spy = vi.spyOn(adminApi, "listEntity");
  spy.mockImplementation(((_entity: unknown, params: AdminListParams) => {
    const search = (params.search ?? "").toLowerCase();
    const filtered = allRows.filter((row) =>
      row.title.toLowerCase().includes(search),
    );
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return Promise.resolve({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }) as unknown as typeof adminApi.listEntity);
  return spy;
}

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/boards"]}>
          <TooltipProvider>
            <EntityPage<"boards"> config={config} />
          </TooltipProvider>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntityPage bulk selection", () => {
  it("sends every saved id when rows are selected on two pages", async () => {
    mockList(rows(60));
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("admin-row-board-000");
    await user.click(screen.getByTestId("admin-select-board-000"));
    expect(screen.getByText("1 selected (1 on this page)")).toBeVisible();

    await user.click(screen.getByTestId("admin-pagination-next"));
    await screen.findByTestId("admin-row-board-050");
    // Pagination keeps the selection even though the row is now off-page.
    expect(screen.getByText("1 selected (0 on this page)")).toBeVisible();

    await user.click(screen.getByTestId("admin-select-board-050"));
    expect(screen.getByText("2 selected (1 on this page)")).toBeVisible();

    await user.click(screen.getByTestId("admin-bulk-delete"));
    expect(
      screen.getByRole("dialog", { name: "Apply to 2 selected?" }),
    ).toBeVisible();

    const bulk = vi
      .spyOn(adminApi, "bulkEntity")
      .mockResolvedValue({ affected: 2 });
    await user.click(screen.getByTestId("admin-confirm-accept"));

    await waitFor(() =>
      expect(bulk).toHaveBeenCalledWith(
        "boards",
        ["board-000", "board-050"],
        "delete",
      ),
    );
  });

  it("clears the selection when a filter changes and keeps it when the page changes", async () => {
    mockList(rows(60));
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("admin-row-board-000");
    const selectFirst = async () => {
      await user.click(screen.getByTestId("admin-select-board-000"));
      expect(
        screen.getByText((text) => text.startsWith("1 selected")),
      ).toBeVisible();
    };
    const expectCleared = () => {
      expect(screen.queryByTestId("admin-bulk-delete")).toBeNull();
    };

    await selectFirst();
    await user.type(
      screen.getByRole("textbox", { name: /Search/ }),
      "Board 00",
    );
    expectCleared();

    await selectFirst();
    await user.click(screen.getByRole("button", { name: "Archived" }));
    expectCleared();

    await selectFirst();
    await user.click(screen.getByRole("button", { name: "24 hours" }));
    expectCleared();

    await selectFirst();
    await user.selectOptions(screen.getByTestId("admin-page-size"), "25");
    expectCleared();

    await user.clear(screen.getByRole("textbox", { name: /Search/ }));
    await screen.findByTestId("admin-row-board-024");
    await selectFirst();
    await user.click(screen.getByTestId("admin-pagination-next"));
    await screen.findByTestId("admin-row-board-025");
    expect(screen.getByText("1 selected (0 on this page)")).toBeVisible();
  });

  it("blocks a selection above the backend cap before sending a request", async () => {
    mockList(rows(501));
    const bulk = vi
      .spyOn(adminApi, "bulkEntity")
      .mockResolvedValue({ affected: 0 });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("admin-row-board-000");
    await user.selectOptions(screen.getByTestId("admin-page-size"), "100");
    await screen.findByTestId("admin-row-board-099");

    for (let page = 0; page < 6; page += 1) {
      await screen.findByTestId(
        `admin-row-board-${String(page * 100).padStart(3, "0")}`,
      );
      fireEvent.click(screen.getByTestId("admin-select-all"));
      await waitFor(() =>
        expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
          `Page ${page + 1} of 6`,
        ),
      );
      if (page < 5) {
        fireEvent.click(screen.getByTestId("admin-pagination-next"));
        await waitFor(() =>
          expect(
            screen.getByTestId("admin-pagination-status"),
          ).toHaveTextContent(`Page ${page + 2} of 6`),
        );
      }
    }

    expect(screen.getByText("501 selected (1 on this page)")).toBeVisible();
    await user.click(screen.getByTestId("admin-bulk-delete"));

    expect(
      screen.getByText(/Too many rows selected: 501\. The bulk limit is 500/),
    ).toBeVisible();
    expect(bulk).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps only the refused ids from the request selected after a partial failure", async () => {
    mockList(rows(3));
    const bulk = vi.spyOn(adminApi, "bulkEntity").mockResolvedValue({
      affected: 1,
      // `board-999` was never sent; it must not resurrect a selection.
      failed: ["board-001", "board-999"],
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("admin-row-board-000");
    await user.click(screen.getByTestId("admin-select-board-000"));
    await user.click(screen.getByTestId("admin-select-board-001"));
    expect(screen.getByText("2 selected (2 on this page)")).toBeVisible();

    await user.click(screen.getByTestId("admin-bulk-delete"));
    await user.click(screen.getByTestId("admin-confirm-accept"));

    await waitFor(() =>
      expect(
        screen.getByText("1 refused — kept selected for retry."),
      ).toBeVisible(),
    );
    expect(bulk).toHaveBeenCalledWith(
      "boards",
      ["board-000", "board-001"],
      "delete",
    );
    expect(screen.getByText("1 selected (1 on this page)")).toBeVisible();
    expect(
      screen.getByTestId("admin-row-board-001").getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("admin-row-board-000").getAttribute("data-selected"),
    ).toBeNull();
  });
});
