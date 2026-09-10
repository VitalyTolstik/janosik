import { fireEvent, render, screen, within } from "@testing-library/react";
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
