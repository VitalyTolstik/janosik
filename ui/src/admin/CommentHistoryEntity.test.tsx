import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import {
  FakeAdminServer,
  adminBoard,
  adminCard,
  adminComment,
  adminCommentHistory,
  adminCommentRevision,
  adminUser,
  emptyAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-185.5 — the cross-board comments table exposes the same history
 * trigger as the detail pages and keeps deleted rows link-free.
 */

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin comments table history", () => {
  it("opens a live row's history and hides deleted rows' links", async () => {
    const state = emptyAdminState();
    state.users = [adminUser()];
    state.boards = [adminBoard()];
    state.cards = [adminCard({ id: "card-1" })];
    state.comments = [
      adminComment({ id: "live", text: "Live note", revisionCount: 1 }),
      adminComment({
        id: "deleted",
        text: "Deleted note",
        deletedAt: Date.UTC(2026, 0, 2),
        revisionCount: null,
        historyIncomplete: null,
      }),
    ];
    state.commentHistories.live = adminCommentHistory({
      items: [adminCommentRevision()],
    });
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/admin/moderation?tab=comments"]}>
                <Routes>
                  <Route path="/admin/*" element={<AdminApp />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    expect(
      await screen.findByTestId("admin-comment-history-live"),
    ).toHaveTextContent("History");
    expect(screen.queryByTestId("admin-comment-history-deleted")).toBeNull();

    await user.click(screen.getByTestId("admin-comment-history-live"));
    expect(
      await screen.findByTestId("admin-comment-history-dialog"),
    ).toBeTruthy();
    expect(
      await screen.findAllByTestId("admin-comment-history-revision"),
    ).toHaveLength(1);
  });
});
