import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import {
  BoardProvider,
  useBoardActions,
  useBoardState,
} from "@/store/BoardContext";
import { ToastProvider } from "@/components/Toast";

/**
 * U-6 / U-3 for the card description: a change made elsewhere while the
 * dialog is open is surfaced instead of being overwritten on blur, and a
 * staged draft is saved when the page is hidden or unloaded.
 */

vi.mock("@/components/editor/DescriptionEditor", () => {
  return import("react").then(({ forwardRef }) => ({
    // Uncontrolled like the real MDXEditor: `value` is read on mount only.
    DescriptionEditor: forwardRef(function MockedDescriptionEditor({
      value,
      onChange,
    }: {
      value: string;
      onChange: (markdown: string) => void;
    }) {
      return (
        <textarea
          aria-label="Description"
          defaultValue={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }),
  }));
});

const TITLE = "Design the new onboarding flow";

/** Someone else (another member, an agent, an undo) edits the card. */
function ExternalWriter() {
  const { board } = useBoardState();
  const { updateCard } = useBoardActions();
  const card = Object.values(board?.cards ?? {}).find(
    (entry) => entry.title === TITLE,
  );
  return (
    <>
      <div data-testid="stored-description">{card?.description ?? ""}</div>
      <button
        type="button"
        data-testid="external-edit"
        onClick={() => {
          if (card) updateCard(card.id, { description: "Theirs" });
        }}
      />
    </>
  );
}

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
                    <ExternalWriter />
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

async function openEditor() {
  renderBoard();
  fireEvent.click(screen.getByText(TITLE));
  const dialog = await screen.findByRole("dialog");
  const editor = (await within(dialog).findByLabelText(
    "Description",
  )) as HTMLTextAreaElement;
  return { dialog, editor };
}

const stored = () => screen.getByTestId("stored-description").textContent;

describe("CardDialog description vs. changes made elsewhere (U-6)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reloads an untouched editor silently", async () => {
    const { dialog } = await openEditor();
    fireEvent.click(screen.getByTestId("external-edit"));
    const editor = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(editor.value).toBe("Theirs");
    expect(within(dialog).queryByTestId("card-description-conflict")).toBe(
      null,
    );
  });

  it("asks before overwriting: blur keeps theirs, «Keep mine» commits mine", async () => {
    const { dialog, editor } = await openEditor();
    fireEvent.change(editor, { target: { value: "Mine" } });
    fireEvent.click(screen.getByTestId("external-edit"));

    const notice = await within(dialog).findByTestId(
      "card-description-conflict",
    );
    expect(notice.textContent).toContain("Someone else changed");
    // Leaving the editor no longer clobbers the other change silently.
    fireEvent.blur(editor);
    expect(stored()).toBe("Theirs");

    fireEvent.click(
      within(dialog).getByTestId("card-description-conflict-keep"),
    );
    expect(stored()).toBe("Mine");
    expect(within(dialog).queryByTestId("card-description-conflict")).toBe(
      null,
    );
  });

  it("«Reload» drops my draft and shows the stored text", async () => {
    const { dialog, editor } = await openEditor();
    fireEvent.change(editor, { target: { value: "Mine" } });
    fireEvent.click(screen.getByTestId("external-edit"));
    fireEvent.click(
      await within(dialog).findByTestId("card-description-conflict-reload"),
    );
    const reloaded = (await within(dialog).findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    expect(reloaded.value).toBe("Theirs");
    // Closing the dialog afterwards commits nothing of the dropped draft.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(stored()).toBe("Theirs");
  });
});

describe("CardDialog description draft on page hide (U-3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("commits a staged draft on pagehide, without a blur", async () => {
    const { editor } = await openEditor();
    fireEvent.change(editor, { target: { value: "Typed, never blurred" } });
    expect(stored()).not.toBe("Typed, never blurred");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(stored()).toBe("Typed, never blurred");
  });

  it("commits a staged draft when the tab is hidden", async () => {
    const { editor } = await openEditor();
    fireEvent.change(editor, { target: { value: "Hidden tab" } });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      visibility.mockRestore();
    }
    expect(stored()).toBe("Hidden tab");
  });
});
