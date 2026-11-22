import { fireEvent, render, screen, within } from "@testing-library/react";
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
    // The members dialog is available to every role (read-only for a VIEWER).
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
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
    // The header is a readout too: no rename, no undo stack.
    expect(screen.queryByTestId("board-rename")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(container.querySelector("[data-composer-trigger]")).toBeNull();
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
    expect(
      within(dialogNotice).queryByTestId("archived-board-restore"),
    ).toBeNull();
  });
});
