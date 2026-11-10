import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import {
  COLUMN_ACCENT_STYLES,
  type Board,
  type ColumnAccentStyle,
} from "@janosik/shared";

const STORAGE_KEY = "janosik-boards";

function board(columnStyle?: ColumnAccentStyle): Board {
  return {
    id: "b-accent",
    title: "Accent",
    ...(columnStyle ? { columnStyle } : {}),
    columns: [
      {
        id: "col-1",
        title: "Todo",
        cardIds: [],
        accent: { type: "color", value: "brand" },
        createdAt: 1,
      },
      { id: "col-2", title: "Done", cardIds: [], createdAt: 1 },
    ],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function tree() {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-accent"]}>
                <ToastProvider>
                  <BoardProvider>
                    <DndBoard onCardClick={() => {}} />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

function accentSection(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    'section[data-column-accent="brand"]',
  );
}

describe("ColumnView accent shapes (TASK-164)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(COLUMN_ACCENT_STYLES)(
    "applies the %s shape class only to the accented column",
    (style) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([board(style)]));
      const { container } = render(tree());

      const section = accentSection(container);
      expect(section).not.toBeNull();
      expect(section).toHaveClass(`janosik-column-accent-${style}`);
      expect(section).toHaveAttribute("data-column-accent-style", style);
      expect(section).toHaveAttribute("data-column-accent-type", "color");

      const plain = container.querySelector<HTMLElement>(
        'section:not([data-column-accent="brand"])',
      );
      expect(plain).not.toBeNull();
      expect(plain?.className).not.toContain("janosik-column-accent-");
      expect(plain).toHaveAttribute("data-column-accent", "none");
      expect(plain).toHaveAttribute("data-column-accent-style", "none");
    },
  );

  it("ignores the shape while the column has no accent", () => {
    const plain = board("band");
    plain.columns[0] = { ...plain.columns[0], accent: undefined };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([plain]));
    const { container } = render(tree());

    const section = container.querySelector<HTMLElement>("section");
    expect(section).toHaveAttribute("data-column-accent-style", "none");
    expect(section?.className).not.toContain("janosik-column-accent-band");
  });
});
