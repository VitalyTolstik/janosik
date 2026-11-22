import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SavedViewsMenu } from "./SavedViewsMenu";
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
    </I18nProvider>,
  );
  return { onApply };
}

async function openMenu() {
  await userEvent.click(screen.getByTestId("saved-views-menu"));
  return screen.findByRole("dialog", { name: "Saved views" });
}

describe("SavedViewsMenu", () => {
  it("saves the current filter and projection", async () => {
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
      screen.getByRole("button", { name: "Apply view Overdue work" }),
    ).toBeInTheDocument();
  });

  it("applies a view, prunes missing options and warns once", async () => {
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
      screen.getByRole("button", { name: "Apply view Tidy" }),
    );

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "bug",
        labelIds: ["l1"],
        assignees: ["u1"],
      }),
      "calendar",
    );
    expect(screen.getByTestId("saved-views-notice")).toHaveTextContent(
      "Some options in this view no longer exist",
    );
    expect(loadSavedViews(USER, BOARD).views[0].filter.labelIds).toEqual([
      "l1",
    ]);
    expect(loadSavedViews(USER, BOARD).views[0].filter.assignees).toEqual([
      "u1",
    ]);
  });

  it("renames a view from the row", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Before" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename view Before" }),
    );
    const input = screen.getByLabelText("New name for view Before");
    expect(input).toHaveFocus();

    await userEvent.clear(input);
    await userEvent.type(input, "After{Enter}");

    expect(loadSavedViews(USER, BOARD).views[0].name).toBe("After");
    expect(
      screen.getByRole("button", { name: "Apply view After" }),
    ).toBeInTheDocument();
  });

  it("deletes a view only after confirmation", async () => {
    saveSavedViews(USER, BOARD, [savedView({ name: "Remove me" })]);
    renderMenu();
    await openMenu();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete view Remove me" }),
    );
    expect(screen.getByText("Delete this view?")).toBeInTheDocument();
    expect(loadSavedViews(USER, BOARD).views).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
    expect(
      screen.getByText("No saved views for this board yet."),
    ).toBeInTheDocument();
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
    const dialog = await screen.findByRole("dialog", { name: "Saved views" });

    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    const input = screen.getByLabelText("View name");
    expect(input).toHaveFocus();

    await userEvent.type(input, "Keyboard view");
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByTestId("saved-views-name")).not.toBeInTheDocument();
    expect(loadSavedViews(USER, BOARD).views).toEqual([]);
    expect(dialog).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("saved-views-save-current"));
    await userEvent.type(screen.getByLabelText("View name"), "Keyboard view");
    await userEvent.keyboard("{Enter}");

    expect(loadSavedViews(USER, BOARD).views[0].name).toBe("Keyboard view");
  });

  it("fits a 390px viewport and keeps mobile touch targets at 44px", async () => {
    renderMenu();
    expect(screen.getByTestId("saved-views-menu")).toHaveClass(
      "max-lg:h-11",
      "max-lg:w-11",
    );

    const dialog = await openMenu();
    expect(dialog).toHaveClass("w-[min(24rem,calc(100vw_-_1rem))]");
    expect(screen.getByTestId("saved-views-save-current")).toHaveClass("h-11");
  });

  it("quarantines damaged storage and says so", async () => {
    localStorage.setItem(savedViewsKey(USER, BOARD), "{broken");
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("saved-views-notice")).toHaveTextContent(
      "Saved views were damaged",
    );
    expect(
      Object.keys(localStorage).some((key) => key.includes(".corrupt.")),
    ).toBe(true);
  });

  it("can be disabled by its parent", () => {
    renderMenu({ disabled: true });
    expect(screen.getByTestId("saved-views-menu")).toBeDisabled();
  });
});
