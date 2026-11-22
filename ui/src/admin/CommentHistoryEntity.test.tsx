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
    state.boards = [
      adminBoard(),
      adminBoard({ id: "b-column-deleted", title: "Deleted column board" }),
      adminBoard({
        id: "b-board-deleted",
        title: "Deleted board",
        deletedAt: Date.UTC(2026, 0, 2),
      }),
    ];
    state.cards = [
      adminCard({ id: "card-1" }),
      adminCard({
        id: "card-column-deleted",
        boardId: "b-column-deleted",
        columnId: "column-deleted",
      }),
      adminCard({
        id: "card-board-deleted",
        boardId: "b-board-deleted",
        columnId: "column-board-deleted",
      }),
    ];
    state.comments = [
      adminComment({ id: "live", text: "Live note", revisionCount: 1 }),
      adminComment({
        id: "deleted",
        text: "Deleted note",
        deletedAt: Date.UTC(2026, 0, 2),
        revisionCount: null,
        historyIncomplete: null,
      }),
      adminComment({
        id: "column-deleted",
        text: "Deleted column note",
        cardId: "card-column-deleted",
        revisionCount: null,
        historyIncomplete: null,
      }),
      adminComment({
        id: "board-deleted",
        text: "Deleted board note",
        cardId: "card-board-deleted",
        revisionCount: null,
        historyIncomplete: null,
      }),
    ];
    state.commentHistories.live = adminCommentHistory({
      items: [adminCommentRevision()],
    });
    const server = new FakeAdminServer(state);
    server.boardColumns["b-column-deleted"] = [
      {
        id: "column-deleted",
        boardId: "b-column-deleted",
        boardTitle: "Deleted column board",
        title: "Gone",
        wipLimit: null,
        position: 0,
        cardCount: 1,
        deletedAt: Date.UTC(2026, 0, 2),
        version: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
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

    const trigger = await screen.findByTestId("admin-comment-history-live");
    expect(trigger).toHaveTextContent("History");
    expect(trigger).toHaveClass("max-lg:min-h-11");
    expect(trigger.parentElement?.className).toContain("min-w-0");
    for (const id of ["deleted", "column-deleted", "board-deleted"]) {
      expect(screen.queryByTestId(`admin-comment-history-${id}`)).toBeNull();
    }

    await user.click(trigger);
    expect(
      await screen.findByTestId("admin-comment-history-dialog"),
    ).toBeTruthy();
    expect(
      await screen.findAllByTestId("admin-comment-history-revision"),
    ).toHaveLength(1);
  });
});
