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
