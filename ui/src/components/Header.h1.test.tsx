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
import type { Board, PresenceUser } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { Header } from "@/components/Header";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
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

const ADMIN: PresenceUser = {
  id: "user-1",
  displayName: "Admin",
  avatarColor: null,
  avatarPath: null,
};
const BORIS: PresenceUser = {
  id: "user-2",
  displayName: "Boris",
  avatarColor: null,
  avatarPath: null,
};

function renderHeader(server: FakeServer, path = "/board/board-1") {
  vi.stubGlobal("fetch", server.handle);
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={[path]}>
                  <AuthProvider>
                    <BoardProvider>
                      <UserProfileProvider boardId="board-1">
                        <Header />
                      </UserProfileProvider>
                    </BoardProvider>
                  </AuthProvider>
                </MemoryRouter>
              </ToastProvider>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openPeople() {
  await userEvent.click(await screen.findByTestId("people-trigger"));
}

async function openBoardMenu() {
  // A closed Radix dialog can leave `pointer-events: none` on BODY in jsdom;
  // pointerDown mirrors the real interaction without user-event's check.
  fireEvent.pointerDown(await screen.findByTestId("board-menu-trigger"), {
    button: 0,
    pointerType: "mouse",
  });
}

/** jsdom has no layout; mark candidates visible for focus-fallback paths. */
function stubVisibleLayout(): () => void {
  const original = HTMLElement.prototype.getClientRects;
  HTMLElement.prototype.getClientRects = () =>
    ({ length: 1 }) as unknown as DOMRectList;
  return () => {
    HTMLElement.prototype.getClientRects = original;
  };
}

async function closeDialog(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("H1 header: People + Board menu", () => {
  it("has one People entry and one Board menu instead of the old triggers", async () => {
    renderHeader(new FakeServer([board]));
    const people = await screen.findByTestId("people-trigger");
    expect(people).toHaveAttribute("aria-label", "People");
    expect(screen.getByTestId("board-menu-trigger")).toHaveAttribute(
      "aria-label",
      "Board menu",
    );

    for (const testId of [
      "board-members-trigger",
      "share-trigger",
      "presence-stack",
      "help-trigger",
      "board-settings-trigger",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "People" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Board menu" })).toHaveLength(
      1,
    );
  });

  it("opens members and share from People and returns focus to the trigger", async () => {
    renderHeader(new FakeServer([board]));
    await openPeople();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Members" }),
    );
    const members = await screen.findByRole("dialog", { name: /Members/ });
    expect(
      within(members).getByTestId("board-members-invite"),
    ).toBeInTheDocument();
    await closeDialog(members);
    await waitFor(() =>
      expect(screen.getByTestId("people-trigger")).toHaveFocus(),
    );

    await openPeople();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Share" }),
    );
    const share = await screen.findByRole("dialog", {
      name: "Share this board",
    });
    expect(share).toBeVisible();
    await closeDialog(share);
    await waitFor(() =>
      expect(screen.getByTestId("people-trigger")).toHaveFocus(),
    );
  });

  it("lists presence below 1200 and opens a profile from a row", async () => {
    const server = new FakeServer([board]);
    server.initialPresence = [ADMIN, BORIS];
    renderHeader(server);

    const people = await screen.findByTestId("people-trigger");
    await waitFor(() =>
      expect(people).toHaveAttribute(
        "aria-label",
        "People — 2 people on this board",
      ),
    );
    await userEvent.click(people);
    const rows = await screen.findAllByTestId("people-presence-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Admin");
    expect(rows[1]).toHaveTextContent("Boris");

    await userEvent.click(rows[1]!);
    expect(await screen.findByTestId("user-profile-dialog")).toBeVisible();
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent("Boris");
    await closeDialog(screen.getByTestId("user-profile-dialog"));
    await waitFor(() =>
      expect(screen.getByTestId("people-trigger")).toHaveFocus(),
    );
  });

  it("opens Board settings and returns focus to the Board menu", async () => {
    const restoreLayout = stubVisibleLayout();
    try {
      renderHeader(new FakeServer([board]));
      await openBoardMenu();
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "Board settings" }),
      );
      expect(await screen.findByTestId("board-settings-dialog")).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByTestId("board-settings-dialog")).toBeNull(),
      );
      await waitFor(() =>
        expect(screen.getByTestId("board-menu-trigger")).toHaveFocus(),
      );
    } finally {
      restoreLayout();
    }
  });

  it("opens Data & backups from the Board menu", async () => {
    renderHeader(new FakeServer([board]));
    await openBoardMenu();
    await userEvent.click(await screen.findByTestId("board-menu-data"));
    expect(
      await screen.findByRole("menuitem", { name: "Export this board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Export JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Import JSON" }),
    ).toBeInTheDocument();
  });

  it("opens Help and returns focus after the shortcut sheet", async () => {
    renderHeader(new FakeServer([board]));
    await openBoardMenu();
    await userEvent.click(await screen.findByTestId("board-menu-help"));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Keyboard shortcuts/ }),
    );
    expect(await screen.findByTestId("shortcuts-table")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("shortcuts-table")).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("board-menu-trigger")).toHaveFocus(),
    );
  });

  it("opens the card archive and returns focus to the Board menu", async () => {
    renderHeader(new FakeServer([board]));
    await openBoardMenu();
    await userEvent.click(await screen.findByTestId("board-menu-archive"));
    const archive = await screen.findByRole("dialog", {
      name: /Card archive/,
    });
    expect(archive).toBeVisible();
    await closeDialog(archive);
    await waitFor(() =>
      expect(screen.getByTestId("board-menu-trigger")).toHaveFocus(),
    );
  });

  it("keeps Members for a VIEWER but hides Share and Settings", async () => {
    const server = new FakeServer([board]);
    server.role = "VIEWER";
    renderHeader(server);
    await openPeople();
    expect(
      await screen.findByRole("menuitem", { name: "Members" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();

    await userEvent.keyboard("{Escape}");
    await openBoardMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Board settings" }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /Card archive/ }),
    ).toBeInTheDocument();
  });

  it("keeps the card archive reachable on an archived board and hides admin surfaces", async () => {
    const archivedBoard: Board = {
      ...board,
      archivedAt: 1_700_000,
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["card-1"], createdAt: 1 },
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
    };
    const server = new FakeServer([archivedBoard]);
    renderHeader(server, "/board/board-1?card=card-1");
    await openPeople();
    expect(screen.queryByRole("menuitem", { name: "Members" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();

    await userEvent.keyboard("{Escape}");
    await openBoardMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Board settings" }),
    ).toBeNull();
    await userEvent.click(await screen.findByTestId("board-menu-archive"));
    expect(
      await screen.findByRole("dialog", { name: /Card archive/ }),
    ).toBeVisible();
  });

  it("keeps rename on the title itself, not on a permanent header button", async () => {
    renderHeader(new FakeServer([board]));
    const title = await screen.findByTestId("board-title");
    expect(title).toHaveAttribute("tabindex", "0");
    expect(title).toHaveAttribute("aria-keyshortcuts", "Enter");
    expect(screen.getByTestId("board-rename")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The visible pencil is decorative, but the rename action keeps a real
    // button role and name for screen readers.
    expect(
      screen.getByRole("button", { name: "Rename board" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("board-rename-control")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    fireEvent.click(title);
    expect(
      await screen.findByRole("textbox", { name: "Board title" }),
    ).toBeVisible();
  });

  it("collapses the Agents label below 1280 while keeping the entry", async () => {
    renderHeader(new FakeServer([board]));
    const label = await screen.findByTestId("agent-control-label");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("min-[1280px]:inline");
    expect(screen.getByTestId("agent-control-trigger")).toHaveAttribute(
      "aria-label",
      "Agents",
    );
  });
});
