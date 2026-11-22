import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider } from "@/i18n";
import { adminApi } from "./admin-client";
import { AdminCommentHistoryButton } from "./CommentHistoryDialog";
import {
  adminCard,
  adminComment,
  adminCommentHistory,
  adminCommentRevision,
  FakeAdminServer,
  emptyAdminState,
  type FakeAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-185.5 (§3.4) — the admin history trigger only exists for a live
 * comment or parent, opens at zero revisions when the saved history is
 * incomplete, and the dialog paginates the TASK-185.3 admin revisions route.
 */

function renderButton(server: FakeAdminServer, comment = adminComment()) {
  vi.stubGlobal("fetch", server.fetchImpl);
  return render(
    <I18nProvider>
      <AdminCommentHistoryButton comment={comment} />
    </I18nProvider>,
  );
}

function incompleteState(): FakeAdminState {
  const state = emptyAdminState();
  state.comments = [
    adminComment({
      id: "comment-incomplete",
      revisionCount: 0,
      historyIncomplete: true,
    }),
  ];
  state.commentHistories["comment-incomplete"] = adminCommentHistory({
    reason: "legacy_cutover",
    items: [],
  });
  return state;
}

function manyRevisionsState(): FakeAdminState {
  const state = emptyAdminState();
  state.comments = [
    adminComment({
      id: "comment-many",
      revisionCount: 22,
      editedAt: Date.UTC(2026, 0, 2),
    }),
  ];
  state.commentHistories["comment-many"] = adminCommentHistory({
    items: Array.from({ length: 22 }, (_, index) =>
      adminCommentRevision({
        id: `revision-${index + 1}`,
        revisionNumber: index + 1,
        editorId: index === 21 ? null : "u-1",
        editorName: index === 21 ? null : "Member",
        cause: index === 21 ? "attachment_deleted" : "author_edit",
        beforeText: "alpha old beta",
        afterText: "alpha new beta",
        createdAt: Date.UTC(2026, 0, 1) + index * 1000,
      }),
    ),
  });
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

describe("admin comment history dialog", () => {
  it("opens at zero revisions for an incomplete live history and returns focus", async () => {
    const server = new FakeAdminServer(incompleteState());
    const user = userEvent.setup();
    renderButton(server, incompleteState().comments[0]);

    const trigger = screen.getByTestId(
      "admin-comment-history-comment-incomplete",
    );
    expect(trigger).toHaveTextContent("History");
    expect(
      screen.getByTestId("admin-comment-revision-count-comment-incomplete"),
    ).toHaveTextContent("0");

    await user.click(trigger);

    expect(
      await screen.findByTestId("admin-comment-history-dialog"),
    ).toBeTruthy();
    const banner = await screen.findByTestId("admin-comment-history-banner");
    expect(banner).toHaveAttribute("data-reason", "legacy_cutover");
    expect(banner).toHaveTextContent("0.3.0");
    expect(screen.getByTestId("admin-comment-history-empty")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("admin-comment-history-dialog")).toBeNull();
    });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("paginates revisions, localizes metadata and shows escaped diff and snapshots", async () => {
    const server = new FakeAdminServer(manyRevisionsState());
    const user = userEvent.setup();
    renderButton(server, manyRevisionsState().comments[0]);

    await user.click(screen.getByTestId("admin-comment-history-comment-many"));
    const list = await screen.findByTestId("admin-comment-history-list");
    expect(
      within(list).getAllByTestId("admin-comment-history-revision"),
    ).toHaveLength(20);
    expect(within(list).getAllByText("Revision 22")[0]).toBeTruthy();
    expect(screen.getByTestId("admin-comment-history-show-older")).toBeTruthy();

    const newest = within(list).getAllByTestId(
      "admin-comment-history-revision",
    )[0];
    expect(
      within(newest).getByTestId("admin-comment-history-editor"),
    ).toHaveTextContent("Editor unavailable");
    expect(
      within(newest).getByTestId("admin-comment-history-cause"),
    ).toHaveTextContent("Attachment deleted");
    expect(
      newest.querySelectorAll('[data-diff="removed"]').length,
    ).toBeGreaterThan(0);
    expect(
      newest.querySelectorAll('[data-diff="added"]').length,
    ).toBeGreaterThan(0);

    await user.click(
      within(newest).getByTestId("admin-comment-history-snapshot-toggle-22"),
    );
    expect(
      within(newest).getByTestId("admin-comment-history-snapshot-before-22"),
    ).toHaveTextContent("alpha old beta");
    expect(
      within(newest).getByTestId("admin-comment-history-snapshot-after-22"),
    ).toHaveTextContent("alpha new beta");

    await user.click(screen.getByTestId("admin-comment-history-show-older"));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("admin-comment-history-list")).getAllByTestId(
          "admin-comment-history-revision",
        ),
      ).toHaveLength(22);
    });
    expect(screen.getByTestId("admin-comment-history-end")).toBeTruthy();
    expect(
      server.requests.some(
        (request) =>
          request.path === "/admin/comments/comment-many/revisions" &&
          request.query.get("cursor") === "3",
      ),
    ).toBe(true);
  });

  it("recovers from a failed first page with an explicit retry", async () => {
    const state = emptyAdminState();
    state.comments = [adminComment({ id: "comment-retry", revisionCount: 1 })];
    state.commentHistories["comment-retry"] = adminCommentHistory({
      items: [adminCommentRevision()],
    });
    const server = new FakeAdminServer(state);
    server.failNext = ["/admin/comments/comment-retry/revisions"];
    const user = userEvent.setup();
    renderButton(server, state.comments[0]);

    await user.click(screen.getByTestId("admin-comment-history-comment-retry"));
    expect(
      await screen.findByTestId("admin-comment-history-error"),
    ).toBeTruthy();
    await user.click(screen.getByTestId("admin-comment-history-retry"));
    expect(
      await screen.findByTestId("admin-comment-history-list"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-comment-history-end")).toBeTruthy();
  });

  it("keeps deleted rows and deleted parents null with no history link", async () => {
    const state = emptyAdminState();
    state.boards = [
      {
        id: "b-1",
        title: "Roadmap",
        userId: "u-1",
        ownerEmail: "member@example.com",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        deletedAt: null,
      },
    ];
    state.cards = [
      adminCard({ id: "card-1" }),
      adminCard({ id: "card-deleted", deletedAt: 1 }),
    ];
    state.comments = [
      adminComment({
        id: "live",
        cardId: "card-1",
        revisionCount: 2,
      }),
      adminComment({
        id: "deleted",
        cardId: "card-1",
        deletedAt: 1,
        revisionCount: 2,
      }),
      adminComment({
        id: "parent-deleted",
        cardId: "card-deleted",
        revisionCount: 2,
      }),
    ];
    state.commentHistories.live = adminCommentHistory({
      items: [
        adminCommentRevision({ id: "r-1", revisionNumber: 1 }),
        adminCommentRevision({ id: "r-2", revisionNumber: 2 }),
      ],
    });
    state.commentHistories.deleted = state.commentHistories.live;
    state.commentHistories["parent-deleted"] = state.commentHistories.live;
    const server = new FakeAdminServer(state);

    const response = await server.fetchImpl(
      "http://api.test/api/v1/admin/comments?status=all",
    );
    const page = (await response.json()) as {
      items: Array<{
        id: string;
        text: string;
        revisionCount: number | null;
        historyIncomplete: boolean | null;
      }>;
      total: number;
    };
    expect(page.total).toBe(3);
    for (const item of page.items) {
      expect(typeof item.text).toBe("string");
    }
    expect(page.items.find((item) => item.id === "live")).toMatchObject({
      revisionCount: 2,
      historyIncomplete: false,
    });
    expect(page.items.find((item) => item.id === "deleted")).toMatchObject({
      revisionCount: null,
      historyIncomplete: null,
    });
    expect(
      page.items.find((item) => item.id === "parent-deleted"),
    ).toMatchObject({ revisionCount: null, historyIncomplete: null });

    for (const commentId of ["deleted", "parent-deleted"]) {
      const gone = await server.fetchImpl(
        `http://api.test/api/v1/admin/comments/${commentId}/revisions`,
      );
      expect(gone.status).toBe(404);
    }

    const entityResponse = await server.fetchImpl(
      "http://api.test/api/v1/admin/entities/comments?status=all",
    );
    const entityPage = (await entityResponse.json()) as typeof page;
    expect(entityPage.items.map((item) => item.revisionCount)).toEqual(
      expect.arrayContaining([2, null, null]),
    );
    expect(entityPage.total).toBe(3);
  });
});
