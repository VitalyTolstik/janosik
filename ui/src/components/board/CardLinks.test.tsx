import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { ToastProvider } from "@/components/Toast";

/**
 * Card links (TASK-46) end to end through the real store: the Jira-style
 * autocomplete adds a row, the pair disappears from suggestions, removing
 * works from either side of the relation, a `blocks` cycle is refused with
 * a toast, and the card front grows the link counter and the red "Blocked"
 * badge.
 */

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter>
                <ToastProvider>
                  <BoardProvider>
                    <BoardSection />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openCardDialog(title: string) {
  fireEvent.click(screen.getByText(title));
  return await screen.findByRole("dialog");
}

async function linkCard(dialog: HTMLElement, query: string) {
  const input = within(dialog).getByTestId("card-links-input");
  await userEvent.type(input, query);
  const list = await within(dialog).findByTestId("card-links-suggestions");
  // The suggestion text is split by the <mark> highlight — click the row.
  fireEvent.click(within(list).getAllByTestId("card-links-suggestion")[0]);
}

async function chooseRelation(dialog: HTMLElement, option: string) {
  await userEvent.click(within(dialog).getByTestId("card-links-type"));
  await userEvent.click(await screen.findByTestId(`card-links-type-${option}`));
}

describe("CardLinks (TASK-46)", () => {
  it("adds a link through the autocomplete and shows it on both cards", async () => {
    renderBoard();
    const dialog = await openCardDialog("Set up CI/CD pipeline");

    await linkCard(dialog, "Fix critical");
    // The row lands under "relates to", the input resets.
    expect(await within(dialog).findByTestId("card-link-row")).toHaveAttribute(
      "data-link-type",
      "relates_to",
    );
    expect(within(dialog).getByTestId("card-links-input")).toHaveValue("");

    // Opening the linked card re-points the `?card=` deep link; the dialog
    // then reads the same pair from the other end.
    await userEvent.click(screen.getAllByTestId("card-link-open")[0]);
    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByTestId("card-link-row"),
      ).toHaveTextContent("Set up CI/CD pipeline");
    });
  });

  it("hides an already-linked card from the suggestions", async () => {
    renderBoard();
    const dialog = await openCardDialog("Set up CI/CD pipeline");
    await linkCard(dialog, "Fix critical");

    const input = within(dialog).getByTestId("card-links-input");
    await userEvent.type(input, "Fix");
    // The only "Fix critical …" card is taken — no suggestions remain.
    expect(within(dialog).queryByTestId("card-links-suggestions")).toBeNull();
  });

  it("removes a link and falls back to the empty state", async () => {
    renderBoard();
    const dialog = await openCardDialog("Set up CI/CD pipeline");
    await linkCard(dialog, "Fix critical");
    expect(await within(dialog).findByTestId("card-link-row")).toBeDefined();

    fireEvent.click(within(dialog).getByTestId("card-link-remove"));
    expect(await within(dialog).findByTestId("card-links-empty")).toBeDefined();
  });

  it("refuses a blocks cycle with a toast and lights the Blocked badge", async () => {
    renderBoard();
    // A chain: card-2 blocks card-5, card-5 blocks card-4.
    let dialog = await openCardDialog("Set up CI/CD pipeline");
    await chooseRelation(dialog, "blocks");
    await linkCard(dialog, "Fix critical");
    expect(await within(dialog).findByTestId("card-link-row")).toHaveAttribute(
      "data-link-type",
      "blocks",
    );
    await userEvent.keyboard("{Escape}");

    dialog = await openCardDialog("Fix critical auth bug");
    await chooseRelation(dialog, "blocks");
    await linkCard(dialog, "flaky");
    // Two rows now: the outgoing blocks row AND the incoming "is blocked
    // by" one (stored on card-2).
    const rows = await within(dialog).findAllByTestId("card-link-row");
    expect(
      rows.some((row) => row.getAttribute("data-link-type") === "blocks"),
    ).toBe(true);
    await userEvent.keyboard("{Escape}");

    // The target's front carries the red badge and the link counter.
    const target = screen
      .getByText("Fix critical auth bug")
      .closest("article") as HTMLElement;
    expect(within(target).getByTestId("card-blocked-badge")).toBeDefined();
    expect(within(target).getByTestId("card-links-badge")).toHaveTextContent(
      "2",
    );

    // Closing the circle (card-4 blocks card-2) is refused with a toast;
    // card-4 still only holds its incoming "is blocked by" row.
    dialog = await openCardDialog("Investigate flaky test suite");
    await chooseRelation(dialog, "blocks");
    await linkCard(dialog, "CI/CD");
    expect(await screen.findByText(/circular dependency/i)).toBeDefined();
    expect(within(dialog).getAllByTestId("card-link-row")).toHaveLength(1);
  });
});
