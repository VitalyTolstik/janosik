import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { cardHref } from "@/utils/card-nav";

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
    expect(bell).toHaveAccessibleName("Notifications");

    await userEvent.click(bell);
    expect(await screen.findByText("No invitations")).toBeInTheDocument();
  });

  it("announces an invitations fetch error and retries from the open bell", async () => {
    const server = new FakeServer();
    let unavailable = true;
    renderBell(server, async (input, init) => {
      if (
        unavailable &&
        new URL(String(input)).pathname === "/api/v1/invitations"
      ) {
        return Response.json({}, { status: 503 });
      }
      return server.handle(input, init);
    });

    await userEvent.click(await screen.findByTestId("notifications-bell"));
    expect(
      await screen.findByText("Could not load board invitations."),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByTestId("notifications-skeleton"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("invitations-panel")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    unavailable = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Retry loading invitations" }),
    );
    expect(await screen.findByText("No invitations")).toBeVisible();
    expect(
      screen.queryByText("Could not load board invitations."),
    ).not.toBeInTheDocument();
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
    const bell = screen.getByRole("button", {
      name: "Notifications (2 unread)",
    });
    await userEvent.click(bell);
    expect(await screen.findByText("Approval needed")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Claim expired")).toBeVisible();
    await userEvent.click(bell);
    await userEvent.click(bell);
    expect(await screen.findByText("Approval needed")).toBeVisible();
    expect(screen.queryByText("Claim expired")).not.toBeInTheDocument();
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

  it("ignores an older list response that resolves after a row was read", async () => {
    const server = new FakeServer();
    let unread = true;
    let attentionCalls = 0;
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let staleStarted!: () => void;
    const staleStartedGate = new Promise<void>((resolve) => {
      staleStarted = resolve;
    });
    const item = () => ({
      id: "blocked",
      type: "agent.blocked",
      title: "Approval needed",
      body: null,
      boardId: "b-1",
      data: null,
      createdAt: 1_700_000_000_000,
      readAt: unread ? null : 1_700_000_000_001,
    });
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/users/me/notifications") {
        attentionCalls += 1;
        const snapshotUnread = unread;
        if (attentionCalls === 3) {
          // A background poll that left before the read and lands after it.
          staleStarted();
          await staleGate;
          return Response.json({
            items: [{ ...item(), readAt: null }],
            nextCursor: null,
            unreadCount: 1,
          });
        }
        return Response.json({
          items: [item()],
          nextCursor: null,
          unreadCount: snapshotUnread ? 1 : 0,
        });
      }
      if (url.pathname.endsWith("/notifications/blocked/read")) {
        unread = false;
        return Response.json({ ...item(), readAt: 1_700_000_000_001 });
      }
      return server.handle(input, init);
    };
    renderBell(server, handler);

    await waitFor(() =>
      expect(screen.getByTestId("notifications-badge")).toHaveTextContent("1"),
    );
    const bell = screen.getByRole("button", {
      name: "Notifications (1 unread)",
    });
    await userEvent.click(bell);
    expect(await screen.findByText("Approval needed")).toBeVisible();

    // Opening held response #2 already; this focus poll is the stale one.
    fireEvent.focus(window);
    await staleStartedGate;
    await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() =>
      expect(screen.queryByTestId("notifications-badge")).toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: "Mark as read" }),
    ).not.toBeInTheDocument();

    releaseStale();
    await act(async () => {
      await staleGate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByTestId("notifications-badge")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Mark as read" }),
    ).not.toBeInTheDocument();
  });

  it("shows an older-page error for an invalid cursor and leaves the newest page visible", async () => {
    const server = new FakeServer();
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname !== "/api/v1/users/me/notifications")
        return server.handle(input, init);
      if (url.searchParams.get("cursor") === "expired-cursor")
        return Response.json({ message: "Invalid cursor" }, { status: 400 });
      return Response.json({
        items: [],
        nextCursor: "expired-cursor",
        unreadCount: 0,
      });
    };
    renderBell(server, handler);
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Older" }));
    expect(
      await screen.findByText("Could not load older notifications."),
    ).toBeVisible();
    expect(screen.getByText("No attention notifications.")).toBeVisible();
    expect(
      screen.queryByText("Could not load attention notifications."),
    ).not.toBeInTheDocument();
  });

  it("reports a failed inbox refresh after a successful read and retries loading", async () => {
    const server = new FakeServer();
    let marked = false;
    let failRefresh = true;
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/users/me/notifications/read-all") {
        marked = true;
        return Response.json({ updated: 1 });
      }
      if (url.pathname === "/api/v1/users/me/notifications") {
        if (marked && failRefresh)
          return Response.json({ message: "Unavailable" }, { status: 503 });
        return Response.json({
          items: [],
          nextCursor: null,
          unreadCount: marked ? 0 : 1,
        });
      }
      return server.handle(input, init);
    };
    renderBell(server, handler);
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications (1 unread)" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Mark all as read" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load attention notifications.",
    );
    failRefresh = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Retry loading notifications" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  });

  it("keeps attention notifications and invitations distinct under one badge", async () => {
    const server = new FakeServer();
    server.invitations.push({ ...INVITATION });
    let unread = 1;
    const handler: FetchHandler = async (input, init) => {
      const url = new URL(String(input), "http://api.test");
      if (url.pathname === "/api/v1/users/me/notifications") {
        return Response.json({
          items: [
            {
              id: "blocked",
              type: "agent.blocked",
              boardId: "b-1",
              title: "Agent blocked",
              body: "Review the card",
              data: { cardId: "c-1" },
              readAt: unread === 0 ? 1_700_000_000_001 : null,
              createdAt: 1_700_000_000_000,
            },
          ],
          nextCursor: null,
          unreadCount: unread,
        });
      }
      if (url.pathname === "/api/v1/users/me/notifications/read-all") {
        unread = 0;
        return Response.json({ updated: 1 });
      }
      return server.handle(input, init);
    };
    renderBell(server, handler);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Notifications (2 unread)",
      }),
    );

    expect(await screen.findByText("Agent blocked")).toBeVisible();
    expect(screen.getByTestId("invitations-panel")).toHaveAccessibleName(
      "Notifications",
    );
    expect(screen.getByTestId("invitation-row")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Attention inbox" }),
    ).toBeVisible();
    expect(screen.getByText("Invitations (1)")).toBeVisible();
    // The attention row is a real anchor, not a JS-only row.
    expect(
      screen.getByRole("link", { name: "Open “Agent blocked”" }),
    ).toHaveAttribute("href", cardHref("b-1", "c-1"));

    await userEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("notifications-badge")).toHaveTextContent("1"),
    );
    // Read-all clears attention only: the pending invitation keeps its badge.
    expect(screen.getByTestId("invitation-row")).toBeVisible();
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

  it("keeps a long invitation board title readable", async () => {
    const server = new FakeServer();
    const title =
      "A very long board title that should wrap instead of clipping";
    server.invitations.push({ ...INVITATION, boardTitle: title });

    renderBell(server);
    await userEvent.click(await screen.findByTestId("notifications-bell"));

    const heading = await screen.findByText(title);
    expect(heading).toHaveAttribute("title", title);
    expect(heading).toHaveClass("line-clamp-2");
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
