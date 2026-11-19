import { act, render, screen, waitFor, within } from "@testing-library/react";
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

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function renderBell(server: FakeServer, handler: FetchHandler = server.handle) {
  vi.stubGlobal("fetch", handler);
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

  it("opens older attention notifications and clears the unread badge through the API", async () => {
    const server = new FakeServer();
    const older = {
      id: "older",
      type: "claim.expired",
      title: "Claim expired",
      body: "Review the card",
      boardId: "b-1",
      data: null,
      createdAt: 1_700_000_000_000,
      readAt: null as number | null,
    };
    const newest = { ...older, id: "newest", title: "Approval needed" };
    const operations: string[] = [];
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/users/me/notifications") {
        const after = url.searchParams.get("cursor");
        return Response.json({
          items: after === "1700000000000:newest" ? [older] : [newest],
          nextCursor: after ? null : "1700000000000:newest",
          unreadCount: [older, newest].filter((item) => item.readAt === null)
            .length,
        });
      }
      if (url.pathname.endsWith("/older/read")) {
        operations.push(url.pathname);
        older.readAt = 1_700_000_000_001;
        return Response.json(older);
      }
      if (url.pathname.endsWith("/notifications/read-all")) {
        operations.push(url.pathname);
        newest.readAt = 1_700_000_000_002;
        return Response.json({ updated: 1 });
      }
      return server.handle(input, init);
    };
    renderBell(server, handler);
    expect(await screen.findByTestId("notifications-badge")).toHaveTextContent(
      "2",
    );
    await userEvent.click(screen.getByTestId("notifications-bell"));
    expect(await screen.findByText("Approval needed")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Claim expired")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() =>
      expect(screen.getByTestId("notifications-badge")).toHaveTextContent("1"),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("notifications-badge")).toBeNull(),
    );
    expect(await screen.findByText("Approval needed")).toBeVisible();
    expect(operations).toEqual([
      "/api/v1/users/me/notifications/older/read",
      "/api/v1/users/me/notifications/read-all",
    ]);
  });

  it("shows a busy skeleton until the invitation list arrives", async () => {
    const server = new FakeServer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/invitations") await gate;
      return server.handle(input, init);
    };

    renderBell(server, handler);
    await userEvent.click(await screen.findByTestId("notifications-bell"));

    const skeleton = await screen.findByTestId("notifications-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("invitations-panel")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    act(() => release());

    expect(await screen.findByText("No invitations")).toBeInTheDocument();
    expect(screen.queryByTestId("notifications-skeleton")).toBeNull();
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
    // The answered invitation must leave the badge and the list at once.
    await waitFor(() =>
      expect(screen.queryByTestId("notifications-badge")).toBeNull(),
    );
    await userEvent.click(screen.getByTestId("notifications-bell"));
    expect(await screen.findByText("No invitations")).toBeInTheDocument();
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
