import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";

import { api } from "@/api/client";
import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * Role wiring (TASK-35): `GET /boards` carries the caller's role, the store
 * exposes it through `roleOf`, and BoardSection turns a VIEWER into the
 * read-only board. This is the one test that proves the whole chain — the
 * per-component read-only behaviour is covered with explicit props.
 */

const SERVER_BOARD: Board = {
  id: "b-1",
  title: "Server board",
  columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
  cards: {
    "c-1": {
      id: "c-1",
      title: "Server card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function renderApp(entry = "/board/b-1") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[entry]}>
                <ToastProvider>
                  <BoardProvider>
                    <Header />
                    <BoardSection />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

function renderHeader(entry = "/board/b-1") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[entry]}>
                <ToastProvider>
                  <BoardProvider>
                    <Header />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("BoardSection role wiring (TASK-35)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the board read-only for a VIEWER", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    server.role = "VIEWER";
    vi.stubGlobal("fetch", server.handle);

    const { container } = renderApp();

    expect(
      await screen.findByText("Server card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-composer-trigger]")).toBeNull();
    expect(container.querySelector("[data-add-column-trigger]")).toBeNull();
    // The members dialog is available to every role (read-only for a VIEWER),
    // behind the single People entry (H1).
    fireEvent.pointerDown(screen.getByTestId("people-trigger"), {
      button: 0,
      pointerType: "mouse",
    });
    expect(
      await screen.findByRole("menuitem", { name: "Members" }),
    ).toBeInTheDocument();
  });

  it("keeps the composers for an ADMIN (control)", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    vi.stubGlobal("fetch", server.handle);

    const { container } = renderApp();

    expect(
      await screen.findByText("Server card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-composer-trigger]")).not.toBeNull();
    expect(container.querySelector("[data-add-column-trigger]")).not.toBeNull();
  });

  it("opens an archived board's card deep link as a read-only view", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 1_700_000 }]);
    vi.stubGlobal("fetch", server.handle);

    const { container } = renderApp("/board/b-1?card=c-1");

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Card details" },
      { timeout: 15_000 },
    );
    expect(within(dialog).getByLabelText("Title")).toHaveAttribute("readonly");
    // Both the board surface and the dialog say why nothing is editable, and
    // an ADMIN can restore the board right here (QA-03 UX review).
    const boardNotice = within(screen.getByTestId("board-main")).getByTestId(
      "archived-board-notice",
    );
    expect(boardNotice).toHaveTextContent(/archived and read-only/i);
    expect(
      within(boardNotice).getByTestId("archived-board-restore"),
    ).toBeVisible();
    const dialogNotice = within(dialog).getByTestId("archived-board-notice");
    expect(dialogNotice).toHaveTextContent(/archived and read-only/i);
    expect(
      await within(dialogNotice).findByRole("button", {
        name: "Restore board",
      }),
    ).toBeVisible();
    // The actions menu keeps the read-only "open in a new tab" entry, but no
    // mutating item is offered (QA-03).
    fireEvent.pointerDown(
      within(dialog).getByRole("button", { name: "Card actions" }),
      { button: 0, pointerType: "mouse", ctrlKey: false },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Open in new tab" }),
    ).toBeInTheDocument();
    for (const name of ["Duplicate card", "Archive card", "Delete card"]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
    // The header is a readout too: no rename, no undo stack, no settings
    // dialog that could dispatch an archived write.
    expect(screen.queryByTestId("board-rename")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByTestId("board-settings-trigger")).toBeNull();
    // Members, sharing and agent control would expose admin writes that the
    // archived guard refuses, so they stay off until restore.
    expect(screen.queryByRole("button", { name: "Members" })).toBeNull();
    expect(screen.queryByTestId("share-trigger")).toBeNull();
    expect(screen.queryByTestId("agent-control-trigger")).toBeNull();
    expect(container.querySelector("[data-composer-trigger]")).toBeNull();
  });

  it("moves focus into the card after restoring an archived board", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 1_700_000 }]);
    vi.stubGlobal("fetch", server.handle);

    renderApp("/board/b-1?card=c-1");

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Card details" },
      { timeout: 15_000 },
    );
    const notice = within(dialog).getByTestId("archived-board-notice");
    fireEvent.click(within(notice).getByTestId("archived-board-restore"));
    await waitFor(() =>
      expect(within(dialog).queryByTestId("archived-board-notice")).toBeNull(),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Title")).toHaveFocus(),
    );
  });

  it("hides the unreachable Members trigger on an archived card deep link", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 1_700_000 }]);
    server.role = "VIEWER";
    server.membersByBoard.set("b-1", [
      {
        userId: "user-1",
        displayName: "Admin",
        email: "admin@example.com",
        role: "VIEWER",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    vi.stubGlobal("fetch", server.handle);

    renderHeader("/board/b-1?card=c-1");

    // The mandatory card dialog makes the header inert: a Members trigger
    // rendered behind it cannot be reached. Leave stays available through
    // the switcher's archived section instead.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Members" })).toBeNull(),
    );
  });

  it("asks a non-admin to have an archived board restored", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 1_700_000 }]);
    server.role = "MEMBER";
    vi.stubGlobal("fetch", server.handle);

    renderApp("/board/b-1?card=c-1");

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Card details" },
      { timeout: 15_000 },
    );
    const dialogNotice = within(dialog).getByTestId("archived-board-notice");
    expect(dialogNotice).toHaveTextContent(/ask a board admin/i);
    expect(dialogNotice).toHaveTextContent(/board switcher/i);
    expect(
      within(dialogNotice).getByTestId("archived-board-switcher-hint"),
    ).toBeVisible();
    expect(
      within(dialogNotice).queryByTestId("archived-board-restore"),
    ).toBeNull();

    // A real control inside the modal replaces the inert header menu.
    fireEvent.click(within(dialogNotice).getByTestId("archived-open-archive"));
    const archiveDialog = await screen.findByRole("dialog", {
      name: "Card archive",
    });
    expect(
      within(archiveDialog).getByTestId("archived-board-notice"),
    ).toBeVisible();
    expect(
      within(archiveDialog).queryByTestId("archived-open-archive"),
    ).toBeNull();
  });
});
