import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentlyDeletedDialog } from "@/components/board/RecentlyDeletedDialog";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";

const hoisted = vi.hoisted(() => ({
  listDeleted: vi.fn(),
  restoreDeleted: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      listDeleted: hoisted.listDeleted,
      restoreDeleted: hoisted.restoreDeleted,
    },
  };
});

function renderDialog() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <RecentlyDeletedDialog open onOpenChange={() => {}} boardId="b-1" />
      </ToastProvider>
    </I18nProvider>,
  );
}

const page = {
  retentionDays: 30,
  truncated: false,
  items: [
    {
      type: "cards" as const,
      id: "card-1",
      title: "Retired card",
      deletedAt: Date.now() - 60_000,
      purgeAt: Date.now() + 30 * 86_400_000,
      cardId: "card-1",
      cardTitle: "Retired card",
    },
    {
      type: "comments" as const,
      id: "comment-1",
      title: "A deleted remark",
      deletedAt: Date.now() - 120_000,
      purgeAt: Date.now() + 30 * 86_400_000,
      cardId: "card-2",
      cardTitle: "Live card",
      authorName: "Vera",
    },
  ],
};

/**
 * TASK-177.7 (G-15): the user-facing recovery list. Restoring calls the
 * board-scoped endpoint and drops the row without a full page reload.
 */
describe("RecentlyDeletedDialog", () => {
  beforeEach(() => {
    hoisted.listDeleted.mockReset();
    hoisted.restoreDeleted.mockReset();
  });

  it("groups cards and comments and restores one in place", async () => {
    hoisted.listDeleted.mockResolvedValue(page);
    hoisted.restoreDeleted.mockResolvedValue({ status: "ok" });
    renderDialog();

    expect(await screen.findByText("Retired card")).toBeVisible();
    expect(screen.getByText("Live card", { exact: false })).toBeVisible();
    expect(screen.getByText("Vera", { exact: false })).toBeVisible();
    expect(hoisted.listDeleted).toHaveBeenCalledWith("b-1");

    const rows = await screen.findAllByTestId("deleted-row");
    const cardRow = rows.find((row) => within(row).queryByText("Retired card"));
    expect(cardRow).toBeDefined();
    await userEvent.click(
      within(cardRow!).getByRole("button", { name: /Restore/ }),
    );

    await waitFor(() =>
      expect(hoisted.restoreDeleted).toHaveBeenCalledWith(
        "b-1",
        "cards",
        "card-1",
      ),
    );
    expect(await screen.findByText("Restored")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
    // The untouched comment stays on the list.
    expect(screen.getByText("A deleted remark")).toBeVisible();
  });

  it("drops an item that is past retention and explains why", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.listDeleted.mockResolvedValue(page);
    hoisted.restoreDeleted.mockRejectedValue(
      new ApiError(410, { code: "retention_expired" }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    await userEvent.click(screen.getAllByTestId("deleted-restore")[0]!);

    expect(await screen.findByText(/past the retention period/i)).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
  });

  it("shows an honest empty state and a retry after a load failure", async () => {
    hoisted.listDeleted.mockRejectedValueOnce(new Error("offline"));
    renderDialog();
    expect(
      await screen.findByText("Could not load Recently deleted."),
    ).toBeVisible();

    hoisted.listDeleted.mockResolvedValue({ ...page, items: [] });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(/Nothing has been deleted from this board/),
    ).toBeVisible();
  });
});
