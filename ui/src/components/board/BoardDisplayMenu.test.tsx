import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardDisplayMenu } from "./BoardDisplayMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";

function renderMenu(readOnly = false) {
  const density = vi.fn();
  const style = vi.fn();
  render(
    <I18nProvider>
      <BoardGlassProvider>
        <TooltipProvider>
          <BoardDisplayMenu
            density="full"
            onDensityChange={density}
            columnStyle="rail"
            onColumnStyleChange={style}
            readOnly={readOnly}
          />
        </TooltipProvider>
      </BoardGlassProvider>
    </I18nProvider>,
  );
  return { density, style };
}

describe("BoardDisplayMenu", () => {
  beforeEach(() => localStorage.clear());
  it("keeps density, transparency, blur and column styles available", async () => {
    const { density, style } = renderMenu();
    fireEvent.pointerDown(screen.getByTestId("board-display-menu"), {
      button: 0,
    });
    fireEvent.click(screen.getByTestId("density-toggle"));
    expect(density).toHaveBeenCalledWith("compact");
    fireEvent.click(screen.getByTestId("glass-opacity"));
    fireEvent.click(screen.getByTestId("glass-blur"));
    expect(
      JSON.parse(localStorage.getItem("janosik-board-glass") ?? "{}"),
    ).toEqual({ transparency: 0, blur: 0 });
    await userEvent.click(screen.getByTestId("column-style-menu"));
    await userEvent.click(await screen.findByTestId("column-style-menu-band"));
    expect(style).toHaveBeenCalledWith("band");
  });
  it("does not expose board-wide editing to a viewer", () => {
    renderMenu(true);
    fireEvent.pointerDown(screen.getByTestId("board-display-menu"), {
      button: 0,
    });
    expect(screen.queryByTestId("column-style-menu")).toBeNull();
    expect(screen.getByTestId("density-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("glass-blur")).toBeInTheDocument();
  });
});
