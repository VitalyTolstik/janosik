import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { Header } from "@/components/Header";
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

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderHeader(path: string, server: FakeServer) {
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
                      <Header />
                      <RouteProbe />
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

describe("agent entry points in the header", () => {
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

  it("keeps one board entry and returns focus to its trigger", async () => {
    renderHeader("/board/board-1", new FakeServer([board]));
    const trigger = await screen.findByTestId("agent-control-trigger");
    expect(screen.queryByTestId("agents-trigger")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    const dialog = await screen.findByTestId("agent-control-dialog");
    expect(
      within(dialog).getByTestId("agent-control-all-agents"),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens the global console from board control", async () => {
    renderHeader("/board/board-1", new FakeServer([board]));
    await userEvent.click(await screen.findByTestId("agent-control-trigger"));
    await userEvent.click(
      await screen.findByTestId("agent-control-all-agents"),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/agents");
    expect(screen.getByTestId("agents-trigger")).toHaveAttribute(
      "href",
      "/agents",
    );
    await waitFor(() =>
      expect(screen.getByTestId("agents-trigger")).toHaveFocus(),
    );
    expect(
      screen.queryByTestId("agent-control-trigger"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Switch board" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("board-settings-trigger"),
    ).not.toBeInTheDocument();
  });

  it.each(["/agents", "/agents/", "/agents/token-1"])(
    "uses global navigation on %s without board actions",
    async (path) => {
      renderHeader(path, new FakeServer([board]));
      expect(await screen.findByTestId("agents-trigger")).toHaveAttribute(
        "href",
        "/agents",
      );
      expect(screen.getByTestId("agents-header-scope")).toBeInTheDocument();
      expect(await screen.findByTestId("agents-home")).toHaveAttribute(
        "href",
        "/",
      );
      expect(
        screen.queryByTestId("agents-return-board"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Boards" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-control-trigger"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Members" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch board" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /undo/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /redo/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("offers agents from the account panel", async () => {
    renderHeader("/board/board-1", new FakeServer([board]));
    await userEvent.click(await screen.findByTestId("account-trigger"));
    await userEvent.click(await screen.findByTestId("account-open-agents"));
    expect(screen.getByTestId("location")).toHaveTextContent("/agents");
  });

  it("does not show undo or redo to a board viewer", async () => {
    const server = new FakeServer([board]);
    server.role = "VIEWER";
    renderHeader("/board/board-1", server);
    await screen.findByTestId("agent-runs-trigger");
    expect(
      screen.queryByRole("button", { name: /undo/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /redo/i }),
    ).not.toBeInTheDocument();
  });
});
