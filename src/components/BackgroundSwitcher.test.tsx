import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BackgroundSwitcher } from "@/components/BackgroundSwitcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import {
  BoardGlassProvider,
  GLASS_LIMITS,
} from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";

/**
 * The background switcher also hosts the column glass sliders (TASK: user
 * controlled column transparency + blur). Changing a slider must update the
 * `--janosik-glass-*` CSS variables on the document root (consumed by
 * ColumnView) and persist to localStorage.
 */

function renderSwitcher() {
  return render(
    <I18nProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <TooltipProvider>
            <MemoryRouter>
              <BackgroundSwitcher />
            </MemoryRouter>
          </TooltipProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </I18nProvider>,
  );
}

function openMenu() {
  // Radix DropdownMenu opens on pointerdown, not click.
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Board background" }),
    { button: 0 },
  );
}

describe("BackgroundSwitcher glass sliders", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists transparency changes to localStorage and CSS variables", () => {
    renderSwitcher();
    openMenu();

    const opacity = screen.getByTestId("glass-opacity");
    expect(opacity).toHaveValue(String(GLASS_LIMITS.transparency.default));

    fireEvent.change(opacity, { target: { value: "40" } });

    expect(JSON.parse(localStorage.getItem("janosik-board-glass") ?? "{}")).toEqual(
      { transparency: 40, blur: GLASS_LIMITS.blur.default },
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--janosik-glass-transparency",
      ),
    ).toBe("40");
  });

  it("persists blur changes and stores 0 as 'no frosting'", () => {
    renderSwitcher();
    openMenu();

    fireEvent.change(screen.getByTestId("glass-blur"), {
      target: { value: "0" },
    });

    expect(JSON.parse(localStorage.getItem("janosik-board-glass") ?? "{}")).toEqual(
      { transparency: GLASS_LIMITS.transparency.default, blur: 0 },
    );
    expect(
      document.documentElement.style.getPropertyValue("--janosik-glass-blur"),
    ).toBe("0px");
  });

  it("restores saved values from localStorage on mount", () => {
    localStorage.setItem(
      "janosik-board-glass",
      JSON.stringify({ transparency: 100, blur: 12 }),
    );

    renderSwitcher();
    openMenu();

    expect(screen.getByTestId("glass-opacity")).toHaveValue("100");
    expect(screen.getByTestId("glass-blur")).toHaveValue("12");
    expect(
      document.documentElement.style.getPropertyValue(
        "--janosik-glass-transparency",
      ),
    ).toBe("100");
    expect(
      document.documentElement.style.getPropertyValue("--janosik-glass-blur"),
    ).toBe("12px");
  });
});
