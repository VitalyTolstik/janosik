import axe from "axe-core";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { THEME_STORAGE_KEY } from "@janosik/shared";
import { AuthProvider } from "@/auth/AuthContext";
import { BoardSection } from "@/components/BoardSection";
import { BoardTitle } from "@/components/board/BoardTitle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { ToastProvider } from "@/components/Toast";
import { api } from "@/api/client";
import { FakeServer } from "@/test/fake-server";

/**
 * Card/board accessibility (U-04, TASK-177.15).
 *
 * axe-core in jsdom has no layout or paint, so `color-contrast` is disabled
 * here and `theme-contrast.test.ts` checks the exact AA pairs. Everything
 * else — landmarks, heading order, list structure, accessible names — runs
 * for real, in both themes, with the card dialog open and closed.
 */

const BOARD: Board = {
  id: "b-a11y",
  title: "Accessible board",
  columns: [
    { id: "col-1", title: "To do", cardIds: ["a11y-card"], createdAt: 1 },
    { id: "col-2", title: "Done", cardIds: [], createdAt: 1 },
  ],
  cards: {
    "a11y-card": {
      id: "a11y-card",
      title: "A11y card",
      description: "A card used by the accessibility suite.",
      labelIds: ["label-yellow", "label-brand"],
      createdAt: 1,
      updatedAt: 1,
      checklists: [
        {
          id: "checklist-1",
          title: "Launch checklist",
          items: [
            { id: "item-1", text: "Write the docs", done: true },
            { id: "item-2", text: "Ship the release", done: false },
          ],
        },
      ],
    },
  },
  labels: [
    { id: "label-yellow", name: "Yellow", color: "yellow" },
    { id: "label-brand", name: "Brand", color: "brand" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

function renderPage() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-a11y"]}>
                <ToastProvider>
                  <AuthProvider>
                    <BoardProvider>
                      <header>
                        <BoardTitle />
                      </header>
                      <BoardSection />
                    </BoardProvider>
                  </AuthProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openCard() {
  const handle = (await screen.findByText("A11y card")).closest(
    '[aria-roledescription="sortable"]',
  ) as HTMLElement;
  expect(handle).not.toBeNull();
  handle.focus();
  expect(document.activeElement).toBe(handle);
  fireEvent.keyDown(handle, { key: "Enter", code: "Enter" });
  return { handle, dialog: await screen.findByRole("dialog") };
}

async function axeViolations(context: Element | Document) {
  const results = await axe.run(context, {
    rules: {
      // jsdom cannot paint; the token pairs are checked separately.
      "color-contrast": { enabled: false },
    },
  });
  // `label-content-name-mismatch` needs layout/paint for its visible-text
  // pass and errors inside jsdom; the browser suite owns that rule (with
  // `incomplete` included). Keep the jsdom incomplete gate for the rule that
  // can still report a meaningful incomplete here.
  const relevantIncomplete = results.incomplete.filter(
    (result) => result.id === "color-contrast",
  );
  const format = (violation: (typeof results.violations)[number]) =>
    `${violation.id}: ${violation.nodes
      .map((node) => node.target.join(" "))
      .join(", ")}`;
  return [
    ...results.violations.map(format),
    ...relevantIncomplete.map(
      (violation) =>
        `incomplete ${format(violation)} :: ${violation.nodes
          .map((node) => node.failureSummary ?? "")
          .join(" | ")}`,
    ),
  ];
}

function setupServer() {
  document.title = "Janosik";
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
  vi.stubGlobal("fetch", new FakeServer([BOARD]).handle);
}

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    setupServer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("has one h1, one main and no list items outside a list", async () => {
    renderPage();
    await screen.findByTestId("board-title");

    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Accessible board",
    );
    expect(document.querySelectorAll("main")).toHaveLength(1);
    for (const item of document.querySelectorAll("li")) {
      expect(item.parentElement?.tagName).toMatch(/^(UL|OL)$/);
    }
  });

  it("has no axe violations on the board page", async () => {
    renderPage();
    await screen.findByText("A11y card");
    expect(await axeViolations(document)).toEqual([]);
  });

  it("has no axe violations in the open card dialog", async () => {
    renderPage();
    const { dialog } = await openCard();
    await screen.findByRole("progressbar", { name: /progress/ });
    expect(await axeViolations(dialog)).toEqual([]);
    // The dialog must not introduce a second main landmark.
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });
});

describe("card dialog focus and checklist names", () => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    setupServer();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns focus to the card after Escape closes the dialog", async () => {
    renderPage();
    const { handle, dialog } = await openCard();
    expect(dialog).toBeInTheDocument();
    // Focus is trapped inside the dialog while it is open.
    expect(dialog.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(handle).toHaveFocus());
  });

  it("returns focus to the board main when the open card is deleted", async () => {
    renderPage();
    await openCard();

    await userEvent.click(screen.getByRole("button", { name: "Card actions" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete card" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete this card?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("A11y card")).not.toBeInTheDocument(),
    );
    const main = document.querySelector<HTMLElement>(
      '[data-testid="board-main"]',
    );
    await waitFor(() => expect(main).toHaveFocus());
  });

  it("names checklist toggles from the item text and labels the progressbar", async () => {
    renderPage();
    await openCard();

    const undone = await screen.findByRole("button", {
      name: "Toggle Ship the release",
    });
    expect(undone).toHaveAttribute("aria-pressed", "false");
    const done = screen.getByRole("button", { name: "Toggle Write the docs" });
    expect(done).toHaveAttribute("aria-pressed", "true");

    const progress = screen.getByRole("progressbar", {
      name: "Launch checklist progress",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "2");
    expect(progress).toHaveAttribute("aria-valuetext", "1 of 2 done");

    await userEvent.click(undone);
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "Launch checklist progress" }),
      ).toHaveAttribute("aria-valuetext", "2 of 2 done"),
    );
    expect(
      screen.getByRole("button", { name: "Toggle Ship the release" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
