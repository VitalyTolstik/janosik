import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

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

async function axeViolations(context: Element | Document) {
  const results = await axe.run(context, {
    rules: {
      // jsdom has no layout or paint; colour pairs are checked elsewhere.
      "color-contrast": { enabled: false },
    },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .map((node) => node.target.join(" "))
        .join(", ")}`,
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
    expect(trigger).toHaveClass("max-lg:min-h-11");
    expect(trigger).toHaveAccessibleName(/History/);
    expect(trigger).toHaveAccessibleName(/0 revisions/);
    expect(trigger).toHaveAccessibleName(/history incomplete/);
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
    expect(screen.getByTestId("admin-comment-history-show-older")).toHaveClass(
      "max-lg:min-h-11",
    );

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

    const snapshotToggle = within(newest).getByTestId(
      "admin-comment-history-snapshot-toggle-22",
    );
    expect(snapshotToggle).toHaveClass("max-lg:min-h-11");
    await user.click(snapshotToggle);
    const snapshot = within(newest).getByTestId(
      "admin-comment-history-snapshot-22",
    );
    expect(snapshot).toHaveAttribute("role", "region");
    expect(snapshot).toHaveAttribute(
      "aria-label",
      "Full snapshot of revision 22",
    );
    expect(snapshot).toHaveAttribute("tabindex", "0");
    snapshot.focus();
    expect(snapshot).toHaveFocus();
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
    const olderRequest = server.requests.find(
      (request) =>
        request.path === "/admin/comments/comment-many/revisions" &&
        request.query.get("cursor") !== null,
    );
    expect(olderRequest?.query.get("cursor")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(olderRequest?.query.get("cursor")).not.toBe("3");
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
    const retry = screen.getByTestId("admin-comment-history-retry");
    expect(retry).toHaveClass("max-lg:min-h-11");
    await user.click(retry);
    expect(
      await screen.findByTestId("admin-comment-history-list"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-comment-history-end")).toBeTruthy();
  });

  it("keeps the loaded page and cursor across a parent re-render", async () => {
    const state = manyRevisionsState();
    const server = new FakeAdminServer(state);
    const user = userEvent.setup();
    const view = renderButton(server, state.comments[0]);

    await user.click(screen.getByTestId("admin-comment-history-comment-many"));
    await screen.findByTestId("admin-comment-history-list");
    await user.click(screen.getByTestId("admin-comment-history-show-older"));
    await waitFor(() => {
      expect(
        screen.getAllByTestId("admin-comment-history-revision"),
      ).toHaveLength(22);
    });
    const firstLoads = server.requests.filter(
      (request) =>
        request.path === "/admin/comments/comment-many/revisions" &&
        request.query.get("cursor") === null,
    ).length;

    view.rerender(
      <I18nProvider>
        <AdminCommentHistoryButton comment={state.comments[0]} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("admin-comment-history-revision"),
      ).toHaveLength(22);
    });
    expect(
      server.requests.filter(
        (request) =>
          request.path === "/admin/comments/comment-many/revisions" &&
          request.query.get("cursor") === null,
      ),
    ).toHaveLength(firstLoads);
    expect(screen.getByTestId("admin-comment-history-end")).toBeTruthy();
  });

  it("closes the dialog when the revisions route answers 404", async () => {
    const state = emptyAdminState();
    state.comments = [adminComment({ id: "comment-gone", revisionCount: 1 })];
    const server = new FakeAdminServer(state);
    server.failNextStatuses = [
      { path: "/admin/comments/comment-gone/revisions", status: 404 },
    ];
    const user = userEvent.setup();
    const view = renderButton(server, state.comments[0]);

    const trigger = screen.getByTestId("admin-comment-history-comment-gone");
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.queryByTestId("admin-comment-history-dialog")).toBeNull();
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    view.unmount();
  });

  it.each(["revision_limit", "gdpr_erase", "writer_gap"] as const)(
    "shows the generic incomplete banner for %s",
    async (reason) => {
      const state = emptyAdminState();
      state.comments = [
        adminComment({
          id: `comment-${reason}`,
          revisionCount: 0,
          historyIncomplete: true,
        }),
      ];
      state.commentHistories[`comment-${reason}`] = adminCommentHistory({
        reason,
      });
      const server = new FakeAdminServer(state);
      const user = userEvent.setup();
      renderButton(server, state.comments[0]);

      await user.click(
        screen.getByTestId(`admin-comment-history-comment-${reason}`),
      );
      const banner = await screen.findByTestId("admin-comment-history-banner");
      expect(banner).toHaveAttribute("data-reason", reason);
      expect(banner).toHaveTextContent("Some history is unavailable.");
      expect(banner).not.toHaveTextContent("0.3.0");
    },
  );

  it("recovers an older page after its request fails", async () => {
    const state = manyRevisionsState();
    const server = new FakeAdminServer(state);
    const user = userEvent.setup();
    renderButton(server, state.comments[0]);

    await user.click(screen.getByTestId("admin-comment-history-comment-many"));
    await screen.findByTestId("admin-comment-history-list");
    server.failNext = ["/admin/comments/comment-many/revisions"];
    await user.click(screen.getByTestId("admin-comment-history-show-older"));
    expect(
      await screen.findByTestId("admin-comment-history-older-error"),
    ).toBeTruthy();
    await user.click(screen.getByTestId("admin-comment-history-older-retry"));
    await waitFor(() => {
      expect(
        screen.getAllByTestId("admin-comment-history-revision"),
      ).toHaveLength(22);
    });
    expect(screen.getByTestId("admin-comment-history-end")).toBeTruthy();
  });

  it("renders revision snapshots as escaped text, never as markup", async () => {
    const state = emptyAdminState();
    const before = "**bold** <img src=x onerror=alert(1)>";
    const after = "<script>alert('x')</script> plain";
    state.comments = [adminComment({ id: "comment-markup", revisionCount: 1 })];
    state.commentHistories["comment-markup"] = adminCommentHistory({
      items: [
        adminCommentRevision({
          id: "revision-markup",
          beforeText: before,
          afterText: after,
        }),
      ],
    });
    const server = new FakeAdminServer(state);
    const user = userEvent.setup();
    renderButton(server, state.comments[0]);

    await user.click(
      screen.getByTestId("admin-comment-history-comment-markup"),
    );
    const dialog = await screen.findByTestId("admin-comment-history-dialog");
    await user.click(
      screen.getByTestId("admin-comment-history-snapshot-toggle-1"),
    );

    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.textContent).toContain(before);
    expect(dialog.textContent).toContain(after);
  });

  it("has no axe violations with the dialog open", async () => {
    const server = new FakeAdminServer(manyRevisionsState());
    const user = userEvent.setup();
    renderButton(server, manyRevisionsState().comments[0]);
    await user.click(screen.getByTestId("admin-comment-history-comment-many"));
    await screen.findByTestId("admin-comment-history-list");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("mirrors the opaque comment-bound cursor and empty limit parity", async () => {
    const state = emptyAdminState();
    state.comments = [
      adminComment({ id: "comment-cursor", revisionCount: 3 }),
      adminComment({ id: "comment-other", revisionCount: 1 }),
    ];
    const items = [
      adminCommentRevision({ id: "rev-3", revisionNumber: 3 }),
      adminCommentRevision({ id: "rev-2", revisionNumber: 2 }),
      adminCommentRevision({ id: "rev-1", revisionNumber: 1 }),
    ];
    state.commentHistories["comment-cursor"] = adminCommentHistory({ items });
    state.commentHistories["comment-other"] = adminCommentHistory({
      items: [adminCommentRevision({ id: "other-1" })],
    });
    const server = new FakeAdminServer(state);

    const first = await server.fetchImpl(
      "http://api.test/api/v1/admin/comments/comment-cursor/revisions?limit=1",
    );
    const firstPage = (await first.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(firstPage.nextCursor).not.toBe("3");

    const second = await server.fetchImpl(
      `http://api.test/api/v1/admin/comments/comment-cursor/revisions?limit=1&cursor=${firstPage.nextCursor}`,
    );
    expect(second.status).toBe(200);
    expect(
      (await second.json()) as { items: Array<{ id: string }> },
    ).toMatchObject({ items: [{ id: "rev-2" }] });

    const emptyLimit = await server.fetchImpl(
      "http://api.test/api/v1/admin/comments/comment-cursor/revisions?limit=",
    );
    expect(emptyLimit.status).toBe(200);
    expect(
      ((await emptyLimit.json()) as { items: unknown[] }).items,
    ).toHaveLength(3);

    const foreign = btoa(JSON.stringify({ c: "comment-other", r: 2 }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    for (const cursor of [foreign, "not-a-cursor"]) {
      const rejected = await server.fetchImpl(
        `http://api.test/api/v1/admin/comments/comment-cursor/revisions?cursor=${cursor}`,
      );
      expect(rejected.status).toBe(400);
    }
  });

  it("omits a zero count, keeps the edit date in the name and marks deleted edits read-only", () => {
    const live = adminComment({
      id: "comment-zero",
      revisionCount: 0,
      editedAt: null,
    });
    const edited = adminComment({
      id: "comment-edited",
      revisionCount: 2,
      editedAt: Date.UTC(2026, 0, 2),
    });
    const deleted = adminComment({
      id: "comment-deleted-edited",
      revisionCount: null,
      historyIncomplete: null,
      deletedAt: Date.UTC(2026, 0, 3),
      editedAt: Date.UTC(2026, 0, 2),
    });
    const server = new FakeAdminServer(emptyAdminState());
    vi.stubGlobal("fetch", server.fetchImpl);

    const view = render(
      <I18nProvider>
        <AdminCommentHistoryButton comment={live} />
        <AdminCommentHistoryButton comment={edited} />
        <AdminCommentHistoryButton comment={deleted} />
      </I18nProvider>,
    );

    expect(
      screen.queryByTestId("admin-comment-revision-count-comment-zero"),
    ).toBeNull();
    const editedTrigger = screen.getByTestId(
      "admin-comment-history-comment-edited",
    );
    expect(editedTrigger).toHaveAccessibleName(/Edited/);
    expect(editedTrigger).toHaveAccessibleName(/2 revisions/);
    expect(editedTrigger).toHaveAccessibleName(/last edited/);
    expect(
      screen.queryByTestId("admin-comment-history-comment-deleted-edited"),
    ).toBeNull();
    expect(screen.getByTestId("admin-comment-edited")).toHaveTextContent(
      "Edited",
    );
    view.unmount();
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
      {
        id: "b-column-deleted",
        title: "Deleted column board",
        userId: "u-1",
        ownerEmail: "member@example.com",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        deletedAt: null,
      },
      {
        id: "b-board-deleted",
        title: "Deleted board",
        userId: "u-1",
        ownerEmail: "member@example.com",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        deletedAt: 2,
      },
    ];
    state.cards = [
      adminCard({ id: "card-1" }),
      adminCard({ id: "card-deleted", deletedAt: 1 }),
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
      adminComment({
        id: "column-deleted",
        cardId: "card-column-deleted",
        revisionCount: 2,
      }),
      adminComment({
        id: "board-deleted",
        cardId: "card-board-deleted",
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
    state.commentHistories["column-deleted"] = state.commentHistories.live;
    state.commentHistories["board-deleted"] = state.commentHistories.live;
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
        deletedAt: 2,
        version: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    ];

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
    expect(page.total).toBe(5);
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
    for (const id of ["parent-deleted", "column-deleted", "board-deleted"]) {
      expect(page.items.find((item) => item.id === id)).toMatchObject({
        revisionCount: null,
        historyIncomplete: null,
      });
    }

    for (const commentId of [
      "deleted",
      "parent-deleted",
      "column-deleted",
      "board-deleted",
    ]) {
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
      expect.arrayContaining([2, null, null, null, null]),
    );
    expect(entityPage.total).toBe(5);
  });
});
