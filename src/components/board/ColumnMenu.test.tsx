import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ColumnMenu } from "@/components/board/ColumnMenu";
import { I18nProvider } from "@/i18n";

/** The sort sub-menu: one-shot criteria (no checked state — drag wins). */
describe("ColumnMenu — sort", () => {
  const setup = () => {
    const onSort = vi.fn();
    render(
      <I18nProvider>
        <ColumnMenu
          onRename={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onSort={onSort}
          onSetWipLimit={vi.fn()}
          onArchiveCards={vi.fn()}
        />
      </I18nProvider>,
    );
    return onSort;
  };

  // Radix DropdownMenu opens on pointerdown (not click).
  const openMenu = () => {
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Column options" }),
      { button: 0, ctrlKey: false },
    );
  };

  it("opens a sort sub-menu with the three criteria", async () => {
    setup();
    openMenu();
    fireEvent.click(await screen.findByText("Sort cards"));
    expect(await screen.findByText("By creation date")).toBeInTheDocument();
    expect(screen.getByText("By due date")).toBeInTheDocument();
    expect(screen.getByText("By title")).toBeInTheDocument();
  });

  it("fires onSort with the picked criterion", async () => {
    const onSort = setup();
    openMenu();
    fireEvent.click(await screen.findByText("Sort cards"));
    fireEvent.click(await screen.findByText("By due date"));
    expect(onSort).toHaveBeenCalledWith("dueDate");
  });
});

describe("ColumnMenu — WIP limit (TASK-13)", () => {
  // Radix DropdownMenu opens on pointerdown (not click).
  const openMenu = () => {
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Column options" }),
      { button: 0, ctrlKey: false },
    );
  };

  it("shows the WIP limit item and fires onSetWipLimit", async () => {
    const onSetWipLimit = vi.fn();
    render(
      <I18nProvider>
        <ColumnMenu
          onRename={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onSort={vi.fn()}
          onSetWipLimit={onSetWipLimit}
          onArchiveCards={vi.fn()}
          wipLimit={3}
        />
      </I18nProvider>,
    );
    openMenu();
    // The current limit is previewed next to the item label (assert before
    // clicking — Radix unmounts the menu when the item activates).
    expect(await screen.findByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("WIP limit"));
    expect(onSetWipLimit).toHaveBeenCalledOnce();
  });
});

describe("ColumnMenu — duplicate column blocked at the board limit", () => {
  const openMenu = () => {
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Column options" }),
      { button: 0, ctrlKey: false },
    );
  };

  it("enables the item by default", async () => {
    render(
      <I18nProvider>
        <ColumnMenu
          onRename={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onSort={vi.fn()}
          onSetWipLimit={vi.fn()}
          onArchiveCards={vi.fn()}
        />
      </I18nProvider>,
    );
    openMenu();
    expect(await screen.findByText("Duplicate column")).toBeEnabled();
  });

  it("disables the item with a reason while the board is full", async () => {
    render(
      <I18nProvider>
        <ColumnMenu
          onRename={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onSort={vi.fn()}
          onSetWipLimit={vi.fn()}
          onArchiveCards={vi.fn()}
          duplicateDisabled
          duplicateDisabledReason="Column limit reached (12)"
        />
      </I18nProvider>,
    );
    openMenu();
    const item = await screen.findByText("Duplicate column");
    // Radix menu items signal via aria-disabled/data-disabled, not the
    // native attribute.
    expect(item.closest('[role="menuitem"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(item.closest('[role="menuitem"]')).toHaveAttribute(
      "title",
      "Column limit reached (12)",
    );
  });
});
