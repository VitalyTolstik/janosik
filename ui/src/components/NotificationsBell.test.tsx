import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * Notifications bell (TASK-35 addendum): invitations are opt-in, so the
 * invitee answers them here. The bell must show a count while something is
 * pending, list who invited to which board, accept (which refreshes the
 * board list) and decline.
 */

const INVITATION = {
  id: "inv-1",
  boardId: "b-1",
  boardTitle: "Invited board",
  role: "MEMBER" as const,
  expiresAt: null,
  createdAt: 1_700_000_000_000,
  invitedByName: "Owner",
  invitedByEmail: "owner@example.com",
};

function renderBell(server: FakeServer) {
  vi.stubGlobal("fetch", server.handle);
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/"]}>
                <ToastProvider>
                  <AuthProvider>
                    <BoardProvider>
                      <NotificationsBell />
                    </BoardProvider>
                  </AuthProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("NotificationsBell (TASK-35 addendum)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stays quiet with no invitations", async () => {
    const server = new FakeServer();

    renderBell(server);

    const bell = await screen.findByTestId("notifications-bell");
    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "GET",
        path: "/api/v1/invitations",
        body: undefined,
      }),
    );
    expect(screen.queryByTestId("notifications-badge")).toBeNull();

    await userEvent.click(bell);
    expect(await screen.findByText("No invitations")).toBeInTheDocument();
  });

  it("badges the bell and lists the invitation details", async () => {
    const server = new FakeServer();
    server.invitations.push({ ...INVITATION });

    renderBell(server);

    await userEvent.click(await screen.findByTestId("notifications-bell"));
    const row = await screen.findByTestId("invitation-row");
    expect(screen.getByTestId("notifications-badge")).toHaveTextContent("1");
    expect(within(row).getByText("Invited board")).toBeInTheDocument();
    expect(within(row).getByText(/Owner/)).toBeInTheDocument();
    expect(within(row).getByText(/Member/)).toBeInTheDocument();
  });

  it("accepts an invitation and refreshes the board list", async () => {
    const server = new FakeServer();
    server.invitations.push({ ...INVITATION });

    renderBell(server);
    await userEvent.click(await screen.findByTestId("notifications-bell"));
    await userEvent.click(await screen.findByTestId("invitation-accept"));

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "POST",
        path: "/api/v1/invitations/inv-1/accept",
        body: undefined,
      }),
    );
    expect(
      await screen.findByText("You joined «Invited board»"),
    ).toBeInTheDocument();
    // The newly joined board must be hydrated without a reload.
    await waitFor(() =>
      expect(
        server.requests.filter((r) => r.path === "/api/v1/boards").length,
      ).toBeGreaterThan(1),
    );
  });

  it("declines an invitation", async () => {
    const server = new FakeServer();
    server.invitations.push({ ...INVITATION });

    renderBell(server);
    await userEvent.click(await screen.findByTestId("notifications-bell"));
    await userEvent.click(await screen.findByTestId("invitation-decline"));

    await waitFor(() =>
      expect(server.requests).toContainEqual({
        method: "POST",
        path: "/api/v1/invitations/inv-1/decline",
        body: undefined,
      }),
    );
    expect(
      await screen.findByText("Invitation to «Invited board» declined"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("invitation-row")).toBeNull(),
    );
  });
});
