import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ColumnStyleMenu } from "@/components/board/ColumnStyleMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { COLUMN_ACCENT_STYLES } from "@janosik/shared";

function renderMenu(value: (typeof COLUMN_ACCENT_STYLES)[number] = "rail") {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <TooltipProvider>
        <ColumnStyleMenu value={value} onChange={onChange} />
      </TooltipProvider>
    </I18nProvider>,
  );
  return onChange;
}

function openMenu() {
  // Radix DropdownMenu opens on pointerdown, not click.
  fireEvent.pointerDown(screen.getByTestId("column-style-menu"), {
    button: 0,
  });
}

describe("ColumnStyleMenu (TASK-164)", () => {
  it("lists all nine shapes with the current one checked", async () => {
    renderMenu("glass");
    openMenu();

    for (const style of COLUMN_ACCENT_STYLES) {
      expect(
        await screen.findByTestId(`column-style-menu-${style}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId("column-style-menu-glass")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("column-style-menu-band")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("applies a shape live and keeps the menu open", async () => {
    const onChange = renderMenu("rail");
    openMenu();

    fireEvent.click(await screen.findByTestId("column-style-menu-band"));
    expect(onChange).toHaveBeenCalledWith("band");
    // The item prevents the default close so shapes can be compared live.
    expect(screen.getByTestId("column-style-menu-band")).toBeInTheDocument();
  });
});
