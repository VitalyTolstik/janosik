import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/export-size", () => ({
  estimateBoardExportBytes: () => estimateValue.value,
}));

const estimateValue = vi.hoisted(() => ({ value: 26 * 1024 * 1024 }));

import { DataMenu } from "@/components/DataMenu";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider } from "@/store/BoardContext";

function renderMenu() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={[routes.board("b-1")]}>
                  <BoardProvider>
                    <Routes>
                      <Route
                        path={routes.boardPattern}
                        element={<DataMenu />}
                      />
                    </Routes>
                  </BoardProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("DataMenu export limit (TASK-166.6)", () => {
  beforeEach(() => {
    estimateValue.value = 26 * 1024 * 1024;
    localStorage.clear();
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "b-1",
          title: "Alpha",
          columns: [{ id: "col-1", title: "To do", cardIds: [], createdAt: 1 }],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
  });

  it("allows a rough estimate above 25 MB when the exact file is smaller", async () => {
    renderMenu();
    await userEvent.click(
      screen.getByRole("button", { name: "Data & backups" }),
    );
    await userEvent.click(await screen.findByText("Export JSON"));
    expect(await screen.findByText("Board exported")).toBeInTheDocument();
    expect(screen.queryByText(/larger than 25 MB/)).toBeNull();
  });

  it("refuses a grossly oversized combined export before serialization", async () => {
    estimateValue.value = 101 * 1024 * 1024;
    renderMenu();
    await userEvent.click(
      screen.getByRole("button", { name: "Data & backups" }),
    );
    await userEvent.click(await screen.findByText("Export JSON"));
    expect(await screen.findByText(/larger than 25 MB/)).toBeInTheDocument();
  });
});
