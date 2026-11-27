import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@janosik/shared";

import App, { createAppRouter, NoBoardRoute } from "@/App";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { defaultI18n, ensureLocale } from "@/i18n/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { STORAGE_KEY } from "@/store/board-persistence";

/** TASK-177.16 first-run naming, starter template and visible rename. */

type StoredBoard = {
  id: string;
  title: string;
  archivedAt?: number;
  columns: Array<{ id: string; title: string; cardIds: string[] }>;
  cards: Record<
    string,
    {
      title: string;
      checklists?: Array<{
        title: string;
        items: Array<{ text: string; done: boolean }>;
      }>;
    }
  >;
};

function storedBoards(): StoredBoard[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredBoard[];
}

function seedArchivedBoard(): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      {
        id: "b-arch",
        title: "Old board",
        columns: [],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 2,
      },
    ]),
  );
}

function seedActiveBoard(): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      {
        id: "b-1",
        title: "Alpha",
        columns: [],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
  window.history.replaceState({}, "", "/board/b-1");
}

describe("App first run", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("asks for a name and never falls back to New board", async () => {
    seedArchivedBoard();
    render(<App router={createAppRouter()} />);

    expect(
      await screen.findByText("All boards are archived."),
    ).toBeInTheDocument();
    const name = screen.getByTestId("empty-board-name");
    const create = screen.getByTestId("empty-create-board");
    expect(create).toBeDisabled();
    // The example path does not require the name; the empty board still does.
    expect(screen.getByTestId("empty-create-template")).toBeEnabled();

    await userEvent.type(name, "Launch plan");
    await userEvent.click(create);

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/board\//));
    await waitFor(() => {
      expect(
        storedBoards().find((board) => board.title === "Launch plan"),
      ).toMatchObject({ columns: [], cards: {} });
    });
    expect(storedBoards().every((board) => board.title !== "New board")).toBe(
      true,
    );
  });

  it("opens the template picker without a name and creates the example", async () => {
    seedArchivedBoard();
    render(<App router={createAppRouter()} />);

    const example = await screen.findByTestId("empty-create-template");
    expect(example).toBeEnabled();
    await userEvent.click(example);

    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");
    expect((name as HTMLInputElement).value).toMatch(/^Product launch — /);
    expect(
      within(picker).getByRole("button", { name: /Product launch/ }),
    ).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(picker).getByTestId("template-create-board"));
    expect(await screen.findByText("Board created")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Open board" }));

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/board\//));
    await waitFor(() => {
      const board = storedBoards().find((candidate) =>
        candidate.title.startsWith("Product launch — "),
      );
      expect(board?.columns.map((column) => column.title)).toEqual([
        "Strategy",
        "Build",
        "Launch prep",
        "Shipped",
      ]);
      const cards = Object.values(board?.cards ?? {});
      expect(cards).toHaveLength(7);
      const brief = cards.find(
        (card) => card.title === "Write the launch brief",
      );
      expect(brief?.checklists?.[0]?.title).toBe("Brief checklist");
      expect(brief?.checklists?.[0]?.items).toHaveLength(4);
    });
  });

  it("keeps a manual name when switching templates and regenerates it", async () => {
    seedArchivedBoard();
    render(<App router={createAppRouter()} />);

    await userEvent.click(await screen.findByTestId("empty-create-template"));
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");

    await userEvent.click(
      within(picker).getByRole("button", { name: /Sprint board/ }),
    );
    expect((name as HTMLInputElement).value).toMatch(
      /^Sprint board \d{4}-W\d{2}$/,
    );

    await userEvent.clear(name);
    await userEvent.type(name, "Q1 website redesign");
    expect(within(picker).getByText("Edited by you")).toBeVisible();

    await userEvent.click(
      within(picker).getByRole("button", { name: /Bug tracker/ }),
    );
    expect((name as HTMLInputElement).value).toBe("Q1 website redesign");

    await userEvent.click(
      within(picker).getByRole("button", { name: "Regenerate" }),
    );
    expect((name as HTMLInputElement).value).toBe("Bug tracker");
    expect(within(picker).getByText("Auto-generated")).toBeVisible();
  });

  it("creates only one board when submit fires twice", async () => {
    seedArchivedBoard();
    render(<App router={createAppRouter()} />);

    await userEvent.type(
      await screen.findByTestId("empty-board-name"),
      "Once only",
    );
    const create = screen.getByTestId("empty-create-board");
    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/board\//));
    await waitFor(() =>
      expect(
        storedBoards().filter((board) => board.title === "Once only"),
      ).toHaveLength(1),
    );
  });

  it("shows the local board limit instead of navigating past it", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Array.from({ length: LIMITS.boardsCount }, (_, index) => ({
          id: `arch-${index}`,
          title: `Archived ${index}`,
          columns: [],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
          archivedAt: 2,
        })),
      ),
    );
    render(<App router={createAppRouter()} />);

    await userEvent.type(
      await screen.findByTestId("empty-board-name"),
      "One too many",
    );
    await userEvent.click(screen.getByTestId("empty-create-board"));

    expect(
      await screen.findByText(
        `You can have at most ${LIMITS.boardsCount} boards`,
      ),
    ).toBeVisible();
    expect(window.location.pathname).toBe("/");
    expect(screen.getByTestId("empty-create-board")).toBeEnabled();
    expect(
      storedBoards().filter((board) => board.title === "One too many"),
    ).toHaveLength(0);
  });

  it("renames through the title and keeps keyboard access", async () => {
    seedActiveBoard();
    render(<App router={createAppRouter()} />);

    const title = await screen.findByTestId("board-title");
    expect(title).toHaveAccessibleName("Alpha");
    title.focus();
    await userEvent.keyboard("{Enter}");

    const input = await waitFor(() => {
      const field = document.querySelector<HTMLInputElement>(
        '[name="board-title-edit"]',
      );
      expect(field).not.toBeNull();
      return field!;
    });
    fireEvent.change(input, {
      target: { value: "Renamed through pencil" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    const renamedHeading = await screen.findByRole("heading", {
      name: "Renamed through pencil",
    });
    await waitFor(() => expect(renamedHeading).toHaveFocus());
    await waitFor(() =>
      expect(storedBoards().find((board) => board.id === "b-1")?.title).toBe(
        "Renamed through pencil",
      ),
    );

    // Escape also returns focus to the heading.
    fireEvent.click(screen.getByTestId("board-rename"));
    const cancelled = await waitFor(() => {
      const field = document.querySelector<HTMLInputElement>(
        '[name="board-title-edit"]',
      );
      expect(field).not.toBeNull();
      return field!;
    });
    fireEvent.keyDown(cancelled, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByTestId("board-title")).toHaveFocus(),
    );
  });

  it("builds the Russian example in the offline store", async () => {
    seedArchivedBoard();
    await ensureLocale("ru");
    const i18n = defaultI18n.cloneInstance({ lng: "ru" });
    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/"]}>
                <BoardProvider>
                  <NoBoardRoute />
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    await userEvent.click(await screen.findByTestId("empty-create-template"));
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Название доски");
    expect((name as HTMLInputElement).value).toMatch(/^Запуск продукта — /);

    await userEvent.click(within(picker).getByTestId("template-create-board"));
    expect(await screen.findByText("Доска создана")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Открыть доску" }),
    );

    await waitFor(() => {
      const board = storedBoards().find((candidate) =>
        candidate.title.startsWith("Запуск продукта — "),
      );
      expect(board?.columns.map((column) => column.title)).toEqual([
        "Стратегия",
        "Подготовка",
        "Перед запуском",
        "Выпущено",
      ]);
      const cards = Object.values(board?.cards ?? {});
      expect(cards).toHaveLength(7);
      expect(
        cards.find((card) => card.title === "Написать бриф запуска")
          ?.checklists?.[0]?.title,
      ).toBe("Чек-лист брифа");
    });
  });
});
