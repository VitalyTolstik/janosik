import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { ToastProvider } from "@/components/Toast";

/**
 * Integration test for the card description editor (MDXEditor): opening a
 * card shows the WYSIWYG editor seeded with the stored markdown; edits are
 * streamed into the board state (and survive a dialog reopen).
 *
 * The real MDXEditor (Lexical) is stubbed — it needs a full browser layout
 * engine; the editor itself is covered by the library's own test suite.
 */

vi.mock("@/components/editor/DescriptionEditor", () => ({
  DescriptionEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Description"
      data-testid="description-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

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
  renderBoard();
  fireEvent.click(screen.getByText(title));
  // Radix Dialog renders into a portal — find the dialog content.
  const dialog = await screen.findByRole("dialog");
  return dialog;
}

describe("CardDialog description editor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens with the stored markdown and streams edits into the board", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The editor is seeded with the card's markdown.
    const editor = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(editor.value).toContain("**bold**");

    // An edit reaches the board state…
    fireEvent.change(editor, { target: { value: "Updated via MDXEditor" } });
    expect(editor.value).toBe("Updated via MDXEditor");

    // …and survives closing + reopening the dialog.
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByText("Design the new onboarding flow"));
    const reopened = await screen.findByRole("dialog");
    const editorAgain = within(reopened).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(editorAgain.value).toBe("Updated via MDXEditor");
  });
});

describe("CardDialog input limits (TASK-20)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the remaining-characters counter near the title limit", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");
    // No counter while the title is short.
    expect(within(dialog).queryByTestId("card-title-counter")).toBeNull();

    // Typing up to the last 60 chars reveals the live counter.
    const title = within(dialog).getByLabelText("Title");
    const longTitle = "T".repeat(299);
    fireEvent.change(title, { target: { value: longTitle } });
    const counter = within(dialog).getByTestId("card-title-counter");
    expect(counter).toHaveTextContent("1");
  });

  it("clamps an oversized description paste and raises a visible toast", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");
    const { LIMITS } = await import("@janosik/shared");

    const editor = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: "D".repeat(LIMITS.description + 100) },
    });

    // The stored markdown is clamped to the limit… (re-query: the editor
    // remounts on overflow so its DOM resyncs with the clamped store)
    const clamped = within(dialog).getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    expect(clamped.value).toHaveLength(LIMITS.description);
    // …and a beautiful error explains what happened.
    expect(
      await screen.findByText(
        /Too long — the limit is 10000 characters. The text was trimmed./,
      ),
    ).toBeInTheDocument();
  });
});

describe("CardDialog due dates", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Click a calendar day (by its day-of-month text) inside the popover.
      The calendar is lazy (TASK-19) — wait for the chunk to resolve. */
  async function pickDay(
    user: ReturnType<typeof userEvent.setup>,
    day: string,
  ) {
    // The calendar arrives in a lazy chunk (TASK-19); under full-suite load
    // its import can exceed the 1 s default waitFor timeout.
    await waitFor(
      () => {
        expect(
          [...document.querySelectorAll("button[data-day]")].some(
            (b) => b.textContent === day,
          ),
        ).toBe(true);
      },
      { timeout: 15_000 },
    );
    const target = [...document.querySelectorAll("button[data-day]")].find(
      (b) => b.textContent === day,
    );
    await user.click(target as HTMLElement);
  }

  it("sets a due date from the calendar and shows it on the card", async () => {
    const user = userEvent.setup();
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The trigger starts as a placeholder…
    const trigger = within(dialog).getByTestId("due-date-trigger");
    expect(trigger).toHaveTextContent("Set due date");

    // …the popover with the calendar opens, picking a day applies it at once.
    await user.click(trigger);
    await pickDay(user, "15");

    // The badge on the card shows the deadline…
    await waitFor(() => {
      expect(screen.getAllByTestId("card-due-badge").length).toBeGreaterThan(0);
    });

    // …and the trigger shows the full date, with a remove action available
    // (the popover portals into <body>, outside the dialog element).
    expect(
      within(dialog).getByTestId("due-date-trigger"),
    ).not.toHaveTextContent("Set due date");
    expect(screen.getByTestId("due-date-remove")).toBeInTheDocument();
  });

  it("clears an existing due date", async () => {
    const user = userEvent.setup();
    const dialog = await openCardDialog("Design the new onboarding flow");

    await user.click(within(dialog).getByTestId("due-date-trigger"));
    await pickDay(user, "15");
    await waitFor(() => {
      expect(screen.getAllByTestId("card-due-badge").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("due-date-remove"));
    expect(screen.queryByTestId("card-due-badge")).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("due-date-trigger")).toHaveTextContent(
      "Set due date",
    );
  });
});

describe("CardDialog cover", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies a gradient cover and renders it on the card", async () => {
    const user = userEvent.setup();
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The trigger starts as a placeholder…
    expect(within(dialog).getByTestId("cover-trigger")).toHaveTextContent(
      "Set cover",
    );

    // …picking a gradient applies it at once.
    await user.click(within(dialog).getByTestId("cover-trigger"));
    await user.click(await screen.findByRole("radio", { name: "Sunset" }));

    // The gradient cover band appears on the card behind the dialog…
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("card-cover")
          .some((el) => el.getAttribute("data-cover-type") === "gradient"),
      ).toBe(true);
    });

    // …and the trigger switches to the "change" state.
    expect(within(dialog).getByTestId("cover-trigger")).toHaveTextContent(
      "Change cover",
    );

    // Removing clears the cover.
    await user.click(screen.getByTestId("cover-remove"));
    await waitFor(() => {
      expect(screen.queryByTestId("card-cover")).not.toBeInTheDocument();
    });
    expect(within(dialog).getByTestId("cover-trigger")).toHaveTextContent(
      "Set cover",
    );
  });
});

describe("CardDialog duplicate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("duplicates a card from the dialog: copy appears right below the original", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Duplicate card" }),
    );
    // Dialog closes and the copy renders on the board below the original.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const copies = screen.getAllByText(
      "Copy of Design the new onboarding flow",
    );
    expect(copies).toHaveLength(1);
    // The original is still there.
    expect(
      screen.getByText("Design the new onboarding flow"),
    ).toBeInTheDocument();
  });
});

describe("CardDialog checklists", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a checklist with items and shows progress on the card", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // Create a checklist via the section header button.
    fireEvent.click(within(dialog).getByText("Add checklist"));
    const checklistCard = within(dialog)
      .getByText("Checklist")
      .closest("[class*='rounded-lg border']");
    expect(checklistCard).not.toBeNull();

    // Add an item through the inline composer.
    const input = within(checklistCard as HTMLElement).getByPlaceholderText(
      "Add an item…",
    );
    fireEvent.change(input, { target: { value: "Draft the copy" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(within(dialog).getByText("Draft the copy")).toBeInTheDocument();

    // Toggle it done — the progress counter and the card badge flip to 1/1.
    fireEvent.click(
      within(dialog)
        .getByText("Draft the copy")
        .closest("li")!
        .querySelector("button") as HTMLButtonElement,
    );
    expect(within(dialog).getByText("1 of 1 task")).toBeInTheDocument();
    const badges = screen.getAllByTestId("card-checklist-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe("1/1");
  });

  it("asks for confirmation before deleting a checklist", async () => {
    const user = userEvent.setup();
    const dialog = await openCardDialog("Design the new onboarding flow");

    await user.click(within(dialog).getByText("Add checklist"));
    const input = within(dialog).getByPlaceholderText("Add an item…");
    fireEvent.change(input, { target: { value: "Draft the copy" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    // Open the checklist menu and hit Delete.
    await user.click(within(dialog).getByLabelText("Checklist actions"));
    await user.click(await screen.findByText("Delete checklist"));

    // The confirm dialog appears with the item count…
    const confirm = await screen.findByRole("dialog", {
      name: /Delete this checklist/i,
    });
    expect(
      within(confirm).getByText(/1 item will be permanently deleted/),
    ).toBeInTheDocument();

    // …Cancel keeps the checklist…
    await user.click(within(confirm).getByText("Cancel"));
    expect(within(dialog).getByText("Draft the copy")).toBeInTheDocument();

    // …and confirming removes it.
    await user.click(within(dialog).getByLabelText("Checklist actions"));
    await user.click(await screen.findByText("Delete checklist"));
    const confirmAgain = await screen.findByRole("dialog", {
      name: /Delete this checklist/i,
    });
    await user.click(within(confirmAgain).getByText("Delete", { exact: true }));
    expect(
      within(dialog).queryByText("Draft the copy"),
    ).not.toBeInTheDocument();
  });
});

describe("CardDialog duplicate (column limits)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function seedBoard(wipLimit?: number) {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "b-1",
          title: "Limits board",
          columns: [
            {
              id: "col-1",
              title: "Packed",
              cardIds: ["card-1"],
              wipLimit,
              createdAt: 0,
            },
          ],
          cards: {
            "card-1": {
              id: "card-1",
              title: "Packed card",
              labelIds: [],
              createdAt: 0,
              updatedAt: 0,
            },
          },
          labels: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
    );
  }

  it("disables Duplicate card when the column's WIP limit is reached", async () => {
    seedBoard(1);
    renderBoard();
    fireEvent.click(await screen.findByText("Packed card"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Duplicate card" }),
    ).toBeDisabled();
  });

  it("keeps Duplicate card enabled while the column has room", async () => {
    seedBoard(undefined);
    renderBoard();
    fireEvent.click(await screen.findByText("Packed card"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Duplicate card" }),
    ).toBeEnabled();
  });
});

describe("CardDialog move (column limits)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function seedBoard() {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "b-1",
          title: "Limits board",
          columns: [
            { id: "col-1", title: "Home", cardIds: ["card-1"], createdAt: 0 },
            {
              id: "col-2",
              title: "Full",
              cardIds: ["card-2"],
              wipLimit: 1,
              createdAt: 0,
            },
            { id: "col-3", title: "Roomy", cardIds: [], createdAt: 0 },
          ],
          cards: {
            "card-1": {
              id: "card-1",
              title: "Moving card",
              labelIds: [],
              createdAt: 0,
              updatedAt: 0,
            },
            "card-2": {
              id: "card-2",
              title: "Occupant",
              labelIds: [],
              createdAt: 0,
              updatedAt: 0,
            },
          },
          labels: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
    );
  }

  it("disables the move target that is over its WIP limit", async () => {
    seedBoard();
    renderBoard();
    fireEvent.click(await screen.findByText("Moving card"));
    await screen.findByRole("dialog");
    // Radix DropdownMenu opens on pointerdown, not click.
    await userEvent.click(screen.getByRole("button", { name: "Home" }));

    // Radix menu items signal via aria-disabled, not the disabled attribute.
    const full = await screen.findByRole("menuitem", { name: /Full/ });
    expect(full).toHaveAttribute("aria-disabled", "true");
    expect(full).toHaveTextContent("1/1");
    expect(screen.getByRole("menuitem", { name: /Roomy/ })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("CardDialog delete confirmation (TASK-21.11)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("deletes the card through the nested confirmation", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete card" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete this card?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Design the new onboarding flow")).toBeNull(),
    );
  });

  it("drops a cancelled confirmation on reopen (reset by remount)", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete card" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete this card?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Delete this card?" }),
    ).toBeNull();

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByText("Design the new onboarding flow"));
    await screen.findByRole("dialog");

    expect(
      screen.queryByRole("dialog", { name: "Delete this card?" }),
    ).toBeNull();
  });
});
