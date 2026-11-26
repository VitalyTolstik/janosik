import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardAggregate } from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { BoardWorkflowPage } from "@/admin/BoardWorkflowPage";

/**
 * M39: the admin workflow editor must confirm before discarding a dirty draft
 * on every location change — browser Back, query and hash — while a consumed
 * `?lng=` handoff (L27) must not count as navigation.
 */

const mocks = vi.hoisted(() => ({
  getBoardContent: vi.fn(),
  sendBoardCommand: vi.fn(),
}));

vi.mock("@/admin/admin-client", () => ({
  adminApi: {
    getBoardContent: mocks.getBoardContent,
    sendBoardCommand: mocks.sendBoardCommand,
  },
}));

vi.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// The editor's matrix is not this contract: a button reports a draft.
vi.mock("@/components/board/WorkflowEditor", () => ({
  WorkflowEditor: ({
    onDirtyChange,
  }: {
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="workflow-make-dirty"
      onClick={() => onDirtyChange?.(true)}
    >
      Edit workflow
    </button>
  ),
}));

const BOARD: BoardAggregate = {
  id: "board-1",
  title: "Board one",
  columns: [
    { id: "todo", title: "Todo", cardIds: [], createdAt: 1 },
    { id: "doing", title: "Doing", cardIds: [], createdAt: 1 },
  ],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function renderPage(initialEntries = ["/admin/boards/board-1"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/boards/:boardId",
        element: <div data-testid="board-detail">detail</div>,
      },
      {
        path: "/admin/boards/:boardId/workflow",
        element: <BoardWorkflowPage />,
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  render(
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>,
  );
  return router;
}

async function makeDirty() {
  fireEvent.click(await screen.findByTestId("workflow-make-dirty"));
}

function navigate(
  router: ReturnType<typeof createMemoryRouter>,
  to: string | number,
) {
  return act(async () => {
    if (typeof to === "number") void router.navigate(to);
    else void router.navigate(to);
    await Promise.resolve();
  });
}

describe("BoardWorkflowPage discard blocker (M39)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBoardContent.mockResolvedValue(BOARD);
  });

  it("confirms browser Back and query/hash navigation", async () => {
    const router = renderPage([
      "/admin/boards/board-1",
      "/admin/boards/board-1/workflow?draft=1&lng=ru#old",
    ]);
    await makeDirty();

    await navigate(router, -1);
    expect(
      await screen.findByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Discard workflow changes?" }),
      ).toBeNull(),
    );
    expect(router.state.location.pathname).toBe(
      "/admin/boards/board-1/workflow",
    );

    await navigate(router, "/admin/boards/board-1/workflow?draft=2#old");
    expect(
      await screen.findByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await navigate(router, "/admin/boards/board-1/workflow?draft=2#new");
    expect(
      await screen.findByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(router.state.location.hash).toBe("#new"));
    expect(router.state.location.search).toBe("?draft=2");
    expect(
      screen.queryByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeNull();
  });

  it("keeps the editor panel from shrinking inside the page scroller", async () => {
    renderPage(["/admin/boards/board-1/workflow"]);
    const panel = (await screen.findByTestId("workflow-make-dirty")).closest(
      "section",
    );
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("shrink-0");
  });

  it("lets the consumed ?lng= handoff through without a prompt", async () => {
    const router = renderPage([
      "/admin/boards/board-1/workflow?draft=1&lng=ru#old",
    ]);
    await makeDirty();

    await navigate(router, "/admin/boards/board-1/workflow?draft=1#old");

    await waitFor(() => expect(router.state.location.search).toBe("?draft=1"));
    expect(
      screen.queryByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeNull();
    expect(screen.getByTestId("workflow-make-dirty")).toBeInTheDocument();

    // Every other query parameter remains a real draft-changing navigation.
    await navigate(router, "/admin/boards/board-1/workflow?draft=1&tab=x#old");
    expect(
      await screen.findByRole("dialog", { name: "Discard workflow changes?" }),
    ).toBeVisible();
  });
});
