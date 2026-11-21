import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@janosik/shared";

import App, { createAppRouter } from "@/App";
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

  it("offers an example with columns, a welcome card and a checklist", async () => {
    seedArchivedBoard();
    render(<App router={createAppRouter()} />);

    await userEvent.type(
      await screen.findByTestId("empty-board-name"),
      "Launch plan",
    );
    await userEvent.click(screen.getByTestId("empty-create-template"));

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/board\//));
    await waitFor(() => {
      const board = storedBoards().find(
        (candidate) => candidate.title === "Launch plan",
      );
      expect(board?.columns.map((column) => column.title)).toEqual([
        "To do",
        "In progress",
        "Done",
      ]);
      const card = Object.values(board?.cards ?? {})[0];
      expect(card?.title).toBe("Welcome to your board");
      expect(card?.checklists?.[0]?.title).toBe("First steps");
      expect(card?.checklists?.[0]?.items.map((item) => item.text)).toEqual([
        "Rename the board to your project",
        "Add your first real card",
        "Invite a teammate",
      ]);
    });
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

  it("renames through the visible pencil and keeps keyboard access", async () => {
    seedActiveBoard();
    render(<App router={createAppRouter()} />);

    const rename = await screen.findByTestId("board-rename");
    expect(rename).toHaveAccessibleName("Rename board");
    rename.focus();
    await userEvent.keyboard("{Enter}");

    const input = await waitFor(() => {
      const field = document.querySelector<HTMLInputElement>(
        '[name="board-title-edit"]',
      );
      expect(field).not.toBeNull();
      return field!;
    });
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed through pencil{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Renamed through pencil" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(storedBoards().find((board) => board.id === "b-1")?.title).toBe(
        "Renamed through pencil",
      ),
    );
  });
});
