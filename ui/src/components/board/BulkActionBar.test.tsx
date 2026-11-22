import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { BoardSection } from "@/components/BoardSection";
import {
  BulkActionBar,
  BoardSelectionToggle,
} from "@/components/board/BulkActionBar";
import { DndBoard } from "@/components/board/DndBoard";
import { TableView } from "@/components/board/TableView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { defaultI18n, ensureLocale } from "@/i18n/i18n";
import { BoardProvider, useBoard, useBoardAccess } from "@/store/BoardContext";
import {
  CardSelectionProvider,
  useCardSelection,
} from "@/store/board-selection";
import { FakeServer } from "@/test/fake-server";
import { LIMITS, type Board } from "@janosik/shared";

interface SeedOptions {
  wipLimit?: number;
  doingCardIds?: string[];
}

function seedBoard({ wipLimit, doingCardIds }: SeedOptions = {}) {
  const board: Board = {
    id: "board-bulk",
    title: "Bulk board",
    columns: [
      {
        id: "col-todo",
        title: "Todo",
        cardIds: ["card-alpha", "card-bravo"],
        createdAt: 1,
      },
      {
        id: "col-doing",
        title: "Doing",
        cardIds: doingCardIds ?? ["card-charlie"],
        createdAt: 1,
        ...(wipLimit !== undefined ? { wipLimit } : {}),
      },
      { id: "col-done", title: "Done", cardIds: [], createdAt: 1 },
    ],
    cards: {
      "card-alpha": {
        id: "card-alpha",
        title: "Alpha",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "card-bravo": {
        id: "card-bravo",
        title: "Bravo",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "card-charlie": {
        id: "card-charlie",
        title: "Charlie",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    labels: [
      { id: "label-bug", name: "Bug", color: "red" },
      { id: "label-feature", name: "Feature", color: "blue" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  localStorage.setItem("janosik-boards", JSON.stringify([board]));
  return board;
}

function CapProbe() {
  const selection = useCardSelection();
  return (
    <>
      <button type="button" onClick={selection.clear}>
        clear
      </button>
      <button type="button" onClick={() => selection.toggle("card-0")}>
        toggle first
      </button>
      <button type="button" onClick={() => selection.toggle("card-104", true)}>
        shift last
      </button>
      <button type="button" onClick={selection.selectAllVisible}>
        select first
      </button>
      <span data-testid="cap-count">{selection.count}</span>
    </>
  );
}

function UndoProbe() {
  const { undo, canUndo } = useBoard();
  return (
    <button type="button" onClick={undo} disabled={!canUndo}>
      Undo
    </button>
  );
}

function BoardProbe() {
  const { board } = useBoard();
  return (
    <div data-testid="board-probe">
      {JSON.stringify({
        columns: board?.columns.map((column) => [column.id, column.cardIds]),
        labels: Object.fromEntries(
          Object.entries(board?.cards ?? {}).map(([id, card]) => [
            id,
            {
              labels: card.labelIds,
              archivedAt: card.archivedAt,
              assigneeId: card.assigneeId,
            },
          ]),
        ),
      })}
    </div>
  );
}

function SelectionHarness({
  view = "board",
  enabled = true,
}: {
  view?: "board" | "table";
  enabled?: boolean;
}) {
  const { board } = useBoard();
  const { role } = useBoardAccess();
  const readOnly = role === "VIEWER" || board?.archivedAt !== undefined;
  const order = useMemo(
    () => board?.columns.flatMap((column) => column.cardIds) ?? [],
    [board],
  );
  return (
    <CardSelectionProvider
      boardId={board?.id ?? "none"}
      order={order}
      enabled={enabled && !readOnly}
    >
      <BoardSelectionToggle />
      {view === "board" ? (
        <DndBoard onCardClick={() => undefined} readOnly={readOnly} />
      ) : (
        <TableView onCardClick={() => undefined} readOnly={readOnly} />
      )}
      <BulkActionBar />
      <UndoProbe />
      <BoardProbe />
    </CardSelectionProvider>
  );
}

function tree(children: React.ReactNode, boardId = "board-bulk", query = "") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[`/board/${boardId}${query}`]}>
                <ToastProvider>
                  <BoardProvider>{children}</BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

function columnSection(title: string) {
  return screen.getByRole("group", { name: title }).closest("section")!;
}

async function enterSelectionMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("bulk-select-toggle"));
}

async function selectByClick(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  shiftKey = false,
) {
  const card =
    screen
      .queryAllByTestId("card-title")
      .find((element) => element.textContent === title) ??
    screen.getByText(title);
  if (shiftKey) {
    fireEvent.click(card, { shiftKey: true });
    return;
  }
  await user.click(card);
}

function rewriteWith(change: (board: Board) => void, options?: SeedOptions) {
  localStorage.clear();
  const board = seedBoard(options);
  change(board);
  localStorage.setItem("janosik-boards", JSON.stringify([board]));
  return board;
}

function renderBoardSection() {
  return tree(<BoardSection />);
}

beforeEach(() => {
  localStorage.clear();
  seedBoard();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await defaultI18n.changeLanguage("en");
});

describe("bulk card actions", () => {
  it("selects cards across columns and moves them in one run", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);

    await selectByClick(user, "Alpha");
    await selectByClick(user, "Charlie");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");

    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-done"));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 2 of 2.",
      ),
    );
    const done = within(columnSection("Done"));
    expect(done.getByText("Alpha")).toBeVisible();
    expect(done.getByText("Charlie")).toBeVisible();
    expect(
      within(columnSection("Todo")).queryByText("Alpha"),
    ).not.toBeInTheDocument();
  });

  it("uses neutral copy for a one-card run", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-done"));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 1.",
      ),
    );
    expect(screen.getByTestId("bulk-status")).not.toHaveTextContent("1 cards");
  });

  it("supports shift ranges and select-all with the keyboard", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    expect(screen.getByTestId("bulk-bar")).toHaveFocus();

    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo", true);
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");

    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    expect(screen.getByTestId("bulk-select-all")).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("bulk-select-toggle")).toHaveFocus(),
    );
  });

  it("announces the settled count and keeps progress out of the live ticker", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await waitFor(() =>
      expect(screen.getByTestId("bulk-count-announcement")).toHaveTextContent(
        "1 selected",
      ),
    );
    expect(screen.getByTestId("bulk-bar")).not.toHaveAttribute("aria-busy");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");
  });

  it("clears the selection when Select is switched off", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await user.click(screen.getByTestId("bulk-select-toggle"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.getByTestId("bulk-select-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("toggles a board checkbox with Space without starting a drag", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    const checkbox = screen.getByRole("checkbox", { name: "Select Alpha" });
    checkbox.focus();
    await user.keyboard(" ");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Alpha" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");
  });

  it("lets Escape and Ctrl+A through a focused card checkbox", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    const checkbox = screen.getByRole("checkbox", { name: "Select Alpha" });
    checkbox.focus();
    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    expect(checkbox).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("bulk-select-toggle")).toHaveFocus(),
    );
  });

  it("selects the keyboard cursor card with x", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await user.keyboard("j");
    await user.keyboard("x");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Alpha" }),
    ).toBeVisible();
  });

  it("archives selected cards after confirmation and undoes one card per step", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-archive"));
    const confirm = screen.getByRole("dialog", {
      name: "Archive 2 selected cards?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 2 of 2.",
      ),
    );
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.queryByTestId("bulk-count")).toBeNull();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeVisible();

    await user.click(screen.getByTestId("bulk-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("bulk-select-toggle")).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("Bravo")).toBeVisible());
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("deletes selected cards after confirmation and restores one with undo", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Charlie");

    await user.click(screen.getByTestId("bulk-delete"));
    const confirm = screen.getByRole("dialog", {
      name: "Delete 1 selected card?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Charlie")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("bulk-status")).toHaveTextContent(
      "Changed: 1 of 1.",
    );
    await user.click(screen.getByTestId("bulk-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("Charlie")).toBeVisible());
  });

  it("reports a partial WIP failure per card and keeps the successful move", async () => {
    localStorage.clear();
    seedBoard({ wipLimit: 1, doingCardIds: [] });
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-doing"));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 2.",
      ),
    );
    expect(within(columnSection("Doing")).getByText("Alpha")).toBeVisible();
    const errors = screen.getByTestId("bulk-errors");
    expect(errors).toHaveTextContent("Bravo");
    expect(errors).toHaveTextContent(/WIP limit \(1\)/);
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");

    // Results stay until Dismiss, even when the selection changes.
    await selectByClick(user, "Bravo");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Bravo");
    expect(screen.getByTestId("bulk-status")).toHaveTextContent(
      "Changed: 1 of 2.",
    );

    // Clear drops the selection but the result bar stays; focus moves to
    // Dismiss instead of a now-disabled Clear.
    await user.click(screen.getByTestId("bulk-clear"));
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Bravo");
    expect(screen.getByTestId("bulk-dismiss")).toHaveFocus();

    await user.click(screen.getByTestId("bulk-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).toBeNull());
    await enterSelectionMode(user);
    await selectByClick(user, "Bravo");
    expect(screen.queryByTestId("bulk-errors")).toBeNull();
    expect(screen.getByTestId("bulk-status")).not.toHaveTextContent(
      "Changed: 1 of 2.",
    );
    expect(screen.getByTestId("bulk-count-announcement")).not.toHaveTextContent(
      "failed",
    );
  });

  it("renders every failure in a scrollable list", async () => {
    rewriteWith(
      (board) => {
        board.columns = [
          {
            id: "col-todo",
            title: "Todo",
            cardIds: ["c1", "c2", "c3", "c4", "c5"],
            createdAt: 1,
          },
          {
            id: "col-doing",
            title: "Doing",
            cardIds: [],
            createdAt: 1,
            wipLimit: 1,
          },
        ];
        board.cards = Object.fromEntries(
          ["c1", "c2", "c3", "c4", "c5"].map((id, index) => [
            id,
            {
              id,
              title: `Card ${index + 1}`,
              labelIds: [],
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
        );
      },
      { wipLimit: 1, doingCardIds: [] },
    );
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await user.click(screen.getByTestId("bulk-select-all"));
    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-doing"));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 5.",
      ),
    );
    const errors = screen.getByTestId("bulk-errors");
    for (const title of ["Card 2", "Card 3", "Card 4", "Card 5"]) {
      expect(within(errors).getByText(title)).toBeVisible();
    }
    expect(within(errors).getAllByRole("listitem")).toHaveLength(4);
    const failureList = screen.getByTestId("bulk-failure-list");
    expect(failureList).toHaveAttribute("tabindex", "0");
    expect(failureList).toHaveAccessibleName("Failed cards");
    failureList.focus();
    expect(failureList).toHaveFocus();
  });

  it("toggles a label on every selected card and removes it again", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-label"));
    const addLabel = screen.getByRole("menuitemcheckbox", { name: /Bug/ });
    expect(addLabel).toHaveAttribute("aria-checked", "false");
    await user.click(addLabel);
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":["label-bug"]',
      ),
    );

    await user.click(screen.getByTestId("bulk-label"));
    const removeLabel = screen.getByRole("menuitemcheckbox", { name: /Bug/ });
    expect(removeLabel).toHaveAttribute("aria-checked", "true");
    await user.click(removeLabel);
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":[]',
      ),
    );
  });

  it("preflights the per-card label cap and keeps the other cards changed", async () => {
    rewriteWith((board) => {
      const labels = Array.from(
        { length: LIMITS.labelsPerCard },
        (_, index) => ({
          id: `label-${index}`,
          name: `Label ${index}`,
          color: "red" as const,
        }),
      );
      board.labels = [
        ...labels,
        { id: "label-extra", name: "Extra", color: "blue" },
      ];
      board.cards["card-alpha"]!.labelIds = labels.map((label) => label.id);
    });
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-label"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Extra/ }));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 2.",
      ),
    );
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent(
      "A card can have at most 20 labels",
    );
    expect(screen.getByTestId("board-probe")).toHaveTextContent(
      '"card-bravo":{"labels":["label-extra"]',
    );
  });

  it("selects rows across columns in the table and moves them", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness view="table" />);
    expect(await screen.findByRole("table")).toBeVisible();
    await enterSelectionMode(user);

    await user.click(screen.getByText("Alpha"));
    await user.click(screen.getByText("Charlie"));
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");

    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-done"));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 2 of 2.",
      ),
    );

    const alphaRow = screen.getByText("Alpha").closest("tr");
    expect(
      within(alphaRow!).getByTestId("table-column-cell"),
    ).toHaveTextContent("Done");
  });

  it("uses the visible sorted table order for Shift ranges", async () => {
    rewriteWith((board) => {
      board.cards["card-alpha"]!.dueDate = 300;
      board.cards["card-bravo"]!.dueDate = 100;
      board.cards["card-charlie"]!.dueDate = 200;
    });
    localStorage.setItem("janosik-board-view", "table");
    const user = userEvent.setup();
    renderBoardSection();
    expect(
      await screen.findByRole("table", {}, { timeout: 15_000 }),
    ).toBeVisible();

    await user.click(screen.getByTestId("table-sort-due"));
    await enterSelectionMode(user);
    // Ascending due: Bravo, Charlie, Alpha. Board order is Alpha, Bravo,
    // Charlie, so a board-order range would also select Bravo.
    await selectByClick(user, "Charlie");
    await selectByClick(user, "Alpha", true);

    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Charlie" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Alpha" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Select Bravo" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("hides selection from a disabled read-only surface", async () => {
    tree(<SelectionHarness enabled={false} />);
    expect(screen.queryByTestId("bulk-select-toggle")).toBeNull();
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("assigns every selected card through the member directory", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    server.membersByBoard.set("board-bulk", [
      {
        userId: "user-mia",
        displayName: "Mia Member",
        email: "mia@example.com",
        role: "MEMBER",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<SelectionHarness />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-assign"));
    const mia = await screen.findByRole("menuitemcheckbox", {
      name: /Mia Member/,
    });
    expect(mia).toHaveAttribute("aria-checked", "false");
    await user.click(mia);
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":[],"assigneeId":"user-mia"',
      ),
    );
  });

  it("shows a mixed state for partial labels and assignment", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const source = seedBoard();
    source.cards["card-alpha"]!.labelIds = ["label-bug"];
    source.cards["card-alpha"]!.assigneeId = "user-mia";
    const server = new FakeServer([source]);
    server.membersByBoard.set("board-bulk", [
      {
        userId: "user-mia",
        displayName: "Mia Member",
        email: "mia@example.com",
        role: "MEMBER",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<SelectionHarness />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-label"));
    const label = screen.getByRole("menuitemcheckbox", { name: /Bug/ });
    expect(label).toHaveAttribute("aria-checked", "mixed");
    expect(label.querySelector(".lucide-minus")).not.toBeNull();
    await user.keyboard("{Escape}");

    await user.click(screen.getByTestId("bulk-assign"));
    const mia = screen.getByRole("menuitemcheckbox", {
      name: /Mia Member/,
    });
    expect(mia).toHaveAttribute("aria-checked", "mixed");
    const unassign = screen.getByRole("menuitemcheckbox", {
      name: /Unassign/,
    });
    expect(unassign).toHaveAttribute("aria-checked", "mixed");
  });

  it("explains a dispatch-level refusal and continues the rest", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<SelectionHarness />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");
    server.failNextCommand(409, { conflict: "version" });

    await user.click(screen.getByTestId("bulk-archive"));
    const confirm = screen.getByRole("dialog", {
      name: "Archive 2 selected cards?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 2.",
      ),
    );
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent(
      "The server refused this card.",
    );
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("1 selected");

    // Dismiss while the failed card remains selected: the bar stays and
    // focus lands on Clear, not <body>.
    await user.click(screen.getByTestId("bulk-dismiss"));
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.queryByTestId("bulk-errors")).toBeNull();
    expect(screen.getByTestId("bulk-clear")).toHaveFocus();
  });

  it("does not steal focus when a view switch closes the bar", async () => {
    const user = userEvent.setup();
    tree(<BoardSection />);
    expect(await screen.findByText("Alpha")).toBeVisible();
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    const calendar = screen.getByRole("button", { name: "Calendar" });
    await user.click(calendar);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(calendar).toHaveFocus();
  });

  it("moves focus from Cancel to Dismiss when a Calendar run ends", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<BoardSection />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await user.click(screen.getByTestId("bulk-select-all"));
    const release = server.holdNextCommand();
    await user.click(screen.getByTestId("bulk-archive"));
    const confirm = screen.getByRole("dialog", {
      name: "Archive 3 selected cards?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Calendar" }));

    const cancel = screen.getByTestId("bulk-clear");
    await user.click(cancel);
    expect(cancel).toHaveFocus();
    act(() => release());

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Stopped: 1 of 3 processed.",
      ),
    );
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.getByTestId("bulk-dismiss")).toHaveFocus();
  });

  it("keeps progress and partial results after switching to Calendar", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<BoardSection />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await user.click(screen.getByTestId("bulk-select-all"));

    server.failNextCommand(409, { conflict: "version" });
    const release = server.holdNextCommand();
    await user.click(screen.getByTestId("bulk-archive"));
    const confirm = screen.getByRole("dialog", {
      name: "Archive 3 selected cards?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument(),
    );

    const calendar = screen.getByRole("button", { name: "Calendar" });
    await user.click(calendar);
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    expect(calendar).toHaveFocus();

    act(() => release());
    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 2 of 3.",
      ),
    );
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent(
      "The server refused this card.",
    );

    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByTestId("bulk-errors")).toHaveTextContent("Alpha");
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    await user.click(screen.getByTestId("bulk-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("board-main")).toHaveFocus();
  });

  it("keeps a non-destructive Move result after Calendar and back", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<BoardSection />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    const release = server.holdNextCommand();
    await user.click(screen.getByTestId("bulk-move"));
    await user.click(screen.getByTestId("bulk-move-col-done"));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    act(() => release());

    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Changed: 1 of 1.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.getByTestId("bulk-status")).toHaveTextContent(
      "Changed: 1 of 1.",
    );
    await user.click(screen.getByTestId("bulk-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).toBeNull());
  });

  it("keeps failed and unprocessed cards selected after Cancel", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    const user = userEvent.setup();
    tree(<SelectionHarness />);
    expect(
      await screen.findByText("Alpha", {}, { timeout: 15_000 }),
    ).toBeVisible();
    await enterSelectionMode(user);
    await user.click(screen.getByTestId("bulk-select-all"));
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");

    const release = server.holdNextCommand();
    await user.click(screen.getByTestId("bulk-archive"));
    const confirm = screen.getByRole("dialog", {
      name: "Archive 3 selected cards?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(screen.getByTestId("bulk-progress")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("bulk-phase-announcement")).toHaveTextContent(
      "Processing 3 cards",
    );

    const focusedCheckbox = screen.getByRole("checkbox", {
      name: "Deselect Bravo",
    });
    focusedCheckbox.focus();
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    // While the run is in flight the badge reports the run snapshot; the bar
    // stays and Cancel remains reachable.
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    act(() => release());
    await waitFor(() =>
      expect(screen.getByTestId("bulk-status")).toHaveTextContent(
        "Stopped: 1 of 3 processed.",
      ),
    );
    expect(screen.getByTestId("bulk-bar")).toBeVisible();
    expect(screen.getByTestId("bulk-phase-announcement")).toHaveTextContent(
      "Stopped: 1 of 3 processed.",
    );
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Bravo" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Deselect Charlie" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("uses the same cap message for a Shift range and select-all", async () => {
    const ids = Array.from({ length: 105 }, (_, index) => `card-${index}`);
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ToastProvider>
          <CardSelectionProvider boardId="cap-board" order={ids} enabled>
            <CapProbe />
          </CardSelectionProvider>
        </ToastProvider>
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "toggle first" }));
    await user.click(screen.getByRole("button", { name: "shift last" }));
    expect(screen.getByTestId("cap-count")).toHaveTextContent("100");
    await user.click(screen.getByRole("button", { name: "clear" }));
    await user.click(screen.getByRole("button", { name: "select first" }));
    expect(screen.getByTestId("cap-count")).toHaveTextContent("100");
    expect(
      (await screen.findAllByText(/select up to 100/)).length,
    ).toBeGreaterThan(0);
  });

  it("renders the bar in Russian", async () => {
    await ensureLocale("ru");
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await user.click(screen.getByTestId("bulk-select-toggle"));
    await selectByClick(user, "Alpha");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("Выбрано: 1");
    expect(screen.getByTestId("bulk-archive")).toHaveTextContent("В архив");
    expect(screen.getByTestId("bulk-clear")).toHaveTextContent("Снять выбор");
  });

  it("keeps 44 px targets on the bulk controls", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    for (const testId of [
      "bulk-select-toggle",
      "bulk-select-all",
      "bulk-move",
      "bulk-label",
      "bulk-archive",
      "bulk-delete",
      "bulk-clear",
    ]) {
      expect(screen.getByTestId(testId)).toHaveClass("max-lg:h-11");
    }
  });

  it("renders no bulk controls on an archived board", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([
      {
        id: "b-arch",
        title: "Archived board",
        archivedAt: Date.UTC(2026, 0, 1),
        columns: [
          {
            id: "col-1",
            title: "Todo",
            cardIds: ["card-1"],
            createdAt: 1,
          },
        ],
        cards: {
          "card-1": {
            id: "card-1",
            title: "Archived card",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    server.role = "ADMIN";
    vi.stubGlobal("fetch", server.handle);

    tree(<SelectionHarness />, "b-arch", "?card=card-1");
    expect(
      await screen.findByText("Archived card", {}, { timeout: 15_000 }),
    ).toBeVisible();
    expect(screen.queryByTestId("bulk-select-toggle")).toBeNull();
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders no selection controls for a server-side VIEWER", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    const server = new FakeServer([
      {
        id: "b-viewer",
        title: "Viewer board",
        columns: [
          {
            id: "col-1",
            title: "Todo",
            cardIds: ["card-1"],
            createdAt: 1,
          },
        ],
        cards: {
          "card-1": {
            id: "card-1",
            title: "Viewer card",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    server.role = "VIEWER";
    vi.stubGlobal("fetch", server.handle);

    tree(<SelectionHarness />, "b-viewer");
    expect(
      await screen.findByText("Viewer card", {}, { timeout: 15_000 }),
    ).toBeVisible();
    expect(screen.queryByTestId("bulk-select-toggle")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
