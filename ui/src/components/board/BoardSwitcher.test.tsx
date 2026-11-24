import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@janosik/shared";

import { api } from "@/api/client";
import { BoardSection } from "@/components/BoardSection";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { NoBoardRoute } from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoardActions } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * Board switcher: lists boards (with card counts and the active check),
 * live search, keyboard navigation, inline create (navigates to the new
 * board), archiving (Trello's close-board: data kept, hidden from the
 * active list) with an archived section (restore / delete-for-good).
 */

function boardJson(id: string, title: string) {
  return JSON.stringify({
    id,
    title,
    columns: [{ id: `${id}-col`, title: "To do", cardIds: [], createdAt: 1 }],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  });
}

let boardActions: ReturnType<typeof useBoardActions> | null = null;

function BoardActionsProbe() {
  boardActions = useBoardActions();
  return null;
}

function renderSwitcher(initialUrl = routes.board("b-1")) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[initialUrl]}>
                <BoardProvider>
                  <BoardTitle />
                  <BoardSwitcher />
                  <BoardActionsProbe />
                  <Routes>
                    <Route path={routes.home} element={<NoBoardRoute />} />
                    <Route
                      path={routes.boardPattern}
                      element={<BoardSection />}
                    />
                  </Routes>
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

function seedTwoBoards() {
  localStorage.setItem(
    "janosik-boards",
    `[${boardJson("b-1", "Alpha")},${boardJson("b-2", "Beta")}]`,
  );
}

async function openSwitcher() {
  fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
  const dialog = await screen.findByRole("dialog", { name: "Switch board" });
  return within(dialog).getByRole("grid", { name: "Switch board" });
}

describe("BoardSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    seedTwoBoards();
  });

  it("lists all boards with the active one marked", async () => {
    renderSwitcher();
    const grid = await openSwitcher();
    expect(grid).toHaveTextContent("Alpha");
    expect(grid).toHaveTextContent("Beta");
    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(1);
  });

  it("counts active cards without archived cards", async () => {
    const board = JSON.parse(boardJson("b-1", "Alpha"));
    board.columns[0].cardIds = ["active"];
    board.cards = {
      active: {
        id: "active",
        title: "Active",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      archived: {
        id: "archived",
        title: "Archived",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 2,
      },
    };
    localStorage.setItem("janosik-boards", JSON.stringify([board]));
    renderSwitcher();
    await openSwitcher();
    const row = screen.getByRole("row", { name: /Alpha/ });
    expect(row).toHaveTextContent("Alpha1");
    expect(within(row).getByLabelText("1 active card")).toHaveTextContent("1");
  });

  it("updates the count when a card is archived and restored", async () => {
    const board = JSON.parse(boardJson("b-1", "Alpha"));
    board.columns[0].cardIds = ["active"];
    board.cards = {
      active: {
        id: "active",
        title: "Active",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    localStorage.setItem("janosik-boards", JSON.stringify([board]));
    renderSwitcher();
    await openSwitcher();

    const row = screen.getByRole("row", { name: /Alpha/ });
    expect(row).toHaveTextContent("Alpha1");
    expect(within(row).getByLabelText("1 active card")).toHaveTextContent("1");

    act(() => boardActions?.archiveCard("active"));
    await waitFor(() => expect(row).toHaveTextContent("Alpha0"));
    expect(within(row).getByLabelText("0 active cards")).toHaveTextContent("0");

    act(() => boardActions?.unarchiveCard("active", "b-1-col"));
    await waitFor(() => expect(row).toHaveTextContent("Alpha1"));
    expect(within(row).getByLabelText("1 active card")).toHaveTextContent("1");
  });

  it("filters boards by search query", async () => {
    renderSwitcher();
    await openSwitcher();
    const input = screen.getByLabelText("Search boards…");
    await userEvent.type(input, "bet");
    expect(screen.getByRole("grid")).toHaveTextContent("Beta");
    expect(screen.getByRole("grid")).not.toHaveTextContent("Alpha");
  });

  it("shows an empty state when nothing matches", async () => {
    renderSwitcher();
    await openSwitcher();
    await userEvent.type(screen.getByLabelText("Search boards…"), "zzz");
    expect(screen.getByText("No boards match")).toBeInTheDocument();
  });

  it("exposes the highlighted board and keeps row actions accessible", async () => {
    renderSwitcher();
    const grid = await openSwitcher();
    const input = screen.getByRole("combobox", { name: "Search boards…" });
    expect(input).toHaveAttribute("aria-controls", grid.id);
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const row = within(grid).getByRole("row", { selected: true });
    expect(row).toHaveTextContent("Beta");
    expect(input).toHaveAttribute("aria-activedescendant", row.id);
    expect(
      within(row).getByRole("button", { name: "Archive board" }),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zzz" } });
    // Openness describes the popup, not whether any result matched.
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("reports popover openness, not the result count, in aria-expanded (M41)", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Switch board" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await openSwitcher();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const input = screen.getByRole("combobox", { name: "Search boards…" });
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No boards match")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
    // `aria-expanded=true` must not point at a hidden grid: the empty
    // result list stays mounted (with no rows) under the message.
    expect(screen.getByRole("grid", { name: "Switch board" })).toBeVisible();
    expect(
      screen.getByRole("grid", { name: "Switch board" }),
    ).not.toHaveAttribute("hidden");

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  });

  it("keeps longer search queries while capping the empty-board prefill", async () => {
    renderSwitcher();
    await openSwitcher();
    const input = screen.getByRole("combobox", { name: "Search boards…" });
    fireEvent.change(input, { target: { value: "x".repeat(101) } });
    expect(input).toHaveValue("x".repeat(101));

    fireEvent.click(screen.getByTestId("switcher-create-empty"));
    const name = await screen.findByLabelText("Board name");
    expect(name).toHaveValue("x".repeat(100));
    expect(name).toHaveAttribute("maxlength", "100");
    expect(screen.getByTestId("switcher-create-empty-submit")).toBeEnabled();
  });

  it("navigates with ArrowDown + Enter", async () => {
    renderSwitcher();
    await openSwitcher();
    const input = screen.getByLabelText("Search boards…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    });
  });

  it("opens the shared template gallery from quick-create", async () => {
    renderSwitcher();
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-template"));

    const picker = await screen.findByTestId("template-picker");
    // The popover closed before the dialog mounted: one focus layer only.
    expect(
      screen.queryByRole("dialog", { name: "Switch board" }),
    ).not.toBeInTheDocument();
    expect(
      within(picker).getByRole("button", { name: /Product launch/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const name = within(picker).getByLabelText("Board name");
    expect((name as HTMLInputElement).value).toMatch(/^Product launch — /);
    expect(
      within(picker).getByRole("region", { name: /Preview: Product launch/ }),
    ).toBeVisible();
    // Nothing is created until the picker's CTA.
    expect(JSON.parse(localStorage.getItem("janosik-boards")!)).toHaveLength(2);
  });

  it("creates a template board, refreshes the switcher and opens it", async () => {
    renderSwitcher();
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-template"));

    const picker = await screen.findByTestId("template-picker");
    await userEvent.click(
      within(picker).getByRole("button", { name: /Sprint board/ }),
    );
    const name = (
      within(picker).getByLabelText("Board name") as HTMLInputElement
    ).value;
    expect(name).toMatch(/^Sprint board \d{4}-W\d{2}$/);

    fireEvent.click(within(picker).getByTestId("template-create-board"));
    expect(await screen.findByText("Board created")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open board" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });
    // The shared catalog supplied real starter content, not an empty board.
    expect(await screen.findByText("Ship saved views")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
    const grid = await screen.findByRole("grid", { name: "Switch board" });
    expect(within(grid).getByRole("gridcell", { name })).toBeInTheDocument();
  });

  it("gates empty-board creation behind an explicit name", async () => {
    renderSwitcher();
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-empty"));

    const name = await screen.findByLabelText("Board name");
    const submit = screen.getByTestId("switcher-create-empty-submit");
    expect(name).toHaveValue("");
    expect(submit).toBeDisabled();
    expect(screen.getByText("Empty boards need a name.")).toBeVisible();

    await userEvent.type(name, "Gamma");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Gamma" }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
    const grid = await screen.findByRole("grid", { name: "Switch board" });
    expect(within(grid).getByRole("gridcell", { name: "Gamma" })).toBeVisible();
  });

  it("seeds the name-gated empty-board form from a search query", async () => {
    renderSwitcher();
    await openSwitcher();
    await userEvent.type(screen.getByLabelText("Search boards…"), "Delta");
    fireEvent.click(screen.getByTestId("switcher-create-empty"));

    const name = await screen.findByLabelText("Board name");
    expect(name).toHaveValue("Delta");
    expect(screen.getByTestId("switcher-create-empty-submit")).toBeEnabled();
    await userEvent.click(screen.getByTestId("switcher-create-empty-submit"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Delta" }),
      ).toBeInTheDocument();
    });
  });

  it("returns focus to the switcher trigger after closing the picker", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Switch board" });
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-template"));

    const picker = await screen.findByTestId("template-picker");
    await waitFor(() =>
      expect(
        within(picker).getByRole("button", { name: /Product launch/ }),
      ).toHaveFocus(),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("template-picker")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("archives a non-active board after inline confirm (data kept)", async () => {
    renderSwitcher();
    const grid = await openSwitcher();
    // Beta is not active — hover its row to reveal the archive button.
    const betaRow = grid.querySelector<HTMLElement>('[data-index="1"]')!;
    fireEvent.mouseEnter(betaRow);
    fireEvent.click(
      within(betaRow).getByRole("button", { name: "Archive board" }),
    );
    // Confirm with the dedicated yes-button.
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, archive" }),
    );
    await waitFor(() => {
      // Beta left the active list…
      const options = screen.getAllByRole("row");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Alpha");
    });
    // …but landed in the archived section (nothing was destroyed).
    expect(screen.getByTestId("archived-section")).toHaveTextContent("Beta");
    // Still on the untouched board.
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("archiving the active board navigates to the remaining one", async () => {
    renderSwitcher();
    const grid = await openSwitcher();
    const alphaRow = grid.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(
      within(alphaRow).getByRole("button", { name: "Archive board" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, archive" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    });
  });

  it("restores an archived board back to the active list", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        JSON.parse(boardJson("b-1", "Alpha")),
        { ...JSON.parse(boardJson("b-2", "Beta")), archivedAt: 123 },
      ]),
    );
    renderSwitcher();
    await openSwitcher();
    // Beta is archived — only Alpha is navigable.
    expect(screen.getAllByRole("row")).toHaveLength(1);
    expect(screen.getByTestId("archived-section")).toHaveTextContent("Beta");
    const archivedSection = screen.getByTestId("archived-section");
    fireEvent.click(
      within(archivedSection).getByRole("button", { name: "Restore board" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("archived-section")).toBeNull();
    });
    // Beta is a real option again (and the header shows Alpha still).
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("soft-deletes an archived board after confirm", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        JSON.parse(boardJson("b-1", "Alpha")),
        { ...JSON.parse(boardJson("b-2", "Beta")), archivedAt: 123 },
      ]),
    );
    renderSwitcher();
    await openSwitcher();
    const archivedSection = screen.getByTestId("archived-section");
    fireEvent.click(
      within(archivedSection).getByRole("button", { name: "Delete board" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));
    await waitFor(() => {
      expect(screen.queryByTestId("archived-section")).toBeNull();
    });
    // Alpha remains active.
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("does not offer restore/delete for active boards (only archive)", async () => {
    renderSwitcher();
    const grid = await openSwitcher();
    const alphaRow = grid.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    expect(
      within(alphaRow).getByRole("button", { name: "Archive board" }),
    ).toBeInTheDocument();
    expect(
      within(alphaRow).queryByRole("button", { name: "Delete board" }),
    ).toBeNull();
    expect(screen.queryByTestId("archived-section")).toBeNull();
  });

  it("archiving the only board shows the empty state, not the archived board", async () => {
    localStorage.setItem("janosik-boards", `[${boardJson("b-1", "Alpha")}]`);
    renderSwitcher();
    const grid = await openSwitcher();
    const alphaRow = grid.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(
      within(alphaRow).getByRole("button", { name: "Archive board" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, archive" }),
    );
    // The empty-state screen replaces the board (never stranded on an
    // archived board), and the still-open popover offers restoration. The
    // form does not autofocus here, so it must not steal focus from it.
    expect(await screen.findByTestId("empty-create-board")).toBeInTheDocument();
    expect(screen.getByText("All boards are archived.")).toBeInTheDocument();
    const archived = await screen.findByTestId("archived-section");
    expect(archived).toHaveTextContent("Alpha");
    // Restoring brings the board (and the route) back.
    fireEvent.click(
      within(archived).getByRole("button", { name: "Restore board" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Alpha" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("empty-create-board")).toBeNull();
  });

  it("creates a board from the empty-state CTA and navigates to it", async () => {
    localStorage.setItem("janosik-boards", `[${boardJson("b-1", "Alpha")}]`);
    renderSwitcher();
    const grid = await openSwitcher();
    const alphaRow = grid.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(
      within(alphaRow).getByRole("button", { name: "Archive board" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, archive" }),
    );
    await userEvent.type(
      await screen.findByTestId("empty-board-name"),
      "Ancient board",
    );
    fireEvent.click(screen.getByTestId("empty-create-board"));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Ancient board" }),
      ).toBeInTheDocument();
    });
  });

  it("keeps board actions reachable on touch (no-hover) devices", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        JSON.parse(boardJson("b-1", "Alpha")),
        { ...JSON.parse(boardJson("b-2", "Beta")), archivedAt: 123 },
      ]),
    );
    renderSwitcher();
    const grid = await openSwitcher();
    // The swap slot trades the checkmark for the archive action on touch —
    // the row is the only path to archive a board.
    const alphaRow = grid.querySelector<HTMLElement>('[data-index="0"]')!;
    expect(
      within(alphaRow).getByRole("button", { name: "Archive board" }).className,
    ).toContain("no-hover:opacity-100");
    expect(
      alphaRow.querySelector("svg.lucide-check")?.getAttribute("class"),
    ).toContain("no-hover:hidden");
    // Archived rows: restore/delete stay visible — the switcher is their
    // only path.
    const archivedSection = screen.getByTestId("archived-section");
    expect(
      within(archivedSection).getByRole("button", { name: "Restore board" })
        .className,
    ).toContain("no-hover:opacity-100");
    expect(
      within(archivedSection).getByRole("button", { name: "Delete board" })
        .className,
    ).toContain("no-hover:opacity-100");
  });
});

/**
 * Role sections (TASK-36.2): boards I administer come first under an
 * explicit header, boards shared with me follow, and the action slot on a
 * shared row shows the access level (`member` can edit, `viewer` is
 * read-only) where an admin would get the archive button — so the missing
 * action reads as an access level, not a glitch.
 */
describe("BoardSwitcher role sections (server mode)", () => {
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

  function serverBoard(id: string, title: string): Board {
    return JSON.parse(boardJson(id, title)) as Board;
  }

  function renderServerSwitcher(server: FakeServer) {
    vi.stubGlobal("fetch", server.handle);
    return renderSwitcher();
  }

  it("splits my boards from shared ones and labels the access", async () => {
    const server = new FakeServer([
      serverBoard("b-1", "Alpha"),
      serverBoard("b-2", "Beta"),
      serverBoard("b-3", "Gamma"),
    ]);
    server.roles.set("b-2", "MEMBER");
    server.roles.set("b-3", "VIEWER");
    renderServerSwitcher(server);
    await openSwitcher();

    expect(await screen.findByTestId("board-group-mine")).toHaveTextContent(
      "My boards",
    );
    expect(screen.getByTestId("board-group-shared")).toHaveTextContent(
      "Shared with me",
    );
    // The group headings are real grid rows with an accessible name, not
    // hidden text inside a grid whose rows skip the section.
    expect(screen.getByRole("row", { name: "My boards" })).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: "Shared with me" }),
    ).toBeInTheDocument();

    const options = screen
      .getAllByRole("row")
      .filter((row) => row.dataset.index !== undefined);
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Beta"),
      expect.stringContaining("Gamma"),
    ]);
    // ADMIN boards keep the archive action; shared rows trade it for the
    // access icon (tooltip + accessible name).
    expect(
      within(options[0]).getByRole("button", { name: "Archive board" }),
    ).toBeInTheDocument();
    expect(
      within(options[1]).queryByRole("button", { name: "Archive board" }),
    ).toBeNull();
    expect(within(options[1]).getByTestId("board-role")).toHaveAttribute(
      "aria-label",
      "Member — can edit",
    );
    expect(within(options[2]).getByTestId("board-role")).toHaveAttribute(
      "aria-label",
      "Viewer — view only",
    );
  });

  it("offers Leave board from the switcher for a shared board", async () => {
    const server = new FakeServer([
      serverBoard("b-1", "Alpha"),
      serverBoard("b-2", "Beta"),
    ]);
    server.roles.set("b-2", "MEMBER");
    renderServerSwitcher(server);
    await openSwitcher();
    await screen.findByTestId("board-group-shared");

    const beta = screen
      .getAllByRole("row")
      .find(
        (row) =>
          row.dataset.index !== undefined && row.textContent?.includes("Beta"),
      );
    expect(beta).toBeDefined();
    fireEvent.click(
      within(beta!).getByRole("button", { name: "Leave board — Beta" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes, leave" }));
    await waitFor(() => expect(server.revoked.has("b-2")).toBe(true));
  });

  it("offers Leave for a shared archived board too", async () => {
    const archived = {
      ...serverBoard("b-2", "Beta"),
      archivedAt: Date.now(),
    } as Board;
    const server = new FakeServer([serverBoard("b-1", "Alpha"), archived]);
    server.roles.set("b-2", "MEMBER");
    renderServerSwitcher(server);
    await openSwitcher();

    const section = await screen.findByTestId("archived-section");
    fireEvent.click(
      within(section).getByTestId("board-switcher-archived-leave"),
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Yes, leave" }),
    );
    await waitFor(() => expect(server.revoked.has("b-2")).toBe(true));
  });

  it("keeps the flat list when everyone is admin", async () => {
    const server = new FakeServer([
      serverBoard("b-1", "Alpha"),
      serverBoard("b-2", "Beta"),
    ]);
    renderServerSwitcher(server);
    await openSwitcher();

    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.queryByTestId("board-group-mine")).toBeNull();
    expect(screen.queryByTestId("board-group-shared")).toBeNull();
    expect(screen.queryByTestId("board-role")).toBeNull();
  });

  it("keeps a single matching group unlabelled", async () => {
    const server = new FakeServer([
      serverBoard("b-1", "Alpha"),
      serverBoard("b-2", "Shared beta"),
    ]);
    server.roles.set("b-2", "MEMBER");
    renderServerSwitcher(server);
    await openSwitcher();
    await screen.findByTestId("board-group-mine");

    // Only the shared board matches: the list is flat again — no header
    // explaining a split that is not there anymore.
    await userEvent.type(screen.getByLabelText("Search boards…"), "shared");
    expect(screen.queryByTestId("board-group-mine")).toBeNull();
    expect(screen.queryByTestId("board-group-shared")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("arrows through both sections in screen order", async () => {
    const server = new FakeServer([
      serverBoard("b-1", "Alpha"),
      serverBoard("b-2", "Beta"),
      serverBoard("b-3", "Gamma"),
    ]);
    server.roles.set("b-2", "MEMBER");
    server.roles.set("b-3", "VIEWER");
    renderServerSwitcher(server);
    await openSwitcher();
    await screen.findByTestId("board-group-mine");

    // The cursor walks the flat, on-screen order: Alpha → Beta → Gamma,
    // across the section boundary (the group headings are rows too, but carry
    // no data-index and never join the roving cursor).
    const input = screen.getByLabelText("Search boards…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("row", { selected: true })).toHaveTextContent(
      "Gamma",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Gamma" }),
      ).toBeInTheDocument();
    });
  });

  it("creates a template board through the server contract", async () => {
    const server = new FakeServer([serverBoard("b-1", "Alpha")]);
    renderServerSwitcher(server);
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-template"));

    const picker = await screen.findByTestId("template-picker");
    const name = (
      within(picker).getByLabelText("Board name") as HTMLInputElement
    ).value;
    fireEvent.click(within(picker).getByTestId("template-create-board"));
    expect(await screen.findByText("Board created")).toBeVisible();

    const createRequest = server.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/api/v1/boards",
    );
    expect(createRequest?.body).toMatchObject({
      title: name,
      template: "product-launch",
      templateLocale: "en",
      templateDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      templateUtcOffsetMinutes: expect.any(Number),
    });
    expect(server.boards.size).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Open board" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
    const grid = await screen.findByRole("grid", { name: "Switch board" });
    expect(within(grid).getByRole("gridcell", { name })).toBeVisible();
  });

  it("offers the empty-board fallback when the server rejects a template", async () => {
    const server = new FakeServer([serverBoard("b-1", "Alpha")]);
    renderServerSwitcher(server);
    await openSwitcher();
    fireEvent.click(screen.getByTestId("switcher-create-template"));

    const picker = await screen.findByTestId("template-picker");
    const name = (
      within(picker).getByLabelText("Board name") as HTMLInputElement
    ).value;
    server.failNextRequest(400, {
      message: "Unknown template",
      field: "template",
    });
    fireEvent.click(within(picker).getByTestId("template-create-board"));
    expect(
      await screen.findByText(/isn’t available in this version/),
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Create empty board" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    });
    // One failed template attempt + one explicit empty-board fallback.
    expect(
      server.requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/api/v1/boards",
      ),
    ).toHaveLength(2);
    expect(server.boards.size).toBe(2);
  });
});
