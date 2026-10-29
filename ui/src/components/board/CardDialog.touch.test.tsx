import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDialog } from "@/components/board/CardDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";

/**
 * The dialog's quiet `TOUCH_CARD` debounce (finding B-3): the deferred stamp
 * must belong to the card that was edited, must survive the dialog closing,
 * and must never land on a card the user opened in the meantime.
 */

// The real MDXEditor (Lexical) needs a browser layout engine — stub it, as
// the other CardDialog test does.
vi.mock("@/components/editor/DescriptionEditor", () => {
  return import("react").then(({ forwardRef }) => ({
    // forwardRef: the card dialog passes a ref for paste-embedding.
    DescriptionEditor: forwardRef(function MockedDescriptionEditor(
      {
        value,
        onChange,
      }: {
        value: string;
        onChange: (markdown: string) => void;
      },
      _ref: unknown,
    ) {
      return (
        <textarea
          aria-label="Description"
          data-testid="description-editor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }),
  }));
});

const QUIET_TOUCH_DELAY_MS = 800;

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Touches",
        columns: [
          {
            id: "col-1",
            title: "To do",
            cardIds: ["card-a", "card-b"],
            createdAt: 1,
          },
        ],
        cards: {
          "card-a": {
            id: "card-a",
            title: "Card A",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          "card-b": {
            id: "card-b",
            title: "Card B",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

/** Drives the dialog's open card and exposes both cards' `updatedAt`. */
function Harness() {
  const { board, updateCard } = useBoard();
  const [cardId, setCardId] = useState<string | null>(null);
  return (
    <>
      <button data-testid="open-a" onClick={() => setCardId("card-a")}>
        open a
      </button>
      <button data-testid="open-b" onClick={() => setCardId("card-b")}>
        open b
      </button>
      <button data-testid="close" onClick={() => setCardId(null)}>
        close
      </button>
      <button
        data-testid="rename-a-elsewhere"
        onClick={() =>
          updateCard("card-a", { title: "Theirs" }, { quiet: true })
        }
      >
        rename a elsewhere
      </button>
      <CardDialog
        cardId={cardId}
        open={cardId !== null}
        onOpenChange={(open) => {
          if (!open) setCardId(null);
        }}
      />
      <span data-testid="title-a">{board?.cards["card-a"]?.title}</span>
      <span data-testid="stamp-a">{board?.cards["card-a"]?.updatedAt}</span>
      <span data-testid="stamp-b">{board?.cards["card-b"]?.updatedAt}</span>
    </>
  );
}

function renderHarness() {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/board/b-1"]}>
          <ToastProvider>
            <BoardProvider>
              <Harness />
            </BoardProvider>
          </ToastProvider>
        </MemoryRouter>
      </TooltipProvider>
    </I18nProvider>,
  );
}

function editTitle(value: string) {
  const title = screen.getByLabelText("Title");
  fireEvent.change(title, { target: { value } });
}

const stampA = () => screen.getByTestId("stamp-a").textContent;
const stampB = () => screen.getByTestId("stamp-b").textContent;

describe("CardDialog quiet touch debounce (B-3)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
    // Only the debounce timer is faked — Radix needs the real clock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps the edited card after the quiet delay", () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("open-a"));
    editTitle("Card A edited");
    expect(stampA()).toBe("1");

    act(() => vi.advanceTimersByTime(QUIET_TOUCH_DELAY_MS));
    expect(stampA()).not.toBe("1");
    expect(stampB()).toBe("1");
  });

  it("flushes the pending stamp to the edited card when the dialog closes", () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("open-a"));
    editTitle("Card A edited");
    fireEvent.click(screen.getByTestId("close"));

    // No timer advance needed — closing flushes the stamp immediately.
    expect(stampA()).not.toBe("1");
    expect(stampB()).toBe("1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never stamps another card opened within the debounce window", () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("open-a"));
    editTitle("Card A edited");
    fireEvent.click(screen.getByTestId("close"));
    fireEvent.click(screen.getByTestId("open-b"));

    act(() => vi.advanceTimersByTime(QUIET_TOUCH_DELAY_MS));

    // A was edited and keeps its stamp; B was only opened, not touched.
    expect(stampA()).not.toBe("1");
    expect(stampB()).toBe("1");
    // The dialog is still showing B.
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Title"),
    ).toHaveValue("Card B");
  });

  it("flushes the previous card's stamp when switching cards directly", () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("open-a"));
    editTitle("Card A edited");
    fireEvent.click(screen.getByTestId("open-b"));

    act(() => vi.advanceTimersByTime(QUIET_TOUCH_DELAY_MS));

    expect(stampA()).not.toBe("1");
    expect(stampB()).toBe("1");
  });

  it("resyncs a foreign rename and never clobbers it on blur (TASK-156)", () => {
    renderHarness();
    fireEvent.click(screen.getByTestId("open-a"));
    editTitle("Mine");
    fireEvent.click(screen.getByTestId("rename-a-elsewhere"));

    const dialog = screen.getByRole("dialog");
    within(dialog).getByTestId("card-title-conflict");

    fireEvent.blur(screen.getByLabelText("Title"));
    expect(screen.getByTestId("title-a").textContent).toBe("Theirs");

    fireEvent.click(within(dialog).getByTestId("card-title-conflict-keep"));
    expect(screen.getByTestId("title-a").textContent).toBe("Mine");
  });
});
