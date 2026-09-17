import { render, screen } from "@testing-library/react";
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

function renderApp() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
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
});
