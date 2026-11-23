import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

const loader = vi.hoisted(() => {
  const failure = new Error("saved views chunk unavailable");
  const rejection = Promise.reject(failure);
  // The boundary handles it; mark it observed so Vitest does not report an
  // extra unhandled rejection on top of React's development log.
  void rejection.catch(() => {});
  return { failure, loadSavedViewsMenu: vi.fn(() => rejection) };
});

vi.mock("@/components/board/saved-views-loader", () => ({
  loadSavedViewsMenu: loader.loadSavedViewsMenu,
}));

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/"]}>
                  <BoardProvider>
                    <BoardSection />
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saved views chunk failure", () => {
  it("keeps the board usable and reports the boundary fallback", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBoard();

    expect(
      await screen.findByText("Design the new onboarding flow"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();

    expect(loader.loadSavedViewsMenu).toHaveBeenCalled();
    const firstLoad = loader.loadSavedViewsMenu.mock.results[0]?.value;
    await expect(firstLoad).rejects.toThrow(loader.failure.message);

    const unavailable = await screen.findByTestId(
      "saved-views-menu-unavailable",
    );
    expect(unavailable).toHaveTextContent(
      "Saved views are unavailable in this browser.",
    );
    // The failed boundary keeps the same 36/44 px slot as the trigger.
    const placeholder = screen.getByTestId("saved-views-menu-placeholder");
    expect(placeholder).toHaveClass(
      "h-9",
      "w-9",
      "shrink-0",
      "max-lg:h-11",
      "max-lg:w-11",
    );
    expect(screen.queryByTestId("saved-views-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-compact")).not.toBeInTheDocument();
    expect(
      errorLog.mock.calls.some(([message]) =>
        String(message).includes("[saved-views]"),
      ),
    ).toBe(true);
  });
});
