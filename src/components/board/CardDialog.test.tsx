import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

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
        <I18nProvider>
          <TooltipProvider>
            <BoardProvider>
              <BoardSection />
            </BoardProvider>
          </TooltipProvider>
        </I18nProvider>
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

describe("CardDialog due dates", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Click a calendar day (by its day-of-month text) inside the popover. */
  async function pickDay(
    user: ReturnType<typeof userEvent.setup>,
    day: string,
  ) {
    const target = [...document.querySelectorAll("button[data-day]")].find(
      (b) => b.textContent === day,
    );
    expect(target).toBeDefined();
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
        screen.getAllByTestId("card-cover").some(
          (el) => el.getAttribute("data-cover-type") === "gradient",
        ),
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

describe("CardDialog checklists", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a checklist with items and shows progress on the card", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // Create a checklist via the section header button.
    fireEvent.click(within(dialog).getByText("Add checklist"));
    const checklistCard = within(dialog).getByText("Checklist").closest(
      "[class*='rounded-lg border']",
    );
    expect(checklistCard).not.toBeNull();

    // Add an item through the inline composer.
    const input = within(checklistCard as HTMLElement).getByPlaceholderText(
      "Add an item…",
    );
    fireEvent.change(input, { target: { value: "Draft the copy" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(within(dialog).getByText("Draft the copy")).toBeInTheDocument();

    // Toggle it done — the progress counter and the card badge flip to 1/1.
    fireEvent.click(within(dialog).getByText("Draft the copy")
      .closest("li")!
      .querySelector("button") as HTMLButtonElement);
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
    await user.click(
      within(confirmAgain).getByText("Delete", { exact: true }),
    );
    expect(
      within(dialog).queryByText("Draft the copy"),
    ).not.toBeInTheDocument();
  });
});
