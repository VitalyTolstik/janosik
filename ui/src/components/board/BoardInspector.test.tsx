import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardMemberDto } from "@janosik/shared";

import { AuthProvider } from "@/auth/AuthContext";
import { BoardInspector } from "@/components/board/BoardInspector";
import { BoardPanelsProvider } from "@/components/board/BoardPanelsProvider";
import { useInspectorDragChange } from "@/hooks/use-board-inspector";
import { BoardPeopleProvider } from "@/components/board/BoardPeopleProvider";
import { PanelToggle } from "@/components/board/PanelToggle";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { boardPanelKey } from "@/utils/board-panel-storage";
import { FakeServer } from "@/test/fake-server";

const board: Board = {
  id: "board-1",
  title: "Launch board",
  columns: [],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function member(
  userId: string,
  role: BoardMemberDto["role"],
  expiresAt: number | null = null,
): BoardMemberDto {
  return {
    userId,
    role,
    expiresAt,
    displayName: userId,
    email: `${userId}@example.test`,
    avatarPath: null,
    avatarColor: null,
  };
}

function BoardControls() {
  const setDragging = useInspectorDragChange();
  const navigate = useNavigate();
  return (
    <main>
      <input aria-label="Board filter" />
      <button type="button" onClick={() => setDragging?.(true)}>
        Start drag
      </button>
      <button type="button" onClick={() => setDragging?.(false)}>
        End drag
      </button>
      <button type="button" onClick={() => navigate("?card=test")}>
        Open card
      </button>
      <button type="button" onClick={() => navigate("/board/board-1")}>
        Close card
      </button>
    </main>
  );
}

async function setup(
  width: number,
  server = new FakeServer([board]),
  path = "/board/board-1",
) {
  vi.stubGlobal("fetch", server.handle);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: width >= Number(/\d+/.exec(query)?.[0]),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <AuthProvider>
              <BoardProvider>
                <BoardPeopleProvider>
                  <BoardPanelsProvider boardId={board.id}>
                    <PanelToggle />
                    <BoardControls />
                    <BoardInspector boardId={board.id} />
                  </BoardPanelsProvider>
                </BoardPeopleProvider>
              </BoardProvider>
            </AuthProvider>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: /people panel/ });
  return userEvent.setup();
}

beforeEach(() => vi.stubEnv("VITE_API_URL", "/api/v1"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("board inspector", () => {
  it("discloses a named aside, keeps mouse focus and respects editing and drag guards", async () => {
    const user = await setup(1440);
    const toggle = screen.getByRole("button", { name: "Show people panel" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "]");
    const filter = screen.getByRole("textbox", { name: "Board filter" });
    await user.click(filter);
    fireEvent.keyDown(filter, { key: "ъ", code: "BracketRight" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      shiftKey: true,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide people panel");
    expect(toggle).toHaveAttribute("aria-controls", aside.id);
    expect(toggle).toHaveFocus();
    expect(aside).not.toHaveAttribute("aria-modal");

    await user.click(filter);
    await user.keyboard("{Escape}");
    expect(aside).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Start drag" }));
    expect(toggle).toBeDisabled();
    expect(
      within(aside).getByRole("button", { name: "Close inspector" }),
    ).toBeDisabled();
    fireEvent.keyDown(window, { key: "]", code: "BracketRight" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "End drag" }));

    fireEvent.keyDown(screen.getByRole("tab"), { key: "Escape" });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("focuses the first keyboard tab and links the selected tab to its panel", async () => {
    const user = await setup(1440);
    fireEvent.keyDown(window, { key: "ъ", code: "BracketRight" });
    const tablist = screen.getByRole("tablist", { name: "Inspector" });
    const tab = within(tablist).getByRole("tab", {
      name: "People",
      selected: true,
    });
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute("tabindex", "0");
    expect(tab).toHaveAttribute(
      "aria-controls",
      screen.getByRole("tabpanel").id,
    );
    await user.keyboard("{ArrowLeft}{ArrowRight}{End}{Home}");
    expect(tab).toHaveFocus();

    const resize = screen.getByRole("separator", { name: "Resize inspector" });
    expect(resize).toHaveAttribute("aria-orientation", "vertical");
    act(() => resize.focus());
    await user.keyboard("{ArrowLeft}");
    expect(resize).toHaveAttribute("aria-valuenow", "376");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(resize).toHaveAttribute("aria-valuenow", "320");
    await user.keyboard("{End}");
    expect(resize).toHaveAttribute("aria-valuenow", "480");
    await user.keyboard("{Enter}");
    expect(resize).toHaveAttribute("aria-valuenow", "360");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Show people panel" }),
    ).toHaveFocus();
  });

  it("traps focus in the overlay and returns it on Escape", async () => {
    const user = await setup(768);
    const toggle = screen.getByRole("button", { name: "Show people panel" });
    fireEvent.keyDown(window, { key: "ъ", code: "BracketRight" });
    const dialog = screen.getByRole("dialog", { name: "Inspector" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("tab")).toHaveFocus();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    for (const key of ["{Tab}", "{Tab}", "{Tab}", "{Shift>}{Tab}{/Shift}"]) {
      await user.keyboard(key);
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(dialog).not.toBeInTheDocument();
  });

  it("closes the sheet when a card link takes over", async () => {
    const user = await setup(390);
    const toggle = screen.getByRole("button", { name: "Show people panel" });
    const openCard = screen.getByRole("button", { name: "Open card" });
    const closeCard = screen.getByRole("button", { name: "Close card" });
    await user.click(toggle);
    const dialog = screen.getByRole("dialog", { name: "Inspector" });
    fireEvent.click(openCard);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    fireEvent.click(closeCard);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("makes the docked aside inert while a card link is open", async () => {
    const user = await setup(1440);
    const toggle = screen.getByRole("button", { name: "Show people panel" });
    await user.click(toggle);
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    await user.click(screen.getByRole("button", { name: "Open card" }));
    expect(aside).toHaveAttribute("inert");
    expect(toggle).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close card" }));
    expect(aside).not.toHaveAttribute("inert");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("shows online members and roles, skips lapsed access, and hands off to Members", async () => {
    const server = new FakeServer([board]);
    const admin = member("user-1", "ADMIN");
    const viewer = member("Viewer", "VIEWER");
    const lapsed = member("Lapsed", "VIEWER", 1);
    server.membersByBoard.set(board.id, [admin, viewer, lapsed]);
    server.initialPresence = [
      {
        id: admin.userId,
        displayName: admin.userId,
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: lapsed.userId,
        displayName: lapsed.userId,
        avatarColor: null,
        avatarPath: null,
      },
    ];
    const user = await setup(768, server);
    await user.click(screen.getByRole("button", { name: "Show people panel" }));
    const inspector = screen.getByRole("dialog", { name: "Inspector" });
    const online = within(inspector).getByRole("region", {
      name: "On this board now",
    });
    const offline = within(inspector).getByRole("region", {
      name: "Other members",
    });
    expect(
      await within(online).findByText("user-1", { exact: false }),
    ).toBeVisible();
    expect(within(online).getByText("Admin", { exact: false })).toBeVisible();
    expect(
      within(offline).getAllByText("Viewer", { exact: false }),
    ).toHaveLength(2);
    expect(within(inspector).queryByText("Lapsed")).not.toBeInTheDocument();
    const members = within(inspector).getByRole("button", { name: "Members" });
    await user.click(members);
    expect(await screen.findByTestId("board-members-box")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(members).toHaveFocus());
    expect(inspector).toBeVisible();
  });

  it("shows an archived roster without admin dialog actions or live presence", async () => {
    const server = new FakeServer([
      {
        ...board,
        archivedAt: 1,
        columns: [
          { id: "col", title: "Todo", cardIds: ["card"], createdAt: 1 },
        ],
        cards: {
          card: {
            id: "card",
            title: "Archived card",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    ]);
    server.membersByBoard.set(board.id, [member("user-1", "ADMIN")]);
    localStorage.setItem(
      boardPanelKey("user-1", board.id),
      JSON.stringify({
        version: 1,
        right: { open: true, width: 360, tab: "people" },
      }),
    );
    await setup(1440, server, "/board/board-1?card=card");
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(await within(aside).findByText(/archived.*read-only/)).toBeVisible();
    expect(
      within(aside).queryByRole("button", { name: "Members" }),
    ).not.toBeInTheDocument();
    expect(
      within(aside).queryByRole("button", { name: "Share" }),
    ).not.toBeInTheDocument();
    expect(
      within(aside).queryByText("On this board now"),
    ).not.toBeInTheDocument();
  });
});
