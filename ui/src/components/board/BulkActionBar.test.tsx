import {
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
import { BoardProvider, useBoard, useBoardAccess } from "@/store/BoardContext";
import { CardSelectionProvider } from "@/store/board-selection";
import { FakeServer } from "@/test/fake-server";
import type { Board } from "@janosik/shared";

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

function tree(children: React.ReactNode, boardId = "board-bulk") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[`/board/${boardId}`]}>
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
  const card = screen.getByText(title);
  if (shiftKey) {
    fireEvent.click(card, { shiftKey: true });
    return;
  }
  await user.click(card);
}

beforeEach(() => {
  localStorage.clear();
  seedBoard();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
        "2 of 2 cards changed",
      ),
    );
    const done = within(columnSection("Done"));
    expect(done.getByText("Alpha")).toBeVisible();
    expect(done.getByText("Charlie")).toBeVisible();
    expect(
      within(columnSection("Todo")).queryByText("Alpha"),
    ).not.toBeInTheDocument();
  });

  it("supports shift ranges and select-all with the keyboard", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);

    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo", true);
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");

    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 selected");
    expect(screen.getByTestId("bulk-select-all")).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
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
      expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeVisible();

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
    expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument();

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
        "1 of 2 cards changed",
      ),
    );
    expect(within(columnSection("Doing")).getByText("Alpha")).toBeVisible();
    const errors = screen.getByTestId("bulk-errors");
    expect(errors).toHaveTextContent("Bravo");
    expect(errors).toHaveTextContent(/WIP limit \(1\)/);
    expect(screen.getByTestId("bulk-count")).toHaveTextContent("2 selected");
  });

  it("toggles a label on every selected card and removes it again", async () => {
    const user = userEvent.setup();
    tree(<SelectionHarness />);
    await enterSelectionMode(user);
    await selectByClick(user, "Alpha");
    await selectByClick(user, "Bravo");

    await user.click(screen.getByTestId("bulk-label"));
    await user.click(screen.getByRole("menuitem", { name: /Bug/ }));
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":["label-bug"]',
      ),
    );

    await user.click(screen.getByTestId("bulk-label"));
    await user.click(screen.getByRole("menuitem", { name: /Bug/ }));
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":[]',
      ),
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
        "2 of 2 cards changed",
      ),
    );

    const alphaRow = screen.getByText("Alpha").closest("tr");
    expect(
      within(alphaRow!).getByTestId("table-column-cell"),
    ).toHaveTextContent("Done");
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
    await user.click(
      await screen.findByRole("menuitem", { name: "Mia Member" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("board-probe")).toHaveTextContent(
        '"card-alpha":{"labels":[],"assigneeId":"user-mia"',
      ),
    );
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
