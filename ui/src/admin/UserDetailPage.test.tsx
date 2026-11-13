import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import { adminMessage } from "./admin-i18n";
import AdminApp from "./AdminApp";
import {
  adminCard,
  adminComment,
  adminMembership,
  adminSession,
  adminToken,
  adminUser,
  FakeAdminServer,
  emptyAdminState,
  type FakeAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.3 — the user-detail tabs are honest windows: exact counters,
 * `N of M`, `Load more`, live rows by default and deleted/revoked rows behind
 * an explicit filter.
 */

function renderUser(userId = "u-1", query = "") {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[`/admin/users/${userId}${query}`]}>
              <Routes>
                <Route path="/admin/*" element={<AdminApp />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

function stateWithWindows(): FakeAdminState {
  const state = emptyAdminState();
  state.users = [adminUser()];
  state.cards = Array.from({ length: 120 }, (_, index) =>
    adminCard({ id: `card-${index}`, title: `Card ${index}` }),
  );
  const now = Date.UTC(2026, 0, 1);
  state.comments = [
    ...Array.from({ length: 25 }, (_, index) =>
      adminComment({
        id: `comment-live-${index}`,
        text: `Live comment ${index}`,
        createdAt: now + index,
      }),
    ),
    ...Array.from({ length: 27 }, (_, index) =>
      adminComment({
        id: `comment-deleted-${index}`,
        text: `Deleted comment ${index}`,
        createdAt: now + 100 + index,
        deletedAt: now + 500,
      }),
    ),
  ];
  state.sessions = [
    ...Array.from({ length: 25 }, (_, index) =>
      adminSession({ id: `session-live-${index}`, createdAt: now + index }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      adminSession({
        id: `session-revoked-${index}`,
        createdAt: now + 200 + index,
        revokedAt: now + 300,
      }),
    ),
  ];
  state.tokens = [
    ...Array.from({ length: 25 }, (_, index) =>
      adminToken({ id: `token-live-${index}`, createdAt: now + index }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      adminToken({
        id: `token-revoked-${index}`,
        createdAt: now + 200 + index,
        revokedAt: now + 300,
      }),
    ),
  ];
  return state;
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("UserDetailPage windows", () => {
  it("shows exact totals and pages 120 created cards as 25 of 120", async () => {
    const server = new FakeAdminServer(stateWithWindows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    const counter = await screen.findByTestId(
      "admin-user-counter-cardsCreated",
    );
    expect(counter).toHaveTextContent("120");
    expect(screen.getByTestId("admin-user-tab-cards")).toHaveTextContent("120");

    fireEvent.click(screen.getByTestId("admin-user-tab-cards"));
    expect(
      await screen.findByTestId("admin-user-cards-count"),
    ).toHaveTextContent("25 of 120");
    fireEvent.click(screen.getByTestId("admin-user-cards-more"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-user-cards-count")).toHaveTextContent(
        "50 of 120",
      );
    });
  });

  it("keeps deleted comments out of the live window and reveals them on demand", async () => {
    const server = new FakeAdminServer(stateWithWindows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-comments"));
    expect(
      await screen.findByTestId("admin-user-comments-count"),
    ).toHaveTextContent("25 of 25");
    expect(screen.getByText("Live comment 0")).toBeTruthy();
    expect(screen.queryByText("Deleted comment 0")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (27)" }));
    expect(
      await screen.findByTestId("admin-user-comments-count"),
    ).toHaveTextContent("25 of 52");

    fireEvent.click(screen.getByTestId("admin-user-comments-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-user-comments-count")).toHaveTextContent(
        "50 of 52",
      );
    });
    expect(await screen.findByText("Deleted comment 0")).toBeTruthy();
  });

  it("separates active sessions from revoked ones", async () => {
    const server = new FakeAdminServer(stateWithWindows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-sessions"));
    expect(
      await screen.findByTestId("admin-user-sessions-count"),
    ).toHaveTextContent("25 of 25");
    expect(screen.queryByText("Revoked")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show inactive (5)" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-user-sessions-count")).toHaveTextContent(
        "25 of 30",
      );
    });
    fireEvent.click(screen.getByTestId("admin-user-sessions-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-user-sessions-count")).toHaveTextContent(
        "30 of 30",
      );
    });
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
  });

  it("shows the tab badge as the live total, not the page length", async () => {
    const server = new FakeAdminServer(stateWithWindows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    const commentsTab = await screen.findByTestId("admin-user-tab-comments");
    expect(within(commentsTab).getByText("25")).toBeTruthy();
    expect(within(commentsTab).queryByText("52")).toBeNull();
  });
});

describe("UserDetailPage identity links and per-row moderation", () => {
  function stateWithRows(): FakeAdminState {
    const state = emptyAdminState();
    state.users = [adminUser()];
    state.comments = [adminComment()];
    state.sessions = [adminSession({ expiresAt: Date.now() + 86_400_000 })];
    state.tokens = [adminToken()];
    state.memberships = [
      adminMembership({
        invitedById: "u-2",
        invitedByEmail: "inviter@example.com",
      }),
    ];
    return state;
  }

  async function openAction(testId: string, label: string) {
    fireEvent.pointerDown(await screen.findByTestId(testId), { button: 0 });
    fireEvent.click(await screen.findByText(label));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));
  }

  it("links the inviter and degrades a missing inviter to a copyable id", async () => {
    const state = stateWithRows();
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    const view = renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-memberships"));
    const inviterLink = await screen.findByTestId(
      "admin-user-invited-by-membership-1",
    );
    const inviterHref = new URL(
      inviterLink.getAttribute("href") ?? "",
      "http://admin.test",
    );
    expect(inviterHref.pathname).toBe("/admin/users/u-2");
    // The inviter's profile returns to the memberships tab it was opened from.
    expect(inviterHref.searchParams.get("returnTo")).toBe(
      "/admin/users/u-1?tab=memberships",
    );

    view.unmount();

    state.memberships = [
      adminMembership({ invitedById: "u-ghost", invitedByEmail: null }),
    ];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderUser();
    fireEvent.click(await screen.findByTestId("admin-user-tab-memberships"));
    const cell = await screen.findByRole("tabpanel");
    expect(
      within(cell).queryByTestId("admin-user-invited-by-membership-1"),
    ).toBeNull();
    expect(await screen.findByTestId("admin-id-u-ghost")).toBeTruthy();
  });

  it("deletes one comment and keeps it visible as deleted", async () => {
    const server = new FakeAdminServer(stateWithRows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-comments"));
    await openAction("admin-user-comment-actions-comment-1", "Delete");

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.path === "/admin/comments/comment-1",
        ),
      ).toBe(true);
    });
    expect(
      await screen.findByTestId("admin-user-comments-count"),
    ).toHaveTextContent("1 of 1");
    expect(
      within(screen.getByRole("tabpanel")).getByText("Deleted"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-user-comment-actions-comment-1"),
    ).toBeNull();
  });

  it("keeps earlier loaded pages after deleting a row on a later page", async () => {
    const state = stateWithRows();
    const stamp = Date.UTC(2026, 0, 1);
    state.comments = Array.from({ length: 60 }, (_, index) =>
      adminComment({
        id: `comment-live-${index}`,
        text: `Live comment ${index}`,
        createdAt: stamp + index,
      }),
    );
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-comments"));
    expect(
      await screen.findByTestId("admin-user-comments-count"),
    ).toHaveTextContent("25 of 60");
    fireEvent.click(screen.getByTestId("admin-user-comments-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-user-comments-count")).toHaveTextContent(
        "50 of 60",
      );
    });

    await openAction("admin-user-comment-actions-comment-live-10", "Delete");

    await waitFor(() => {
      expect(screen.getByTestId("admin-user-comments-count")).toHaveTextContent(
        "50 of 60",
      );
    });
    expect(screen.getByText("Live comment 59")).toBeTruthy();
    const deletedRow = screen
      .getByText("Live comment 10")
      .closest("tr") as HTMLElement;
    expect(within(deletedRow).getByText("Deleted")).toBeTruthy();
  });

  it("revokes one session and keeps it visible as revoked", async () => {
    const server = new FakeAdminServer(stateWithRows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-sessions"));
    await openAction("admin-user-session-actions-session-1", "Revoke session");

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/admin/sessions/session-1/revoke",
        ),
      ).toBe(true);
    });
    expect(
      within(screen.getByRole("tabpanel")).getByText("Revoked"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-user-session-actions-session-1"),
    ).toBeNull();
  });

  it("revokes one token and keeps it visible as revoked", async () => {
    const server = new FakeAdminServer(stateWithRows());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-tokens"));
    await openAction("admin-user-token-actions-token-1", "Revoke");

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/admin/tokens/token-1/revoke",
        ),
      ).toBe(true);
    });
    expect(
      within(screen.getByRole("tabpanel")).getByText("Revoked"),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-user-token-actions-token-1")).toBeNull();
  });

  it("surfaces a 403 and leaves the row actionable", async () => {
    const server = new FakeAdminServer(stateWithRows());
    server.failNextStatuses.push({
      path: "/admin/comments/comment-1",
      status: 403,
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-comments"));
    await openAction("admin-user-comment-actions-comment-1", "Delete");

    expect(
      await screen.findByText(adminMessage("admin.common.forbidden", "en")),
    ).toBeTruthy();
    expect(
      screen.getByTestId("admin-user-comment-actions-comment-1"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("tabpanel")).queryByText("Deleted"),
    ).toBeNull();
  });

  it("does not offer actions for already deleted or revoked rows", async () => {
    const state = stateWithRows();
    const stamp = Date.UTC(2026, 0, 1);
    state.comments = [adminComment({ deletedAt: stamp })];
    state.sessions = [adminSession({ revokedAt: stamp })];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderUser();

    fireEvent.click(await screen.findByTestId("admin-user-tab-comments"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Show deleted (1)" }),
    );
    expect(
      await within(screen.getByRole("tabpanel")).findByText("Deleted"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-user-comment-actions-comment-1"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("admin-user-tab-sessions"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Show inactive (1)" }),
    );
    expect(
      await within(screen.getByRole("tabpanel")).findByText("Revoked"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-user-session-actions-session-1"),
    ).toBeNull();
  });

  it("uses returnTo as the back target (TASK-176.5)", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(stateWithRows()).fetchImpl);
    const backTo = "/admin/users?search=member&status=disabled";
    renderUser("u-1", `?returnTo=${encodeURIComponent(backTo)}`);

    const back = await screen.findByRole("link", {
      name: adminMessage("admin.common.back", "en"),
    });
    expect(back).toHaveAttribute("href", backTo);
  });
});
