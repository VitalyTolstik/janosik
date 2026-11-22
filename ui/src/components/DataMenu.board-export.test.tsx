import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataMenu } from "@/components/DataMenu";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import type { BoardState } from "@janosik/shared";

const hoisted = vi.hoisted(() => ({
  board: {
    id: "b-1",
    title: "Alpha",
    columns: [],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  },
  exportBoard: vi.fn(),
  listDeleted: vi.fn(),
  download: vi.fn(),
  noBoard: false,
  viewer: false,
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    isApiEnabled: () => true,
    api: {
      exportBoard: hoisted.exportBoard,
      listDeleted: hoisted.listDeleted,
    },
  };
});

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => ({
    boards: hoisted.noBoard ? [] : [hoisted.board],
    board: hoisted.noBoard ? undefined : hoisted.board,
    roleOf: () => (hoisted.viewer ? "VIEWER" : "ADMIN"),
    importBoards: vi.fn(),
    exportBoards: vi.fn(async () => [hoisted.board] as BoardState),
    exportBoard: hoisted.exportBoard,
  }),
  useBoardState: () => ({
    board: hoisted.noBoard ? undefined : hoisted.board,
  }),
}));

vi.mock("@/utils/download", () => ({
  downloadTextFile: hoisted.download,
}));

function renderMenu(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <DataMenu />
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Data & backups" }));
}

/**
 * TASK-177.7 (G-14): per-board export reuses `GET /boards/:id/export` and
 * stays separate from the all-boards file; `413` names the real remedy.
 */
describe("DataMenu per-board export", () => {
  beforeEach(() => {
    hoisted.noBoard = false;
    hoisted.viewer = false;
    hoisted.exportBoard.mockReset();
    hoisted.listDeleted.mockReset();
    hoisted.download.mockReset();
  });

  it("exports the viewed board as its own file", async () => {
    hoisted.exportBoard.mockResolvedValue('{"app":"janosik"}');
    renderMenu("/board/b-1");
    await openMenu();
    await userEvent.click(screen.getByTestId("data-export-board"));

    await waitFor(() =>
      expect(hoisted.exportBoard).toHaveBeenCalledWith("b-1"),
    );
    expect(hoisted.download).toHaveBeenCalledWith(
      "janosik-board.json",
      '{"app":"janosik"}',
    );
    expect(await screen.findByText("Board exported")).toBeInTheDocument();
  });

  it("explains the 25 MB refusal on a 413", async () => {
    const { ApiError } = await import("@/api/client");
    hoisted.exportBoard.mockRejectedValue(
      new ApiError(413, {
        code: "payload_too_large",
        message: "too large",
      }),
    );
    renderMenu("/board/b-1");
    await openMenu();
    await userEvent.click(screen.getByTestId("data-export-board"));

    expect(await screen.findByText(/larger than 25 MB/)).toBeInTheDocument();
    expect(screen.queryByText("Board exported")).toBeNull();
    expect(hoisted.download).not.toHaveBeenCalled();
  });

  it("returns focus to the Data trigger after Recently deleted closes", async () => {
    hoisted.listDeleted.mockResolvedValue({
      retentionDays: 30,
      limit: 200,
      items: [],
      truncated: false,
    });
    renderMenu("/board/b-1");
    const trigger = screen.getByRole("button", { name: "Data & backups" });
    await openMenu();
    await userEvent.click(screen.getByTestId("data-deleted"));

    const dialog = await screen.findByRole("dialog", {
      name: "Recently deleted",
    });
    expect(dialog).toBeVisible();
    // The title owns focus immediately, so an immediate Escape works.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("hides Recently deleted from a VIEWER instead of offering a 403", async () => {
    hoisted.viewer = true;
    renderMenu("/board/b-1");
    await openMenu();

    expect(screen.queryByTestId("data-deleted")).toBeNull();
    // Export stays available to a viewer.
    expect(screen.getByTestId("data-export-board")).toBeVisible();
  });

  it("disables per-board actions when no board is open", async () => {
    hoisted.noBoard = true;
    renderMenu("/");
    await openMenu();

    expect(screen.getByTestId("data-export-board")).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByTestId("data-deleted")).toHaveAttribute("data-disabled");
    // The all-boards export remains available with no board open.
    expect(screen.getByText("Export JSON")).toBeVisible();
  });
});
