import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { CardDialog } from "@/components/board/CardDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

vi.mock("@/components/editor/DescriptionEditor", () => ({
  DescriptionEditor: () => <div data-testid="description-editor" />,
}));

/**
 * The card dialog's copy-link affordance and the Activity section placement
 * (TASK-37): the button copies the address bar verbatim — every open path
 * carries `?card=<id>` — and the thread is the dialog's last section.
 */

const SAMPLE_BOARD: Board = {
  id: "b-1",
  title: "Link board",
  columns: [{ id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Careful card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function tree(children: React.ReactNode) {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={["/board/b-1"]}>
                  <BoardProvider>{children}</BoardProvider>
                </MemoryRouter>
              </ToastProvider>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("janosik-boards", JSON.stringify([SAMPLE_BOARD]));
});

afterEach(() => {
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("CardDialog copy link (TASK-37)", () => {
  it("copies the current deep link and confirms with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(tree(<CardDialog cardId="card-1" open onOpenChange={() => {}} />));

    fireEvent.click(screen.getByTestId("card-copy-link"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(window.location.href),
    );
    expect(await screen.findByText("Card link copied")).toBeInTheDocument();
  });

  it("keeps the Activity section last, opened on Comments", async () => {
    render(tree(<CardDialog cardId="card-1" open onOpenChange={() => {}} />));
    const region = screen.getByTestId("activity-toggle");
    expect(screen.getByTestId("activity-tab-comments")).toBeInTheDocument();
    expect(region.closest("section")).toHaveAttribute("data-expanded", "true");

    fireEvent.pointerDown(screen.getByTestId("activity-more"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId("activity-more-history"));
    expect(
      await screen.findByTestId("activity-tab-history"),
    ).toBeInTheDocument();
  });
});
