import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardDensityMenu } from "@/components/board/BoardDensityMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import type { BoardDensity } from "@/hooks/use-board-density";

/**
 * TASK-142: the "Simplify design" checkbox lives behind the card-density
 * menu on the board-view toolbar. It reflects the active face and reports
 * the requested density upward (the persistence lives in BoardSection).
 */
function renderMenu(density: BoardDensity = "full") {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <TooltipProvider>
        <BoardDensityMenu density={density} onChange={onChange} />
      </TooltipProvider>
    </I18nProvider>,
  );
  return { onChange };
}

/** Radix DropdownMenu opens on pointerdown, not click. */
function openMenu() {
  fireEvent.pointerDown(screen.getByTestId("density-menu"), { button: 0 });
}

describe("BoardDensityMenu", () => {
  it("is unchecked for the full face and requests compact when checked", () => {
    const { onChange } = renderMenu("full");
    openMenu();

    const toggle = screen.getByTestId("density-toggle");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith("compact");
  });

  it("is checked for the compact face and requests full when unchecked", () => {
    const { onChange } = renderMenu("compact");
    openMenu();

    const toggle = screen.getByTestId("density-toggle");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith("full");
  });
});
