import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ColumnGlassMenu } from "@/components/board/ColumnGlassMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";

/**
 * The board view's column glass checkboxes (transparency + blur toggles).
 * Checking/unchecking must snap the `--janosik-glass-*` CSS variables on the
 * document root to their presets (consumed by ColumnView) and persist to
 * localStorage. Legacy slider values are normalized on load.
 */

function renderMenu() {
  return render(
    <I18nProvider>
      <BoardGlassProvider>
        <TooltipProvider>
          <ColumnGlassMenu />
        </TooltipProvider>
      </BoardGlassProvider>
    </I18nProvider>,
  );
}

function openMenu() {
  // Radix DropdownMenu opens on pointerdown, not click.
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Column appearance" }),
    { button: 0 },
  );
}

describe("ColumnGlassMenu", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to both effects on and unchecking transparency stores the opaque preset", () => {
    renderMenu();
    openMenu();

    expect(screen.getByTestId("glass-opacity")).toBeChecked();
    expect(screen.getByTestId("glass-blur")).toBeChecked();

    fireEvent.click(screen.getByTestId("glass-opacity"));

    expect(JSON.parse(localStorage.getItem("janosik-board-glass") ?? "{}")).toEqual(
      { transparency: 0, blur: 5 },
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--janosik-glass-transparency",
      ),
    ).toBe("0");
  });

  it("unchecking blur disables the frosted effect", () => {
    renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId("glass-blur"));

    expect(JSON.parse(localStorage.getItem("janosik-board-glass") ?? "{}")).toEqual(
      { transparency: 100, blur: 0 },
    );
    expect(
      document.documentElement.style.getPropertyValue("--janosik-glass-blur"),
    ).toBe("0px");
  });

  it("restores saved values and normalizes legacy slider numbers on mount", () => {
    localStorage.setItem(
      "janosik-board-glass",
      JSON.stringify({ transparency: 80, blur: 20 }),
    );

    renderMenu();
    openMenu();

    expect(screen.getByTestId("glass-opacity")).toBeChecked();
    expect(screen.getByTestId("glass-blur")).toBeChecked();
    expect(
      document.documentElement.style.getPropertyValue(
        "--janosik-glass-transparency",
      ),
    ).toBe("100");
    expect(
      document.documentElement.style.getPropertyValue("--janosik-glass-blur"),
    ).toBe("5px");
  });
});
