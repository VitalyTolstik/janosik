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

const card = {
  type: "cards" as const,
  id: "card-1",
  title: "Retired card",
  deletedAt: Date.now() - 60_000,
  purgeAt: Date.now() + 30 * 86_400_000,
  columnTitle: "To do",
};

const comment = {
  type: "comments" as const,
  id: "comment-1",
  title: "A deleted remark",
  deletedAt: Date.now() - 120_000,
  purgeAt: Date.now() + 30 * 86_400_000,
  cardId: "card-2",
  cardTitle: "Live card",
  authorName: "Vera",
};

const file = {
  type: "attachments" as const,
  id: "file-1",
  title: "spec.pdf",
  deletedAt: Date.now() - 180_000,
  purgeAt: Date.now() + 30 * 86_400_000,
  cardId: "card-2",
  cardTitle: "Live card",
  sizeBytes: 2048,
};

const page = {
  retentionDays: 30,
  limit: 200,
  truncated: false,
  items: [card, comment, file],
};

/**
 * TASK-177.7 (G-15): the user-facing recovery list. Restoring calls the
 * board-scoped endpoint, then refetches so newly eligible rows can appear.
 */
describe("RecentlyDeletedDialog", () => {
  beforeEach(() => {
    hoisted.listDeleted.mockReset();
    hoisted.restoreDeleted.mockReset();
  });

  it("groups cards and comments, refetches and moves focus to the next row", async () => {
    hoisted.listDeleted
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, items: [comment] });
    hoisted.restoreDeleted.mockResolvedValue({ status: "ok" });
    renderDialog();

    expect(await screen.findByText("Retired card")).toBeVisible();
    expect(
      screen.getAllByText("Live card", { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("To do", { exact: false })).toBeVisible();
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
    await waitFor(() => expect(hoisted.listDeleted).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("A deleted remark")).toBeVisible();
    expect(document.activeElement).toHaveAttribute(
      "aria-label",
      "Restore A deleted remark",
    );
  });

  it("keeps restore disabled across the refetch and focuses an enabled row", async () => {
    let resolveRestore!: (value: { status: "ok" }) => void;
    let resolveList!: (value: typeof page) => void;
    hoisted.listDeleted.mockResolvedValueOnce(page).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    hoisted.restoreDeleted.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    const cardRow = (await screen.findAllByTestId("deleted-row")).find((row) =>
      within(row).queryByText("Retired card"),
    );
    expect(cardRow).toBeDefined();
    await userEvent.click(
      within(cardRow!).getByRole("button", { name: /Restore/ }),
    );

    resolveRestore({ status: "ok" });
    await waitFor(() => expect(hoisted.listDeleted).toHaveBeenCalledTimes(2));

    // The refetched page is still in flight: every restore stays disabled and
    // focus has not been handed to a button that cannot take it yet.
    const nextButton = screen
      .getAllByTestId("deleted-restore")
      .find(
        (button) =>
          button.getAttribute("aria-label") === "Restore A deleted remark",
      );
    expect(nextButton).toBeDefined();
    expect(nextButton).toBeDisabled();
    expect(nextButton).not.toHaveFocus();

    resolveList({ ...page, items: [comment] });
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBeNull();
    expect(focused).toHaveAttribute("aria-label", "Restore A deleted remark");
    expect(focused).toBeEnabled();
  });

  it("drops an item that is past retention, refetches and explains why", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.listDeleted
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, items: [comment] });
    hoisted.restoreDeleted.mockRejectedValue(
      new ApiError(410, { code: "retention_expired" }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    await userEvent.click(screen.getAllByTestId("deleted-restore")[0]!);

    expect(await screen.findByText(/past the retention period/i)).toBeVisible();
    await waitFor(() => expect(hoisted.listDeleted).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
  });

  it("keeps the row and explains a deleted-column 409", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.listDeleted.mockResolvedValue(page);
    hoisted.restoreDeleted.mockRejectedValue(
      new ApiError(409, { code: "column_deleted" }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    await userEvent.click(screen.getAllByTestId("deleted-restore")[0]!);

    expect(
      await screen.findByText(
        "Restore the column before restoring a card from it.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Retired card")).toBeVisible();
    // The failed row becomes actionable again.
    expect(screen.getAllByTestId("deleted-restore")[0]).toBeEnabled();
  });

  it("treats a 404 after a lost response as a stale row and refetches", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.listDeleted
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, items: [comment, file] });
    hoisted.restoreDeleted.mockRejectedValue(
      new ApiError(404, { message: "already restored" }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    await userEvent.click(screen.getAllByTestId("deleted-restore")[0]!);

    expect(
      await screen.findByText("This item was already restored or removed."),
    ).toBeVisible();
    await waitFor(() => expect(hoisted.listDeleted).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
  });

  it("names the 20-file cap when attachment restore is refused", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.listDeleted.mockResolvedValue(page);
    hoisted.restoreDeleted.mockRejectedValue(
      new ApiError(409, { code: "attachment_limit", limit: 20 }),
    );
    renderDialog();

    const fileRow = (await screen.findAllByTestId("deleted-row")).find((row) =>
      within(row).queryByText("spec.pdf"),
    );
    expect(fileRow).toBeDefined();
    await userEvent.click(
      within(fileRow!).getByRole("button", { name: /Restore/ }),
    );

    expect(await screen.findByText(/maximum of 20 files/)).toBeVisible();
    expect(screen.getByText("spec.pdf")).toBeVisible();
  });

  it("disables restore and announces progress while the request is in flight", async () => {
    let resolveRestore!: (value: { status: "ok" }) => void;
    hoisted.listDeleted
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, items: [comment] });
    hoisted.restoreDeleted.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );
    renderDialog();

    await screen.findByText("Retired card");
    const buttons = screen.getAllByTestId("deleted-restore");
    await userEvent.click(buttons[0]!);

    await waitFor(() =>
      expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(
        true,
      ),
    );
    expect(buttons[0]).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("deleted-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Restoring…");

    resolveRestore({ status: "ok" });
    await waitFor(() =>
      expect(screen.queryByText("Retired card")).not.toBeInTheDocument(),
    );
  });

  it("uses the server page size for the truncation notice", async () => {
    hoisted.listDeleted.mockResolvedValue({
      ...page,
      limit: 100,
      truncated: true,
      items: [card],
    });
    renderDialog();

    expect(
      await screen.findByText("Showing the 100 most recent items."),
    ).toBeVisible();
  });

  it("shows an honest empty state and focuses the title after a retry", async () => {
    hoisted.listDeleted.mockRejectedValueOnce(new Error("offline"));
    renderDialog();
    expect(
      await screen.findByText("Could not load Recently deleted."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();

    hoisted.listDeleted.mockResolvedValue({ ...page, items: [] });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(/Nothing has been deleted from this board/),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Recently deleted" }),
      ).toHaveFocus(),
    );
  });
});
