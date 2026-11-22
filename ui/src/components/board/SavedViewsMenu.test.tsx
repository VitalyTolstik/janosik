import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SavedViewsMenu } from "./SavedViewsMenu";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { EMPTY_FILTER, type CardFilter } from "@/utils/filter";
import {
  loadSavedViews,
  MAX_SAVED_VIEWS,
  savedViewsKey,
  saveSavedViews,
  type SavedView,
} from "@/utils/saved-views";
import type { BoardView } from "./ViewSwitcher";

const USER = "user-1";
const BOARD = "board-1";
const ACTIVE_FILTER: CardFilter = { ...EMPTY_FILTER, due: "overdue" };

function savedView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    name: "Urgent",
    filter: { ...EMPTY_FILTER, due: "overdue" },
    view: "table",
    ...overrides,
  };
}

function renderMenu({
  filter = ACTIVE_FILTER,
  view = "board",
  labels,
  assigneeIds,
  disabled = false,
}: {
  filter?: CardFilter;
  view?: BoardView;
  labels?: ReadonlyArray<{ id: string }>;
  assigneeIds?: readonly string[];
  disabled?: boolean;
} = {}) {
  const onApply = vi.fn();
  render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <SavedViewsMenu
            userId={USER}
            boardId={BOARD}
            filter={filter}
            view={view}
            labels={labels}
            assigneeIds={assigneeIds}
            onApply={onApply}
            disabled={disabled}
          />
        </TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  return { onApply };
}

async function openMenu() {
  await userEvent.click(screen.getByTestId("saved-views-menu"));
  return screen.findByRole("dialog", { name: "Saved views" });
}

async function expectDialogClosed() {
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Saved views" }),
    ).not.toBeInTheDocument(),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SavedViewsMenu", () => {
  it("saves the current filter and projection, then returns focus", async () => {
    const { onApply } = renderMenu({ view: "table" });
    await openMenu();

    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    const input = screen.getByLabelText("View name");
    expect(input).toHaveFocus();

    await userEvent.type(input, "Overdue work");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(loadSavedViews(USER, BOARD).views).toEqual([
      {
        name: "Overdue work",
        filter: ACTIVE_FILTER,
        view: "table",
      },
    ]);
    expect(onApply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: /Apply view.*Overdue work.*Table/,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("saved-views-save-current")).toHaveFocus(),
    );
  });

  it("applies a clean view, closes the popover and restores trigger focus", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({
        name: "Clean",
        filter: { ...EMPTY_FILTER, query: "bug" },
        view: "calendar",
      }),
    ]);
    const { onApply } = renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Clean.*Calendar/ }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ query: "bug" }),
      "calendar",
    );
    await expectDialogClosed();
    await waitFor(() =>
      expect(screen.getByTestId("saved-views-menu")).toHaveFocus(),
    );
    expect(screen.queryByText(/no longer exist/)).not.toBeInTheDocument();
  });

  it("applies a drifted view, warns externally and closes", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({
        name: "Tidy",
        filter: {
          ...EMPTY_FILTER,
          query: "bug",
          labelIds: ["l1", "gone-label"],
          assignees: ["u1", "gone-user"],
        },
        view: "calendar",
      }),
    ]);
    const { onApply } = renderMenu({
      labels: [{ id: "l1" }, { id: "l2" }],
      assigneeIds: ["u1"],
    });
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Tidy/ }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "bug",
        labelIds: ["l1"],
        assignees: ["u1"],
      }),
      "calendar",
    );
    expect(
      await screen.findByText(
        "Saved view “Tidy” was updated: some options no longer exist.",
      ),
    ).toBeInTheDocument();
    await expectDialogClosed();
    expect(loadSavedViews(USER, BOARD).views[0].filter.labelIds).toEqual([
      "l1",
    ]);
  });

  it("drops an emptied view instead of applying an empty filter", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({
        name: "Only missing",
        filter: { ...EMPTY_FILTER, labelIds: ["gone-label"] },
      }),
    ]);
    const { onApply } = renderMenu({ labels: [{ id: "l1" }] });
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Only missing/ }),
    );

    expect(onApply).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Saved view “Only missing” was removed because all its filter options no longer exist.",
      ),
    ).toBeInTheDocument();
    await expectDialogClosed();
    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
  });

  it("scopes drift to the applied view and clears the prior warning", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({
        name: "Drifted",
        filter: {
          ...EMPTY_FILTER,
          query: "drift",
          labelIds: ["gone-label"],
        },
      }),
      savedView({
        name: "Clean",
        filter: { ...EMPTY_FILTER, query: "clean" },
      }),
      savedView({
        name: "Other",
        filter: { ...EMPTY_FILTER, labelIds: ["gone-label"] },
      }),
    ]);
    const { onApply } = renderMenu({ labels: [] });

    await openMenu();
    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Drifted/ }),
    );
    expect(
      await screen.findByText(
        "Saved view “Drifted” was updated: some options no longer exist.",
      ),
    ).toBeInTheDocument();

    await openMenu();
    onApply.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Clean/ }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ query: "clean" }),
      "table",
    );
    expect(screen.queryByText(/no longer exist/)).not.toBeInTheDocument();
    const stored = loadSavedViews(USER, BOARD).views;
    expect(stored.map((view) => view.name)).toEqual(["Drifted", "Clean"]);
  });

  it.each([
    ["undefined", undefined],
    ["empty", []],
  ])("preserves assignees while the roster is %s", async (_label, roster) => {
    saveSavedViews(USER, BOARD, [
      savedView({
        name: "Mine",
        filter: {
          ...EMPTY_FILTER,
          assignees: ["u1"],
        },
      }),
    ]);
    const { onApply } = renderMenu({ assigneeIds: roster });
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /Apply view.*Mine/ }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ["u1"] }),
      "table",
    );
    expect(loadSavedViews(USER, BOARD).views[0].filter.assignees).toEqual([
      "u1",
    ]);
    expect(screen.queryByText(/no longer exist/)).not.toBeInTheDocument();
  });

  it("renames a view, selects the draft and focuses the renamed row", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Before" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename view Before" }),
    );
    const input = screen.getByLabelText(
      "New name for view Before",
    ) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Before".length);

    await userEvent.clear(input);
    await userEvent.type(input, "After{Enter}");

    expect(loadSavedViews(USER, BOARD).views[0].name).toBe("After");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Apply view.*After/ }),
      ).toHaveFocus(),
    );
  });

  it("cancels rename with Escape and focuses the row", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Keep" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename view Keep" }),
    );
    await userEvent.keyboard("{Escape}");

    expect(
      screen.queryByTestId("saved-views-rename-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Saved views" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Apply view.*Keep/ }),
      ).toHaveFocus(),
    );
  });

  it("deletes only after confirmation and focuses the next row", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({ name: "Remove me" }),
      savedView({ name: "Stay" }),
    ]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete view Remove me" }),
    );
    expect(screen.getByText(/Delete.*Remove me/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", {
      name: "Delete “Remove me”",
    });
    expect(confirm).toHaveFocus();
    await userEvent.click(confirm);

    expect(loadSavedViews(USER, BOARD).views.map((view) => view.name)).toEqual([
      "Stay",
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Apply view.*Stay/ }),
      ).toHaveFocus(),
    );
  });

  it("cancels delete confirmation and keeps the view", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Keep" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete view Keep" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(loadSavedViews(USER, BOARD).views).toHaveLength(1);
    expect(screen.queryByText(/Delete.*Keep/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Apply view.*Keep/ }),
      ).toHaveFocus(),
    );
  });

  it("cancels delete confirmation with Escape before closing the popover", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Keep" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete view Keep" }),
    );
    await userEvent.keyboard("{Escape}");

    expect(loadSavedViews(USER, BOARD).views).toHaveLength(1);
    expect(screen.queryByText(/Delete.*Keep/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Saved views" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Apply view.*Keep/ }),
      ).toHaveFocus(),
    );
  });

  it("disables saving at the 20-view cap", async () => {
    saveSavedViews(
      USER,
      BOARD,
      Array.from({ length: MAX_SAVED_VIEWS }, (_, index) =>
        savedView({ name: `View ${index}` }),
      ),
    );
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
    expect(
      screen.getByText("Limit reached: 20 saved views per board."),
    ).toBeInTheDocument();
  });

  it("requires an active filter before saving", async () => {
    renderMenu({ filter: { ...EMPTY_FILTER } });
    await openMenu();

    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
    expect(
      screen.getByText("Set at least one filter before saving."),
    ).toBeInTheDocument();
  });

  it("opens by keyboard, focuses the name field and cancels with Escape", async () => {
    renderMenu();
    const trigger = screen.getByTestId("saved-views-menu");
    act(() => trigger.focus());
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Saved views" });

    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    const input = screen.getByLabelText("View name");
    expect(input).toHaveFocus();

    await userEvent.type(input, "Keyboard view");
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByTestId("saved-views-name")).not.toBeInTheDocument();
    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
    expect(
      screen.getByRole("dialog", { name: "Saved views" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("saved-views-save-current")).toHaveFocus(),
    );
  });

  it("closes from Escape or an outside click", async () => {
    renderMenu();
    await openMenu();
    await userEvent.keyboard("{Escape}");
    await expectDialogClosed();

    await openMenu();
    await userEvent.click(document.body);
    await expectDialogClosed();
  });

  it("marks duplicate names invalid and describes the error", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Existing" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    const input = screen.getByLabelText("View name");
    await userEvent.type(input, " existing ");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "saved-view-name-error");
    expect(screen.getByTestId("saved-views-duplicate")).toHaveTextContent(
      "A view with this name already exists.",
    );
    expect(screen.getByTestId("saved-views-confirm-save")).toBeDisabled();
  });

  it("marks a duplicate rename invalid and describes the error", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({ name: "One" }),
      savedView({ name: "Two" }),
    ]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename view One" }),
    );
    const input = screen.getByLabelText("New name for view One");
    await userEvent.clear(input);
    await userEvent.type(input, "two");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "saved-view-rename-error",
    );
    expect(screen.getByTestId("saved-views-confirm-rename")).toBeDisabled();
  });

  it("rolls back a failed save and keeps the form open with a status", async () => {
    renderMenu();
    await openMenu();
    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    await userEvent.type(screen.getByLabelText("View name"), "Not saved");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("saved-views-name")).toBeInTheDocument();
    expect(screen.getByTestId("saved-views-error")).toHaveTextContent(
      "Could not save views in this browser.",
    );
    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
  });

  it("quarantines damaged storage and reports it instead of an empty list", async () => {
    localStorage.setItem(savedViewsKey(USER, BOARD), "{broken");
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-empty")).toHaveTextContent(
      "Saved views were damaged; a copy was kept.",
    );
    expect(
      screen.queryByText("No saved views for this board yet."),
    ).not.toBeInTheDocument();
    expect(
      Object.keys(localStorage).some((key) => key.includes(".corrupt.")),
    ).toBe(true);
    expect(screen.getByTestId("saved-views-save-current")).toBeEnabled();
  });

  it("locks writes when damaged data could not be copied aside", async () => {
    const raw = "{broken";
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-empty")).toHaveTextContent(
      "Saving is locked to protect the damaged data.",
    );
    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("locks writes for a newer payload version", async () => {
    const raw = `{"version":2,"views":[]}`;
    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-empty")).toHaveTextContent(
      "Saved views were created by a newer version.",
    );
    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);
  });

  it("locks writes when a newer payload appears before saving", async () => {
    const raw = `{"version":2,"views":[]}`;
    renderMenu();
    await openMenu();
    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    await userEvent.type(screen.getByLabelText("View name"), "Race");

    localStorage.setItem(savedViewsKey(USER, BOARD), raw);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("saved-views-error")).toHaveTextContent(
      "Saved views were created by a newer version.",
    );
    expect(localStorage.getItem(savedViewsKey(USER, BOARD))).toBe(raw);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
    expect(screen.getByTestId("saved-views-empty")).toHaveTextContent(
      "Saved views were created by a newer version.",
    );
  });

  it("handles unavailable storage with a notice and locked controls", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-empty")).toHaveTextContent(
      "Saved views are unavailable in this browser.",
    );
    expect(screen.getByTestId("saved-views-save-current")).toBeDisabled();
  });

  it("shows the count on the trigger before opening and labels the badge", async () => {
    saveSavedViews(USER, BOARD, [
      savedView({ name: "One" }),
      savedView({ name: "Two" }),
    ]);
    renderMenu();

    expect(screen.getByTestId("saved-views-menu")).toHaveAttribute(
      "aria-label",
      "Saved views (2)",
    );
    expect(screen.getByTestId("saved-views-count-badge")).toHaveTextContent(
      "2",
    );

    await openMenu();
    expect(screen.getByText("2 / 20")).toHaveAttribute(
      "aria-label",
      "2 of 20 saved views",
    );
    expect(
      screen.getByRole("button", { name: /Apply view.*One/ }),
    ).toHaveAttribute("title", "One");
  });

  it("fits a 390px viewport and keeps 44px targets at 768px", async () => {
    renderMenu();
    expect(screen.getByTestId("saved-views-menu")).toHaveClass(
      "max-lg:h-11",
      "max-lg:w-11",
    );

    const dialog = await openMenu();
    expect(dialog).toHaveClass("w-[min(24rem,calc(100vw_-_1rem))]");
    expect(screen.getByTestId("saved-views-save-current")).toHaveClass("h-11");
  });

  it("can be disabled by its parent", () => {
    renderMenu({ disabled: true });
    expect(screen.getByTestId("saved-views-menu")).toBeDisabled();
  });
});
