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
import AdminApp from "./AdminApp";
import {
  adminCard,
  adminComment,
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

function renderUser(userId = "u-1") {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
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

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (52)" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Show inactive (30)" }));
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
