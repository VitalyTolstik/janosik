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
import { api } from "@/api/client";

/**
 * Integration test for the card description editor (MDXEditor): opening a
 * card shows the WYSIWYG editor seeded with the stored markdown; edits are
 * streamed into the board state (and survive a dialog reopen).
 *
 * The real MDXEditor (Lexical) is stubbed — it needs a full browser layout
 * engine; the editor itself is covered by the library's own test suite.
 */

const { inserted } = vi.hoisted(() => ({
  inserted: { markdown: [] as string[] },
}));

vi.mock("@/components/editor/DescriptionEditor", () => {
  return import("react").then(({ forwardRef, useImperativeHandle }) => ({
    // The real editor is stubbed — it needs a full browser layout engine.
    // The imperative surface (paste embedding) is part of the contract.
    DescriptionEditor: forwardRef(function MockedDescriptionEditor(
      {
        value,
        onChange,
      }: {
        value: string;
        onChange: (markdown: string) => void;
      },
      ref: React.Ref<{ insertMarkdown: (markdown: string) => void }>,
    ) {
      useImperativeHandle(ref, () => ({
        insertMarkdown: (markdown: string) => {
          inserted.markdown.push(markdown);
        },
      }));
      // Uncontrolled on purpose: the real MDXEditor reads `value` once and
      // owns its state, staging edits until the blur-commit lands.
      return (
        <textarea
          aria-label="Description"
          data-testid="description-editor"
          defaultValue={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }),
  }));
});

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

    // The editor is seeded with the card's markdown. `DescriptionEditor` is
    // lazily imported, so wait for the Suspense boundary to resolve.
    const editor = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(editor.value).toContain("**bold**");

    // An edit reaches the board state…
    fireEvent.change(editor, { target: { value: "Updated via MDXEditor" } });
    expect(editor.value).toBe("Updated via MDXEditor");

    // …and survives closing + reopening the dialog.
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByText("Design the new onboarding flow"));
    const reopened = await screen.findByRole("dialog");
    const editorAgain = (await within(reopened).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(editorAgain.value).toBe("Updated via MDXEditor");
  });

  it("commits the description once — on blur, not per keystroke", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");
    const editor = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    // Two edits with a pause between them stage locally…
    fireEvent.change(editor, { target: { value: "First part." } });
    fireEvent.change(editor, { target: { value: "First part. Second part." } });

    // …and leaving the editor is what lands a single update.
    fireEvent.blur(editor);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByText("Design the new onboarding flow"));
    const reopened = await screen.findByRole("dialog");
    const editorAgain = (await within(reopened).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(editorAgain.value).toBe("First part. Second part.");
  });

  it("uploads a pasted image as a card attachment (Jira-style)", async () => {
    inserted.markdown.length = 0;
    const upload = vi.spyOn(api, "uploadAttachment").mockResolvedValue({
      id: "att-paste",
      cardId: "card-1",
      fileName: "pasted.png",
      mimeType: "image/png",
      sizeBytes: 4,
      uploadedById: "user-1",
      transcodeStatus: "none",
      createdAt: 0,
    });
    const dialog = await openCardDialog("Design the new onboarding flow");
    const editor = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    const before = editor.value;

    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["bits"], "pasted.png", { type: "image/png" })],
      },
    });

    await waitFor(() => {
      expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(File));
    });
    // The image embeds into the description markdown at the cursor…
    await waitFor(() => {
      expect(inserted.markdown[0]).toBe(
        "\n\n![pasted.png](/api/v1/attachments/att-paste/content)\n\n",
      );
    });
    // …and the description text itself is untouched by an image paste.
    expect(editor.value).toBe(before);
  });

  it("embeds a pasted non-image file as a download link attachment", async () => {
    inserted.markdown.length = 0;
    const upload = vi.spyOn(api, "uploadAttachment").mockResolvedValue({
      id: "att-file",
      cardId: "card-1",
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      uploadedById: "user-1",
      transcodeStatus: "none",
      createdAt: 0,
    });
    await openCardDialog("Design the new onboarding flow");
    const editor = await screen.findByLabelText("Description");

    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["bits"], "spec.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(File));
      expect(inserted.markdown[0]).toBe(
        "\n\n[spec.pdf](/api/v1/attachments/att-file/content)\n\n",
      );
    });
  });
});

describe("CardDialog collapsible sections (TASK-44)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("collapses and reopens the description without losing content", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");
    await within(dialog).findByLabelText("Description");

    const toggle = within(dialog).getByTestId("card-description-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByLabelText("Description")).toBeNull();

    // Reopening remounts the lazy editor seeded from the board state.
    fireEvent.click(toggle);
    const editor = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(editor.value).toContain("**bold**");
  });

  it("expands when a checklist is added from the collapsed header", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    const toggle = within(dialog).getByTestId("checklists-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The action stays reachable and reveals what it just created.
    fireEvent.click(within(dialog).getByText("Add checklist"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("Checklist")).toBeInTheDocument();
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

describe("CardDialog priority", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sets a priority from the dropdown and shows the badge on the card", async () => {
    const user = userEvent.setup();
    const dialog = await openCardDialog("Design the new onboarding flow");

    // The trigger starts at the default…
    expect(within(dialog).getByTestId("priority-trigger")).toHaveTextContent(
      "Medium",
    );

    // …picking a level applies it at once…
    await user.click(within(dialog).getByTestId("priority-trigger"));
    await user.click(screen.getByTestId("priority-option-blocker"));

    // …and the card face shows the colored badge.
    await waitFor(() => {
      expect(
        screen.getAllByTestId("card-priority-badge").length,
      ).toBeGreaterThan(0);
    });
    expect(within(dialog).getByTestId("priority-trigger")).toHaveTextContent(
      "Blocker",
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

    // The items area is capped (TASK-44): a long checklist scrolls inside
    // instead of stretching the card dialog beyond the viewport.
    expect(
      within(dialog).getByText("Draft the copy").closest("ul"),
    ).toHaveClass("max-h-48", "overflow-y-auto");
  });

  it("collapses one checklist without hiding the others", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    // Two checklists, one item each.
    fireEvent.click(within(dialog).getByText("Add checklist"));
    let input = within(dialog).getAllByPlaceholderText("Add an item…")[0];
    fireEvent.change(input, { target: { value: "First item" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    fireEvent.click(within(dialog).getByText("Add checklist"));
    input = within(dialog).getAllByPlaceholderText("Add an item…")[1];
    fireEvent.change(input, { target: { value: "Second item" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    // Both checklists share the default title; toggle the first one.
    const toggles = within(dialog).getAllByRole("button", {
      name: "Checklist",
    });
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[0]);

    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByText("First item")).toBeNull();
    expect(within(dialog).getByText("Second item")).toBeInTheDocument();
    // The progress line stays readable while folded.
    expect(within(dialog).getAllByText("0 of 1 task")).toHaveLength(2);

    fireEvent.click(toggles[0]);
    expect(within(dialog).getByText("First item")).toBeInTheDocument();
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

describe("CardDialog archive", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the dialog open so the card can go back to the board at once", async () => {
    const dialog = await openCardDialog("Design the new onboarding flow");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Archive" }),
    );

    // The card leaves the board but the dialog stays, offering the restore.
    const openDialog = await screen.findByRole("dialog");
    await within(openDialog).findByRole("button", {
      name: "Send back to board",
    });
    expect(within(openDialog).getByLabelText("Title")).toBeInTheDocument();
  });
});
