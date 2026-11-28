import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMPORT_BYTES,
  type Board,
  type PresenceUser,
} from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { BoardPeopleProvider } from "@/components/board/BoardPeopleProvider";
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
const boardWithCard: Board = {
  ...board,
  columns: [{ id: "col-1", title: "Todo", cardIds: ["card-1"], createdAt: 1 }],
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
const otherBoard: Board = { ...board, id: "board-2", title: "Release board" };

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
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <AuthProvider>
            <BoardProvider>
              <UserProfileProvider boardId="board-1">
                <BoardPeopleProvider>
                  <Header />
                </BoardPeopleProvider>
              </UserProfileProvider>
            </BoardProvider>
          </AuthProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <RouterProvider router={router} />
              </ToastProvider>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
  return router;
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

async function typeCommand(query: string) {
  const user = userEvent.setup();
  await user.keyboard("{Control>}k{/Control}");
  await user.type(
    await screen.findByTestId("global-search-input"),
    `>${query}`,
  );
  return user;
}

async function openSettings() {
  await openBoardMenu();
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Board settings" }),
  );
  return screen.findByTestId("board-settings-dialog");
}

function publishRole(server: FakeServer, role: "ADMIN" | "VIEWER") {
  server.role = role;
  server.publishMembership(board.id, server.account.id, "updated");
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

describe("header command capabilities", () => {
  it.each([
    ["members", /^Members/, "people-trigger"],
    ["share", "Share this board", "people-trigger"],
    ["settings", /Board settings/i, "board-menu-trigger"],
  ])(
    "opens the existing %s dialog and returns focus to its trigger",
    async (query, name, trigger) => {
      const restoreLayout = stubVisibleLayout();
      try {
        renderHeader(new FakeServer([board]));
        await screen.findByTestId("people-trigger");
        const user = await typeCommand(query);
        await user.keyboard("{Enter}");
        expect(await screen.findByRole("dialog", { name })).toBeVisible();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.getByTestId(trigger)).toHaveFocus());
      } finally {
        restoreLayout();
      }
    },
  );

  it("honors the viewer's People, Settings and Data capabilities", async () => {
    const server = new FakeServer([board]);
    server.role = "VIEWER";
    renderHeader(server);
    await screen.findByTestId("people-trigger");
    const user = await typeCommand("");
    expect(screen.getByRole("option", { name: "Members" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /Share|Settings/i }),
    ).toBeNull();
    await user.keyboard("backups{Enter}");
    const data = await screen.findByRole("menu", { name: "Data & backups" });
    expect(
      within(data).getByRole("menuitem", { name: "Export this board" }),
    ).toBeVisible();
    expect(within(data).queryByTestId("data-deleted")).toBeNull();
  });

  it.each([
    {
      scenario: "archived ADMIN",
      archived: true,
      allowPublicShares: true,
      expected: ["Data & backups"],
    },
    {
      scenario: "public shares disabled",
      archived: false,
      allowPublicShares: false,
      expected: ["Members", "Board settings", "Data & backups"],
    },
  ])(
    "matches the People and Board menus for $scenario",
    async ({ archived, allowPublicShares, expected }) => {
      vi.spyOn(api, "authConfig").mockResolvedValue({
        allowRegistration: true,
        allowPublicShares,
        limits: { boards: null, importBytes: MAX_IMPORT_BYTES },
      });
      const server = new FakeServer([
        archived ? { ...boardWithCard, archivedAt: 1_700_000 } : board,
      ]);
      renderHeader(server, archived ? "/board/board-1?card=card-1" : undefined);
      await openPeople();
      const people = await screen.findByRole("menu", { name: "People" });
      expect(
        within(people)
          .queryAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(archived ? [] : ["Members"]);
      await userEvent.keyboard("{Escape}");

      await openBoardMenu();
      const boardMenu = await screen.findByRole("menu", { name: "Board menu" });
      if (archived) {
        expect(
          within(boardMenu).queryByRole("menuitem", { name: "Board settings" }),
        ).toBeNull();
      } else {
        expect(
          within(boardMenu).getByRole("menuitem", { name: "Board settings" }),
        ).toBeVisible();
      }
      await userEvent.click(
        within(boardMenu).getByRole("menuitem", { name: "Data & backups" }),
      );
      const regularDataItems = screen
        .getAllByRole("menuitem")
        .filter((item) => item.closest('[role="menu"]') !== boardMenu)
        .map((item) => item.textContent);
      expect(regularDataItems).toEqual([
        "Export this board",
        "Export JSON",
        "Import JSON",
        "Recently deleted",
        "Workflow rules",
      ]);
      await userEvent.keyboard("{Escape}");
      if (screen.queryByRole("menu", { name: "Board menu" })) {
        await userEvent.keyboard("{Escape}");
      }
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

      const user = await typeCommand("");
      const labels = screen
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(
        labels.filter((label) =>
          /^(Members|Share|Board settings|Data & backups)$/.test(label ?? ""),
        ),
      ).toEqual(expected);
      await user.keyboard("export{Enter}");
      const data = await screen.findByRole("menu", { name: "Data & backups" });
      expect(
        within(data)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(regularDataItems);
      expect(
        within(data).getByRole("menuitem", { name: "Export this board" }),
      ).not.toHaveAttribute("aria-disabled");
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("header dialog lifecycle", () => {
  beforeEach(() => {
    const restoreLayout = stubVisibleLayout();
    return restoreLayout;
  });

  it.each(["archive", "live role loss"] as const)(
    "closes Settings on %s and restores focus to the Board menu",
    async (change) => {
      const server = new FakeServer([boardWithCard]);
      const path = "/board/board-1?card=card-1";
      const router = renderHeader(server, path);
      const dialog = await openSettings();
      expect(dialog).toBeVisible();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      await waitFor(() => expect(server.hasEventStream(board.id)).toBe(true));

      if (change === "archive") {
        server.publishCommand(board.id, { type: "ARCHIVE_BOARD", at: 100 });
      } else {
        publishRole(server, "VIEWER");
      }

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByTestId("board-menu-trigger")).toHaveFocus(),
      );
      expect(
        router.state.location.pathname + router.state.location.search,
      ).toBe(path);
      await openBoardMenu();
      expect(
        await screen.findByRole("menu", { name: "Board menu" }),
      ).toBeVisible();
      expect(screen.queryByTestId("board-settings-trigger")).toBeNull();
    },
  );

  it("allows normal palette search over Settings and returns focus to the new board", async () => {
    const router = renderHeader(new FakeServer([board, otherBoard]));
    const dialog = await openSettings();
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByRole("combobox", {
      name: "Search cards and boards",
    });
    await user.type(search, otherBoard.title);
    const result = await screen.findByRole("option", {
      name: /^Release board\b/,
    });
    expect(search).toHaveAttribute("aria-activedescendant", result.id);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/board/board-2"),
    );
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByTestId("board-title")).toHaveTextContent(
      otherBoard.title,
    );
    await waitFor(() =>
      expect(screen.getByTestId("board-menu-trigger")).toHaveFocus(),
    );
  });

  it("returns focus to the destination header when navigation removes Settings and the Board menu", async () => {
    const router = renderHeader(new FakeServer([board]));
    const dialog = await openSettings();
    expect(dialog).toBeVisible();
    await act(() => router.navigate("/agents"));

    expect(dialog).not.toBeInTheDocument();
    expect(screen.queryByTestId("board-menu-trigger")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("agents-home")).toHaveFocus(),
    );
  });

  it("returns palette focus to the brand link when navigation removes the search trigger", async () => {
    const router = renderHeader(new FakeServer([board]));
    await screen.findByTestId("people-trigger");
    const trigger = screen.getByRole("button", { name: "Search" });
    await userEvent.click(trigger);
    const search = await screen.findByTestId("global-search-input");
    expect(search).toHaveFocus();
    await act(() => router.navigate("/unknown"));

    expect(trigger).not.toBeInTheDocument();
    expect(search).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("brand-home")).toHaveFocus());
  });

  describe.each([
    { entry: "Members", dialogName: /^Members/ },
    { entry: "Share", dialogName: "Share this board" },
  ])("$entry dialog", ({ entry, dialogName }) => {
    it.each(["board switch", "archive", "live role change"] as const)(
      "resets on %s and stays closed when the original scope returns",
      async (change) => {
        const server = new FakeServer([boardWithCard, otherBoard]);
        const path = "/board/board-1?card=card-1";
        const router = renderHeader(server, path);
        await openPeople();
        await userEvent.click(
          await screen.findByRole("menuitem", { name: entry }),
        );
        const dialog = await screen.findByRole("dialog", { name: dialogName });
        expect(dialog).toBeVisible();
        await waitFor(() => expect(server.hasEventStream(board.id)).toBe(true));

        if (change === "board switch") {
          await act(() => router.navigate("/board/board-2"));
          expect(screen.getByTestId("board-title")).toHaveTextContent(
            otherBoard.title,
          );
        } else if (change === "archive") {
          server.publishCommand(board.id, { type: "ARCHIVE_BOARD", at: 100 });
        } else {
          publishRole(server, "VIEWER");
        }
        await waitFor(() => expect(dialog).not.toBeInTheDocument());
        await waitFor(() =>
          expect(screen.getByTestId("people-trigger")).toHaveFocus(),
        );
        expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();

        if (change === "board switch") {
          await act(() => router.navigate(path));
        } else if (change === "archive") {
          await waitFor(() =>
            expect(server.hasEventStream(board.id)).toBe(true),
          );
          server.publishCommand(board.id, { type: "UNARCHIVE_BOARD", at: 101 });
        } else {
          publishRole(server, "ADMIN");
        }
        await waitFor(() =>
          expect(screen.getByTestId("board-title")).toHaveAttribute(
            "aria-keyshortcuts",
            "Enter",
          ),
        );
        expect(screen.getByTestId("board-title")).toHaveTextContent(
          board.title,
        );
        expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
        await openPeople();
        await userEvent.click(
          await screen.findByRole("menuitem", { name: entry }),
        );
        expect(
          await screen.findByRole("dialog", { name: dialogName }),
        ).toBeVisible();
      },
    );
  });
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

  it("keeps the People presence faces decorative and leaves the account entry distinct", async () => {
    const server = new FakeServer([board]);
    server.initialPresence = [ADMIN, BORIS];
    renderHeader(server);

    const people = await screen.findByTestId("people-trigger");
    await waitFor(() =>
      expect(people).toHaveAccessibleName(
        "People — 2 people on this board — A B",
      ),
    );
    // The visible initials must carry the same separators as the name,
    // otherwise axe's label-content-name check sees "AB".
    expect(people).toHaveTextContent("A B");
    // The avatar stack is grouped under the People icon and hidden from the
    // accessibility tree: it must never compete with the account trigger.
    const group = screen.getByTestId("people-presence-group");
    expect(group).toHaveAttribute("aria-hidden", "true");
    expect(within(people).getAllByTestId("people-avatar")).toHaveLength(2);
    expect(within(people).queryByTestId("people-overflow")).toBeNull();
    expect(within(people).queryByText("Admin")).toBeNull();
    expect(screen.getByTestId("account-trigger")).toHaveAccessibleName(/Admin/);
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
        "People — 2 people on this board — A B",
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
      ...boardWithCard,
      archivedAt: 1_700_000,
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

  it("keeps the read-only roster reachable for an archived MEMBER", async () => {
    const archivedBoard: Board = {
      ...board,
      archivedAt: 1_700_000,
    };
    const activeBoard: Board = { ...board, id: "board-2", title: "Active" };
    const server = new FakeServer([archivedBoard, activeBoard]);
    server.role = "MEMBER";
    renderHeader(server, "/board/board-1");

    await openPeople();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Members" }),
    );
    expect(
      await screen.findByRole("dialog", { name: /Members/ }),
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
