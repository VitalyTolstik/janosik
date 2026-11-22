import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { LIMITS } from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { defaultI18n, ensureLocale } from "@/i18n/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CalendarComponent } from "@/components/ui/calendar-lazy";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import { adminMessage } from "./admin-i18n";
import AdminApp from "./AdminApp";
import {
  CardFieldsChunkBoundary,
  CardFieldsFallback,
  CardRelationsFallback,
} from "./CardDetailPage";
import { CardFieldsPanel } from "./CardFieldsPanel";
import {
  adminActivity,
  adminAttachment,
  adminBoard,
  adminCard,
  adminCardLink,
  adminChecklist,
  adminComment,
  adminLabel,
  adminUser,
  boardMember,
  contentBoard,
  FakeAdminServer,
  emptyAdminState,
  type FakeAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.3 — card detail blocks are windows: `50 of N`, `Load more`,
 * live-only defaults with an explicit "All", and an anchor for the comment or
 * attachment a global search result pointed at.
 */

function renderCard(cardId = "card-1", query = "") {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[`/admin/cards/${cardId}${query}`]}>
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

function stateWithCardGraph(): FakeAdminState {
  const state = emptyAdminState();
  const now = Date.UTC(2026, 0, 1);
  state.users = [adminUser()];
  state.cards = [adminCard({ id: "card-1", commentIds: [] })];
  state.comments = [
    ...Array.from({ length: 60 }, (_, index) =>
      adminComment({
        id: `comment-live-${index}`,
        text: `Live comment ${index}`,
        createdAt: now + index,
      }),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      adminComment({
        id: `comment-deleted-${index}`,
        text: `Deleted comment ${index}`,
        createdAt: now + 100 + index,
        deletedAt: now + 500,
      }),
    ),
  ];
  state.attachments = [
    ...Array.from({ length: 55 }, (_, index) =>
      adminAttachment({
        id: `attachment-live-${index}`,
        fileName: `live-${index}.png`,
        storedName: `stored-live-${index}.png`,
        createdAt: now + index,
      }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      adminAttachment({
        id: `attachment-deleted-${index}`,
        fileName: `deleted-${index}.png`,
        storedName: `stored-deleted-${index}.png`,
        createdAt: now + 100 + index,
        deletedAt: now + 500,
      }),
    ),
  ];
  state.activity = Array.from({ length: 60 }, (_, index) =>
    adminActivity({
      id: `activity-${index}`,
      type: index % 2 === 0 ? "comment_added" : "member_invited",
      createdAt: now + index,
    }),
  );
  return state;
}

function stateWithLongThread(): FakeAdminState {
  const state = stateWithCardGraph();
  const now = Date.UTC(2026, 0, 1);
  state.comments = [
    ...Array.from({ length: 120 }, (_, index) =>
      adminComment({
        id: `long-live-${index}`,
        text: `Long live ${index}`,
        createdAt: now + index,
      }),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      adminComment({
        id: `long-deleted-${index}`,
        text: `Long deleted ${index}`,
        createdAt: now + 200 + index,
        deletedAt: now + 500,
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

describe("CardDetailPage windows", () => {
  it("shows 50 of N and loads the rest for comments, attachments and the timeline", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    expect(
      await screen.findByTestId("admin-card-comments-count"),
    ).toHaveTextContent("50 of 60");
    expect(
      screen.getByTestId("admin-card-attachments-count"),
    ).toHaveTextContent("50 of 55");
    expect(screen.getByTestId("admin-card-timeline-count")).toHaveTextContent(
      "50 of 60",
    );
    const commentCells = within(
      screen.getByTestId("admin-card-detail-comments"),
    ).getAllByRole("cell");
    expect(commentCells[0]).toHaveAttribute("data-label", "Comment");
    expect(commentCells[1]).toHaveAttribute("data-label", "Author");
    expect(commentCells[4]).toHaveAttribute("data-label", "");

    fireEvent.click(screen.getByTestId("admin-card-comments-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
        "60 of 60",
      );
    });

    fireEvent.click(screen.getByTestId("admin-card-attachments-more"));
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-attachments-count"),
      ).toHaveTextContent("55 of 55");
    });

    fireEvent.click(screen.getByTestId("admin-card-timeline-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-timeline-count")).toHaveTextContent(
        "60 of 60",
      );
    });
  });

  it("hides deleted comments and attachments until Show deleted is chosen", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    expect(
      await screen.findByTestId("admin-card-comments-count"),
    ).toHaveTextContent("50 of 60");
    expect(screen.queryByText("Deleted comment 0")).toBeNull();
    expect(screen.queryByText("deleted-0.png")).toBeNull();
    expect(screen.getByText("Live comment 59")).toBeTruthy();
    expect(screen.getByText("live-54.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (10)" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
        "50 of 70",
      );
    });
    fireEvent.click(screen.getByTestId("admin-card-comments-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
        "70 of 70",
      );
    });
    expect(await screen.findByText("Deleted comment 0")).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-comment-actions-comment-deleted-0"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (5)" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-attachments-count"),
      ).toHaveTextContent("50 of 60");
    });
    fireEvent.click(screen.getByTestId("admin-card-attachments-more"));
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-attachments-count"),
      ).toHaveTextContent("60 of 60");
    });
    expect(await screen.findByText("deleted-0.png")).toBeTruthy();
    expect(
      screen.queryByTestId(
        "admin-card-attachment-actions-attachment-deleted-0",
      ),
    ).toBeNull();
  });

  it("centres and highlights the comment an anchor link points at", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=comment-live-59");

    const note = await screen.findByTestId("admin-card-anchor-comments");
    expect(note).toHaveTextContent("Showing the page around the row");
    expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
      "50 of 70",
    );
    const anchored = document.querySelectorAll(
      '[data-testid="admin-card-detail-comments"] tr[data-anchor="true"]',
    );
    expect(anchored).toHaveLength(1);
    expect(anchored[0]).toHaveTextContent("Live comment 59");
  });

  it("finds a soft-deleted comment anchor", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=comment-deleted-0");

    expect(
      await screen.findByTestId("admin-card-anchor-comments"),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-testid="admin-card-detail-comments"] tr[data-anchor="true"]',
      ),
    ).toHaveTextContent("Deleted comment 0");
  });

  it("reports a genuinely missing anchor", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=comment-does-not-exist");

    expect(
      await screen.findByTestId("admin-card-anchor-missing-comments"),
    ).toHaveTextContent("The linked row is not available in this view.");
    expect(screen.queryByTestId("admin-card-anchor-comments")).toBeNull();
  });

  it("keeps the anchor and its highlight when loading the next page", async () => {
    const server = new FakeAdminServer(stateWithLongThread());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=long-live-80");

    expect(
      await screen.findByTestId("admin-card-anchor-comments"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
      "50 of 130",
    );

    fireEvent.click(screen.getByTestId("admin-card-comments-more"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
        "100 of 130",
      );
    });
    expect(screen.getByTestId("admin-card-anchor-comments")).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-anchor-missing-comments"),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-testid="admin-card-detail-comments"] tr[data-anchor="true"]',
      ),
    ).toHaveTextContent("Long live 80");
  });
});

describe("CardDetailPage identity links and per-row moderation", () => {
  function stateWithOneRow(): FakeAdminState {
    const state = emptyAdminState();
    state.users = [adminUser()];
    state.cards = [adminCard()];
    state.comments = [adminComment()];
    state.attachments = [adminAttachment()];
    state.activity = [adminActivity()];
    return state;
  }

  it("links the comment author, timeline actor and last actor to profiles", async () => {
    const state = stateWithOneRow();
    state.cardLastActors["card-1"] = {
      id: "u-2",
      email: "actor@example.com",
    };
    state.activity = [
      adminActivity({
        actorId: "u-2",
        actorEmail: "actor@example.com",
      }),
    ];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderCard();

    expect(await screen.findByTestId("admin-card-last-actor")).toHaveAttribute(
      "href",
      "/admin/users/u-2",
    );
    expect(
      screen.getByTestId("admin-card-comment-author-comment-1"),
    ).toHaveAttribute("href", "/admin/users/u-1");
    expect(
      screen.getByTestId("admin-card-timeline-actor-activity-activity-1"),
    ).toHaveAttribute("href", "/admin/users/u-2");
  });

  it("degrades a deleted last actor to text, not a broken link", async () => {
    const state = stateWithOneRow();
    state.cardLastActors["card-1"] = { id: "u-ghost", email: null };
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderCard();

    const meta = await screen.findByTestId("admin-card-detail-meta");
    expect(within(meta).queryByTestId("admin-card-last-actor")).toBeNull();
    expect(within(meta).getByTestId("admin-id-u-ghost")).toBeTruthy();
  });

  it("deletes one comment and keeps the row visible with its state", async () => {
    const server = new FakeAdminServer(stateWithOneRow());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    await screen.findByTestId("admin-card-comments-count");
    fireEvent.pointerDown(
      screen.getByTestId("admin-card-comment-actions-comment-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText("Delete"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

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
      await screen.findByTestId("admin-card-comments-count"),
    ).toHaveTextContent("1 of 1");
    expect(
      within(screen.getByTestId("admin-card-detail-comments")).getByText(
        "Deleted",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-comment-actions-comment-1"),
    ).toBeNull();
  });

  it("keeps an anchored comment window after deleting its row", async () => {
    const server = new FakeAdminServer(stateWithLongThread());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=long-live-80");

    expect(
      await screen.findByTestId("admin-card-anchor-comments"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
      "50 of 130",
    );
    fireEvent.pointerDown(
      screen.getByTestId("admin-card-comment-actions-long-live-80"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText("Delete"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.path === "/admin/comments/long-live-80",
        ),
      ).toBe(true);
    });
    expect(screen.getByTestId("admin-card-anchor-comments")).toBeTruthy();
    // The anchor had a centred offset (24), not offset 0: the refresh must
    // keep that window instead of jumping to the first page.
    expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
      "50 of 130",
    );
    const anchored = document.querySelector(
      '[data-testid="admin-card-detail-comments"] tr[data-anchor="true"]',
    );
    expect(anchored).toHaveTextContent("Long live 80");
    expect(within(anchored as HTMLElement).getByText("Deleted")).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-anchor-missing-comments"),
    ).toBeNull();
  });

  it("deletes one attachment and keeps it visible with its state", async () => {
    const server = new FakeAdminServer(stateWithOneRow());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    await screen.findByTestId("admin-card-attachments-count");
    fireEvent.pointerDown(
      screen.getByTestId("admin-card-attachment-actions-attachment-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText("Delete file"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    await waitFor(() => {
      expect(
        server.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.path === "/admin/attachments/attachment-1",
        ),
      ).toBe(true);
    });
    expect(
      within(screen.getByTestId("admin-card-detail-attachments")).getByText(
        "Deleted",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-attachment-actions-attachment-1"),
    ).toBeNull();
  });

  it("surfaces a 403 without dropping the live row", async () => {
    const server = new FakeAdminServer(stateWithOneRow());
    server.failNextStatuses.push({
      path: "/admin/comments/comment-1",
      status: 403,
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    await screen.findByTestId("admin-card-comments-count");
    fireEvent.pointerDown(
      screen.getByTestId("admin-card-comment-actions-comment-1"),
      { button: 0 },
    );
    fireEvent.click(await screen.findByText("Delete"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("admin-confirm-accept"));

    expect(
      await screen.findByText(adminMessage("admin.common.forbidden", "en")),
    ).toBeTruthy();
    expect(
      screen.getByTestId("admin-card-comment-actions-comment-1"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("admin-card-detail-comments")).queryByText(
        "Deleted",
      ),
    ).toBeNull();
  });

  it("uses returnTo as the back target (TASK-176.5)", async () => {
    const state = stateWithOneRow();
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    const backTo = "/admin/moderation?tab=comments&boardId=b-1&search=found";
    renderCard("card-1", `?returnTo=${encodeURIComponent(backTo)}`);

    const back = await screen.findByRole("link", {
      name: adminMessage("admin.common.back", "en"),
    });
    expect(back).toHaveAttribute("href", backTo);
  });
});

describe("CardDetailPage admin editing pilot (TASK-176.8/176.10)", () => {
  it("edits the description through UPDATE_CARD and shows the owner notice", async () => {
    const state = emptyAdminState();
    state.cards = [adminCard({ id: "card-1", commentIds: [] })];
    state.cardDescriptions["card-1"] = "Old support note";
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    expect(
      await screen.findByTestId("admin-card-detail-description"),
    ).toHaveTextContent("Old support note");

    fireEvent.pointerDown(screen.getByTestId("admin-card-detail-actions"), {
      button: 0,
    });
    fireEvent.click(await screen.findByTestId("admin-card-edit-description"));
    const dialog = await screen.findByTestId("admin-card-description-dialog");
    expect(
      within(dialog).getByTestId("admin-card-description-owner-notice"),
    ).toHaveTextContent(adminMessage("admin.common.actingAsOwner", "en"));
    expect(
      within(dialog).getByTestId("admin-card-description-input"),
    ).toHaveValue("Old support note");

    fireEvent.change(
      within(dialog).getByTestId("admin-card-description-input"),
      { target: { value: "Updated by support" } },
    );
    fireEvent.click(
      within(dialog).getByTestId("admin-card-description-submit"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-detail-description"),
      ).toHaveTextContent("Updated by support");
    });
    const sent = server.requests
      .filter((request) => request.path.endsWith("/commands"))
      .at(-1)?.body as {
      commandId?: string;
      action: Record<string, unknown>;
    };
    expect(sent.commandId).toEqual(expect.any(String));
    expect(sent.action).toMatchObject({
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "Updated by support",
    });
    expect(state.audit[0]).toMatchObject({
      action: "board.command",
      targetId: "b-1",
      details: expect.objectContaining({
        commandId: state.commands[0].id,
        masterId: "master-1",
        masterEmail: "master@example.com",
        type: "UPDATE_CARD",
      }),
    });
  });

  it("links a correlated command event to its audit row", async () => {
    const state = emptyAdminState();
    state.cards = [adminCard({ id: "card-1", commentIds: [] })];
    state.commands = [
      {
        id: "cmd-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        actorId: "u-1",
        actorEmail: "member@example.com",
        type: "UPDATE_CARD",
        seq: 1,
        createdAt: 1_760_000_000_000,
        payload: { cardId: "card-1", description: "Admin edit" },
        auditId: "audit-1",
      },
    ];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderCard();

    const link = await screen.findByTestId(
      "admin-card-timeline-audit-command-cmd-1",
    );
    const url = new URL(link.getAttribute("href") ?? "", "http://admin.test");
    expect(url.pathname).toBe("/admin/audit");
    expect(url.searchParams.get("tab")).toBe("audit");
    expect(url.searchParams.get("commandId")).toBe("cmd-1");
    expect(url.searchParams.get("returnTo")).toBe("/admin/cards/card-1");
    expect(link).toHaveAccessibleName("Audit command cmd-1 for card card-1");
    expect(link).toHaveTextContent("Audit");
  });

  it("keeps the description dialog open when saving fails", async () => {
    const state = emptyAdminState();
    state.cards = [adminCard({ id: "card-1", commentIds: [] })];
    state.cardDescriptions["card-1"] = "Old support note";
    const server = new FakeAdminServer(state);
    server.failNextStatuses.push({ path: "/commands", status: 409 });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    await screen.findByTestId("admin-card-detail-description");
    fireEvent.pointerDown(screen.getByTestId("admin-card-detail-actions"), {
      button: 0,
    });
    fireEvent.click(await screen.findByTestId("admin-card-edit-description"));
    const dialog = await screen.findByTestId("admin-card-description-dialog");
    fireEvent.change(
      within(dialog).getByTestId("admin-card-description-input"),
      { target: { value: "Will not save" } },
    );
    fireEvent.click(
      within(dialog).getByTestId("admin-card-description-submit"),
    );

    expect(
      await screen.findByTestId("admin-card-description-error"),
    ).toHaveTextContent(
      adminMessage("admin.cards.description.errorConflict", "en"),
    );
    expect(screen.getByTestId("admin-card-description-dialog")).toBeTruthy();
    expect(
      screen.getByTestId("admin-card-detail-description"),
    ).toHaveTextContent("Old support note");
  });

  it("does not send an unchanged description", async () => {
    const state = emptyAdminState();
    state.cards = [adminCard({ id: "card-1", commentIds: [] })];
    state.cardDescriptions["card-1"] = "Same note";
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    await screen.findByTestId("admin-card-detail-description");
    fireEvent.pointerDown(screen.getByTestId("admin-card-detail-actions"), {
      button: 0,
    });
    fireEvent.click(await screen.findByTestId("admin-card-edit-description"));
    const dialog = await screen.findByTestId("admin-card-description-dialog");
    fireEvent.click(
      within(dialog).getByTestId("admin-card-description-submit"),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("admin-card-description-dialog")).toBeNull();
    });
    expect(
      server.requests.filter((request) => request.path.endsWith("/commands")),
    ).toHaveLength(0);
  });

  it("supports clearing the description", async () => {
    const state = emptyAdminState();
    state.cards = [adminCard({ id: "card-1", commentIds: [] })];
    state.cardDescriptions["card-1"] = "Old support note";
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard();

    expect(
      await screen.findByTestId("admin-card-detail-description"),
    ).toHaveTextContent("Old support note");
    fireEvent.pointerDown(screen.getByTestId("admin-card-detail-actions"), {
      button: 0,
    });
    fireEvent.click(await screen.findByTestId("admin-card-edit-description"));
    const dialog = await screen.findByTestId("admin-card-description-dialog");
    const input = within(dialog).getByTestId("admin-card-description-input");
    expect(input).toHaveValue("Old support note");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(
      within(dialog).getByTestId("admin-card-description-submit"),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("admin-card-detail-description")).toBeNull();
    });
    const sent = server.requests
      .filter((request) => request.path.endsWith("/commands"))
      .at(-1)?.body as { action: Record<string, unknown> };
    expect(sent.action).toMatchObject({
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "",
    });
  });

  it("hides description editing for a deleted card", async () => {
    const state = emptyAdminState();
    state.cards = [
      adminCard({
        id: "card-1",
        commentIds: [],
        deletedAt: 1_760_000_000_000,
      }),
    ];
    vi.stubGlobal("fetch", new FakeAdminServer(state).fetchImpl);
    renderCard();

    fireEvent.pointerDown(
      await screen.findByTestId("admin-card-detail-actions"),
      { button: 0 },
    );
    expect(screen.queryByTestId("admin-card-edit-description")).toBeNull();
  });
});

describe("CardDetailPage admin field editing (TASK-176.9)", () => {
  const now = new Date();
  const DUE = new Date(now.getFullYear(), now.getMonth(), 10, 9, 0).getTime();

  interface SentCommand {
    commandId?: string;
    action: Record<string, unknown>;
  }

  const sentCommands = (server: FakeAdminServer): SentCommand[] =>
    server.requests
      .filter(
        (request) =>
          request.method === "POST" && request.path.endsWith("/commands"),
      )
      .map((request) => request.body as SentCommand);

  function fieldState(): FakeAdminState {
    const state = emptyAdminState();
    state.boards = [adminBoard()];
    state.users = [adminUser()];
    state.cards = [
      adminCard({
        id: "card-1",
        title: "Original title",
        commentIds: [],
        dueDate: DUE,
        priority: "high",
        assigneeId: "u-1",
        assigneeEmail: "member@example.com",
      }),
    ];
    return state;
  }

  function setupFields(
    state = fieldState(),
    configure?: (server: FakeAdminServer) => void,
  ) {
    const server = new FakeAdminServer(state);
    server.boardMembers["b-1"] = [
      boardMember({
        id: "member-owner",
        userId: "u-1",
        userEmail: "member@example.com",
        userDisplayName: "Owner",
        role: "ADMIN",
      }),
      boardMember({
        id: "member-active",
        userId: "u-2",
        userEmail: "active@example.com",
        userDisplayName: "Active User",
      }),
      boardMember({
        id: "member-pending",
        userId: "u-3",
        userEmail: "pending@example.com",
        acceptedAt: null,
      }),
      boardMember({
        id: "member-expired",
        userId: "u-4",
        userEmail: "expired@example.com",
        expiresAt: Date.UTC(2025, 0, 1),
      }),
      boardMember({
        id: "member-disabled",
        userId: "u-5",
        userEmail: "disabled@example.com",
        userDisabledAt: Date.UTC(2025, 0, 1),
      }),
    ];
    server.boardLabels["b-1"] = [
      adminLabel({ id: "label-1", name: "Red label", color: "red" }),
      adminLabel({
        id: "label-2",
        name: "Green label",
        color: "green",
        position: 1,
      }),
      adminLabel({
        id: "label-3",
        name: "Deleted label",
        color: "blue",
        position: 2,
        deletedAt: Date.UTC(2025, 0, 1),
      }),
    ];
    state.cardLabelIds["card-1"] = ["label-1"];
    configure?.(server);
    vi.stubGlobal("fetch", server.fetchImpl);
    return { server, state };
  }

  async function renderFields(
    state = fieldState(),
    configure?: (server: FakeAdminServer) => void,
  ) {
    const { server } = setupFields(state, configure);
    const view = renderCard();
    await screen.findByTestId("admin-card-fields");
    return { server, state, unmount: view.unmount };
  }

  async function renderFieldSwitch(onSaved = vi.fn()) {
    const state = fieldState();
    state.cards.push(
      adminCard({ id: "card-2", title: "Second card", commentIds: [] }),
    );
    state.cardLabelIds["card-2"] = [];
    const { server } = setupFields(state);
    const first = await adminApi.cardDetail("card-1");
    const second = await adminApi.cardDetail("card-2");

    function Harness() {
      const [id, setId] = useState("card-1");
      const [shown, setShown] = useState(true);
      const detail = id === "card-1" ? first : second;
      return (
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <button
                  type="button"
                  data-testid="switch-card"
                  onClick={() => setId("card-2")}
                >
                  switch
                </button>
                <button
                  type="button"
                  data-testid="hide-panel"
                  onClick={() => setShown(false)}
                >
                  hide
                </button>
                {shown ? (
                  <CardFieldsPanel
                    key={detail.card.id}
                    card={detail.card}
                    cardLabels={detail.labels}
                    onSaved={onSaved}
                  />
                ) : null}
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      );
    }

    const view = render(<Harness />);
    await screen.findByTestId("admin-card-label-toggle-label-1");
    return { server, state, onSaved, unmount: view.unmount };
  }

  async function renderFieldsWithCalendar(
    calendarLoader: () => Promise<{ Calendar: CalendarComponent }>,
    i18n = defaultI18n,
  ) {
    const { server, state } = setupFields();
    const { card, labels } = await adminApi.cardDetail("card-1");
    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <ToastProvider>
            <TooltipProvider>
              <CardFieldsChunkBoundary fallback={<CardFieldsFallback />}>
                <CardFieldsPanel
                  card={card}
                  cardLabels={labels}
                  onSaved={() => undefined}
                  calendarLoader={calendarLoader}
                />
              </CardFieldsChunkBoundary>
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>,
    );
    await screen.findByTestId("admin-card-label-toggle-label-1");
    return { server, state };
  }

  function selectCalendarDay(grid: HTMLElement) {
    fireEvent.click(within(grid).getByRole("button", { name: /\b15th\b/ }));
    fireEvent.click(screen.getByTestId("admin-card-due-save"));
    return new Date(now.getFullYear(), now.getMonth(), 15, 9).getTime();
  }

  async function expectPriorityCommand(server: FakeAdminServer) {
    fireEvent.change(screen.getByTestId("admin-card-field-priority-select"), {
      target: { value: "low" },
    });
    await waitFor(() => {
      expect(server.state.cards[0]?.priority).toBe("low");
      expect(
        screen.getByTestId("admin-card-field-priority-select"),
      ).toBeEnabled();
    });
    expect(sentCommands(server).at(-1)?.action).toEqual({
      type: "SET_CARD_PRIORITY",
      cardId: "card-1",
      priority: "low",
      at: expect.any(Number),
    });
  }

  function expectDueCommand(server: FakeAdminServer, dueDate: number) {
    expect(sentCommands(server).at(-1)?.action).toEqual({
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate,
      at: expect.any(Number),
    });
  }

  it("edits the title with UPDATE_CARD, shows the counter and suppresses a no-op", async () => {
    const { server, state } = await renderFields();
    const ownerNotice = screen.getByTestId("admin-card-field-owner-notice");
    expect(ownerNotice).toHaveTextContent(
      adminMessage("admin.common.actingAsOwner", "en"),
    );

    const input = screen.getByTestId("admin-card-title-input");
    expect(input).toHaveValue("Original title");
    expect(screen.getByTestId("char-count")).toHaveTextContent("286");

    fireEvent.change(input, { target: { value: "Renamed by support" } });
    fireEvent.click(screen.getByTestId("admin-card-title-save"));

    await waitFor(() => {
      expect(state.cards[0]?.title).toBe("Renamed by support");
    });
    expect(
      await screen.findByRole("heading", {
        name: "Renamed by support",
        level: 1,
      }),
    ).toBeTruthy();
    expect(sentCommands(server)).toHaveLength(1);
    expect(sentCommands(server)[0]).toMatchObject({
      commandId: expect.any(String),
      action: {
        type: "UPDATE_CARD",
        cardId: "card-1",
        title: "Renamed by support",
        at: expect.any(Number),
      },
    });

    fireEvent.click(screen.getByTestId("admin-card-title-save"));
    expect(sentCommands(server)).toHaveLength(1);
  });

  it("rejects a blank or overlong title without sending a command", async () => {
    const { server } = await renderFields();
    const input = screen.getByTestId("admin-card-title-input");

    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByTestId("admin-card-title-error")).toHaveTextContent(
      "Title must not be blank.",
    );
    expect(screen.getByTestId("admin-card-title-save")).toBeDisabled();

    fireEvent.change(input, { target: { value: "x".repeat(301) } });
    expect(screen.getByTestId("admin-card-title-error")).toHaveTextContent(
      "Title must be at most 300 characters.",
    );
    expect(screen.getByTestId("admin-card-title-save")).toBeDisabled();
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("offers active members only, assigns and unassigns", async () => {
    const { server, state } = await renderFields();
    const select = screen.getByTestId("admin-card-field-assignee-select");
    await waitFor(() => {
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value),
      ).toContain("u-2");
    });
    const values = within(select)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(expect.arrayContaining(["", "u-1", "u-2"]));
    expect(values).not.toContain("u-3");
    expect(values).not.toContain("u-4");
    expect(values).not.toContain("u-5");

    fireEvent.change(select, { target: { value: "u-2" } });
    await waitFor(() => {
      expect(state.cards[0]?.assigneeId).toBe("u-2");
      expect(
        within(screen.getByTestId("admin-card-detail-meta")).getByText(
          "Active User",
        ),
      ).toBeTruthy();
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_ASSIGN",
      cardId: "card-1",
      assigneeId: "u-2",
    });

    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => {
      expect(state.cards[0]?.assigneeId).toBeNull();
      expect(
        within(screen.getByTestId("admin-card-detail-meta")).queryByText(
          "Active User",
        ),
      ).toBeNull();
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "SET_CARD_ASSIGN",
      assigneeId: null,
    });

    fireEvent.change(select, { target: { value: "" } });
    expect(sentCommands(server)).toHaveLength(2);
  });

  it("saves a due date and clears it by omitting dueDate", async () => {
    const { server, state } = await renderFields();
    expect(screen.getByTestId("admin-card-field-due")).toHaveTextContent(
      "Current:",
    );
    expect(screen.getByTestId("admin-card-due-save")).toBeDisabled();

    fireEvent.click(screen.getByTestId("admin-card-due-input"));
    const grid = await screen.findByRole("grid");
    const day = within(grid)
      .getAllByRole("button")
      .find((button) => button.textContent?.trim() === "15");
    expect(day).toBeTruthy();
    fireEvent.click(day as HTMLElement);
    fireEvent.click(screen.getByTestId("admin-card-due-save"));

    const nextDue = new Date(
      now.getFullYear(),
      now.getMonth(),
      15,
      9,
      0,
    ).getTime();
    await waitFor(() => {
      expect(state.cards[0]?.dueDate).toBe(nextDue);
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: nextDue,
    });

    fireEvent.click(screen.getByTestId("admin-card-due-remove"));
    await waitFor(() => {
      expect(state.cards[0]?.dueDate).toBeNull();
    });
    const cleared = sentCommands(server)[1]?.action;
    expect(cleared).toMatchObject({
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
    });
    expect(cleared !== undefined && "dueDate" in cleared).toBe(false);
  });

  it("opens a real lazy calendar and saves a selected due date", async () => {
    const loader = vi.fn(() => import("@/components/ui/calendar"));
    const { server, state } = await renderFieldsWithCalendar(loader);
    const trigger = screen.getByRole("button", { name: "Due date" });
    expect(loader).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const popover = within(screen.getByRole("dialog"));
    expect(popover.getByText("Time")).toBeInTheDocument();
    expect(popover.getAllByRole("listbox")).toHaveLength(2);
    const dueDate = selectCalendarDay(await popover.findByRole("grid"));

    await waitFor(() => expect(state.cards[0]?.dueDate).toBe(dueDate));
    expectDueCommand(server, dueDate);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("contains a rejected import, saves a sibling field, then retries and saves the due date", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      let finishRetry!: (module: { Calendar: CalendarComponent }) => void;
      const retryLoad = new Promise<{ Calendar: CalendarComponent }>(
        (resolve) => {
          finishRetry = resolve;
        },
      );
      const loader = vi
        .fn(() => retryLoad)
        .mockRejectedValueOnce(new Error("Calendar chunk unavailable"));
      const { server, state } = await renderFieldsWithCalendar(loader);
      const mountedFields = [
        "admin-card-title-input",
        "admin-card-field-assignee-select",
        "admin-card-due-input",
        "admin-card-due-save",
        "admin-card-due-remove",
        "admin-card-field-priority-select",
        "admin-card-cover-trigger",
        "admin-card-label-toggle-label-1",
      ].map((id) => [id, screen.getByTestId(id)] as const);
      const trigger = screen.getByTestId("admin-card-due-input");
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog");
      const popover = within(dialog);

      expect(await popover.findByRole("alert")).toHaveTextContent(
        "The date and time picker could not load. Other fields are still editable.",
      );
      expect(popover.getByLabelText("Due date and time")).toBeInTheDocument();
      expect(popover.queryByText("Time")).not.toBeInTheDocument();
      expect(popover.queryByRole("grid")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("admin-card-fields-error"),
      ).not.toBeInTheDocument();
      for (const [id, control] of mountedFields) {
        expect(screen.getByTestId(id)).toBe(control);
      }
      await expectPriorityCommand(server);
      expect(popover.getByRole("alert")).toBeInTheDocument();
      expect(loader).toHaveBeenCalledTimes(1);

      const retry = popover.getByRole("button", {
        name: "Retry date and time picker",
      });
      expect(retry).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
      expect(retry).toHaveFocus();
      finishRetry(await import("@/components/ui/calendar"));
      const grid = await popover.findByRole("grid");
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      await user.tab();
      expect(
        popover.getByRole("button", { name: /previous month/i }),
      ).toHaveFocus();
      expect(popover.getByText("Time")).toBeInTheDocument();
      expect(popover.getAllByRole("listbox")).toHaveLength(2);
      expect(popover.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        popover.queryByLabelText("Due date and time"),
      ).not.toBeInTheDocument();
      const dueDate = selectCalendarDay(grid);
      await waitFor(() => expect(state.cards[0]?.dueDate).toBe(dueDate));
      expectDueCommand(server, dueDate);
    } finally {
      error.mockRestore();
    }
  });

  it("offers native date and time on the first failure and keeps the draft after Retry fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const loader = vi
        .fn<() => Promise<{ Calendar: CalendarComponent }>>()
        .mockRejectedValue(new Error("Calendar chunk unavailable"));
      const { server, state } = await renderFieldsWithCalendar(loader);
      const trigger = screen.getByRole("button", { name: "Due date" });
      fireEvent.click(trigger);
      const popover = within(screen.getByRole("dialog"));
      const firstInput = await popover.findByLabelText("Due date and time");
      fireEvent.change(firstInput, { target: { value: "2027-04-05T17:42" } });

      fireEvent.click(
        popover.getByRole("button", { name: "Retry date and time picker" }),
      );
      await waitFor(() => expect(firstInput).not.toBeInTheDocument());
      const input = await popover.findByLabelText("Due date and time");
      expect(input).toHaveAttribute("type", "datetime-local");
      expect(input).toHaveValue("2027-04-05T17:42");
      expect(popover.getByRole("alert")).toBeInTheDocument();
      expect(
        popover.getByRole("button", { name: "Retry date and time picker" }),
      ).toHaveFocus();
      expect(popover.queryByText("Time")).not.toBeInTheDocument();
      expect(popover.queryByRole("listbox")).not.toBeInTheDocument();
      expect(loader).toHaveBeenCalledTimes(2);
      await expectPriorityCommand(server);

      fireEvent.change(input, { target: { value: "2027-04-06T18:43" } });
      fireEvent.click(screen.getByTestId("admin-card-due-save"));
      const dueDate = new Date(2027, 3, 6, 18, 43).getTime();
      await waitFor(() => {
        expect(state.cards[0]?.dueDate).toBe(dueDate);
        expect(screen.getByTestId("admin-card-due-remove")).toBeEnabled();
      });
      expectDueCommand(server, dueDate);

      fireEvent.click(screen.getByTestId("admin-card-due-remove"));
      await waitFor(() => expect(state.cards[0]?.dueDate).toBeNull());
      expect(sentCommands(server).at(-1)?.action).toEqual({
        type: "SET_CARD_DUE_DATE",
        cardId: "card-1",
        at: expect.any(Number),
      });

      fireEvent.keyDown(
        popover.getByRole("button", { name: "Retry date and time picker" }),
        {
          key: "Escape",
        },
      );
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      error.mockRestore();
    }
  });

  it("localizes the picker failure, Retry and native input in Russian", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await ensureLocale("ru");
      const i18n = defaultI18n.cloneInstance({ lng: "ru" });
      await renderFieldsWithCalendar(
        () => Promise.reject(new Error("Calendar chunk unavailable")),
        i18n,
      );
      fireEvent.click(screen.getByTestId("admin-card-due-input"));
      const popover = within(screen.getByRole("dialog"));
      expect(await popover.findByRole("alert")).toHaveTextContent(
        "Панель выбора даты и времени не загрузилась. Остальные поля доступны.",
      );
      expect(
        popover.getByRole("button", {
          name: "Повторить загрузку",
        }),
      ).toHaveFocus();
      expect(popover.getByLabelText("Срок и время")).toHaveAttribute(
        "type",
        "datetime-local",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("contains a calendar render error inside the due-date popover", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("Calendar render failed");
    try {
      await renderFieldsWithCalendar(async () => ({
        Calendar: function BrokenCalendar() {
          throw cause;
        },
      }));
      fireEvent.click(screen.getByRole("button", { name: "Due date" }));
      const popover = within(screen.getByRole("dialog"));
      expect(await popover.findByRole("alert")).toHaveTextContent(
        "The date and time picker could not load.",
      );
      expect(error).toHaveBeenCalledWith(
        "Date and time picker failed:",
        cause,
        expect.stringContaining("BrokenCalendar"),
      );
      expect(
        screen.queryByTestId("admin-card-fields-error"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("admin-card-title-input")).toBeEnabled();
    } finally {
      error.mockRestore();
    }
  });

  it("restores the saved due date when clearing is rejected", async () => {
    const { server, state } = await renderFields();
    server.failNextStatuses.push({ path: "/commands", status: 409 });
    fireEvent.click(screen.getByTestId("admin-card-due-remove"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-card-field-due")).toHaveTextContent(
        "The change conflicts with the current card. Reload and try again.",
      );
    });
    expect(screen.getByTestId("admin-card-due-input")).not.toHaveTextContent(
      "No due date",
    );
    expect(screen.getByTestId("admin-card-due-remove")).toBeTruthy();
    expect(state.cards[0]?.dueDate).toBe(DUE);
  });

  it("shows the label cap message for a wip conflict", async () => {
    const { server } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    server.failNextStatuses.push({
      path: "/commands",
      status: 409,
      body: {
        message: "Too many labels on the card",
        conflict: "wip",
        currentVersion: 0,
      },
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-card-field-labels")).toHaveTextContent(
        "A card can have at most 20 labels.",
      );
    });
  });

  it("does not treat sub-minute due-date precision as dirty", async () => {
    const state = fieldState();
    state.cards[0]!.dueDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      10,
      9,
      0,
      42,
      500,
    ).getTime();
    const { server } = await renderFields(state);

    expect(screen.getByTestId("admin-card-due-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("admin-card-due-save"));
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("shows a localized error and keeps the card when a title save is rejected", async () => {
    const { server, state } = await renderFields();
    server.failNextStatuses.push({ path: "/commands", status: 409 });
    const input = screen.getByTestId("admin-card-title-input");
    fireEvent.change(input, { target: { value: "Rejected title" } });
    fireEvent.click(screen.getByTestId("admin-card-title-save"));

    expect(
      await screen.findByTestId("admin-card-title-error"),
    ).toHaveTextContent(
      "The change conflicts with the current card. Reload and try again.",
    );
    expect(state.cards[0]?.title).toBe("Original title");
    expect(
      screen.getByRole("heading", { name: "Original title", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-card-title-input")).toHaveValue(
      "Rejected title",
    );
  });

  it("shows a localized 404 and keeps a label toggle when the command is rejected", async () => {
    const { server, state } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    server.failNextStatuses.push({ path: "/commands", status: 404 });
    const second = screen.getByTestId("admin-card-label-toggle-label-2");
    fireEvent.click(second);

    await waitFor(() => {
      expect(screen.getByTestId("admin-card-field-labels")).toHaveTextContent(
        "The card or label no longer exists. Reload the page.",
      );
    });
    expect(state.cardLabelIds["card-1"]).toEqual(["label-1"]);
    expect(second).toHaveAttribute("aria-pressed", "false");
  });

  it("offers a retry when board members and labels fail to load", async () => {
    const state = fieldState();
    const { server } = await renderFields(state, (fake) => {
      fake.failNextStatuses.push({ path: "/meta", status: 500 });
    });

    expect(
      await screen.findByTestId("admin-card-field-assignee-error"),
    ).toHaveTextContent("Could not load board members and labels.");
    expect(screen.getByTestId("admin-card-fields-board-error")).toBeTruthy();
    expect(
      screen.getByTestId("admin-card-field-assignee-select"),
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("admin-card-fields-board-retry"));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("admin-card-field-assignee-select"))
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value),
      ).toContain("u-2");
    });
    expect(
      server.requests.filter((request) => request.path.endsWith("/meta")),
    ).toHaveLength(2);
    expect(screen.queryByTestId("admin-card-field-assignee-error")).toBeNull();
  });

  it("keeps a current inactive assignee visible as a fallback option", async () => {
    const state = fieldState();
    state.cards[0]!.assigneeId = "u-5";
    state.cards[0]!.assigneeEmail = "disabled@example.com";
    await renderFields(state);

    const select = screen.getByTestId("admin-card-field-assignee-select");
    await waitFor(() => {
      expect(select).toHaveValue("u-5");
    });
    const options = within(select).getAllByRole("option");
    expect(
      options.some(
        (option) =>
          (option as HTMLOptionElement).value === "u-5" &&
          option.textContent?.includes("current, inactive"),
      ),
    ).toBe(true);
    expect(
      options.map((option) => (option as HTMLOptionElement).value),
    ).not.toContain("u-4");
  });

  it("changes priority and resets medium to the default", async () => {
    const { server, state } = await renderFields();
    const select = screen.getByTestId("admin-card-field-priority-select");
    expect(select).toHaveValue("high");

    fireEvent.change(select, { target: { value: "high" } });
    expect(sentCommands(server)).toHaveLength(0);

    fireEvent.change(select, { target: { value: "blocker" } });
    await waitFor(() => {
      expect(state.cards[0]?.priority).toBe("blocker");
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_PRIORITY",
      cardId: "card-1",
      priority: "blocker",
    });
    expect(
      await screen.findByTestId("admin-card-priority-badge"),
    ).toHaveTextContent("blocker");

    fireEvent.change(select, { target: { value: "medium" } });
    await waitFor(() => {
      expect(state.cards[0]?.priority).toBeNull();
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "SET_CARD_PRIORITY",
      priority: "medium",
    });
    await waitFor(() => {
      expect(select).toHaveValue("medium");
      expect(screen.queryByTestId("admin-card-priority-badge")).toBeNull();
    });

    fireEvent.change(select, { target: { value: "medium" } });
    expect(sentCommands(server)).toHaveLength(2);
  });

  it("sets and removes a cover through the compact palette", async () => {
    const { server, state } = await renderFields();
    expect(screen.getByTestId("admin-card-cover-current")).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-card-cover-trigger"));
    fireEvent.click(await screen.findByTestId("admin-card-cover-color-red"));
    await waitFor(() => {
      expect(state.cardCovers["card-1"]).toEqual({
        type: "color",
        value: "red",
      });
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "color", value: "red" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-cover-trigger")).toHaveTextContent(
        "Change cover",
      );
    });

    fireEvent.click(screen.getByTestId("admin-card-cover-trigger"));
    fireEvent.click(await screen.findByTestId("admin-card-cover-color-red"));
    expect(sentCommands(server)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("admin-card-cover-trigger"));
    fireEvent.click(await screen.findByTestId("admin-card-cover-remove"));
    await waitFor(() => {
      expect(state.cardCovers["card-1"]).toBeNull();
    });
    const cleared = sentCommands(server)[1]?.action;
    expect(cleared).toMatchObject({
      type: "SET_CARD_COVER",
      cardId: "card-1",
    });
    expect(cleared !== undefined && "cover" in cleared).toBe(false);
  });

  it("toggles live labels one command at a time", async () => {
    const { server, state } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId("admin-card-label-toggle-label-3")).toBeNull();

    const first = screen.getByTestId("admin-card-label-toggle-label-1");
    const second = screen.getByTestId("admin-card-label-toggle-label-2");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(second);
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId: "label-2",
      on: true,
    });

    fireEvent.click(first);
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-2"]);
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "SET_CARD_LABEL",
      labelId: "label-1",
      on: false,
    });
  });

  it("explains the immediate label save in a named help dialog", async () => {
    await renderFields();
    const help = await screen.findByTestId("admin-card-labels-help");
    expect(help).toHaveAccessibleName("About labels");
    expect(help.closest("label")).toBeNull();
    expect(help).toHaveAttribute("aria-expanded", "false");

    help.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "About labels" });
    const body = within(dialog).getByText(/Labels save immediately/);
    expect(body).toHaveTextContent("attach it");
    expect(body).toHaveTextContent("detach it");
    expect(body).toHaveTextContent("board history");
    expect(help).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "About labels" }),
      ).not.toBeInTheDocument(),
    );
    expect(help).toHaveFocus();
    expect(help).toHaveAttribute("aria-expanded", "false");

    help.focus();
    await userEvent.keyboard(" ");
    await screen.findByRole("dialog", { name: "About labels" });
    await userEvent.click(document.body);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "About labels" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("localizes the labels help in Russian", async () => {
    await ensureLocale("ru");
    const i18n = defaultI18n.cloneInstance({ lng: "ru" });
    await renderFieldsWithCalendar(
      () => Promise.reject(new Error("Calendar chunk unavailable")),
      i18n,
    );
    const help = screen.getByTestId("admin-card-labels-help");
    expect(help).toHaveAccessibleName("О метках");
    fireEvent.click(help);
    const dialog = await screen.findByRole("dialog", { name: "О метках" });
    const body = within(dialog).getByText(/Метки сохраняются сразу/);
    expect(body).toHaveTextContent("прикрепить её");
    expect(body).toHaveTextContent("историю доски");
  });

  it("keeps one label success toast per card and replaces it", async () => {
    const { server, state } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    const region = screen.getByRole("region", { name: "Notifications" });

    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(within(region).getAllByRole("status")).toHaveLength(1);
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Label updated",
    );
    expect(sentCommands(server)).toHaveLength(1);

    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-1"),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-1"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-2"]);
    });
    expect(within(region).getAllByRole("status")).toHaveLength(1);
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Label updated",
    );
    expect(sentCommands(server)).toHaveLength(2);
  });

  it("does not leak a late label success from card A into card B", async () => {
    const { server, onSaved } = await renderFieldSwitch();
    let release!: () => void;
    server.holdCommands = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.method === "POST" && request.path.endsWith("/commands"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId("switch-card"));
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-card-label-toggle-label-1"),
      ).toHaveAttribute("aria-pressed", "false"),
    );

    await act(async () => {
      release();
    });
    expect(screen.queryByText("Label updated")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("The action failed")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("admin-card-label-toggle-label-2"),
    ).not.toBeDisabled();
  });

  it("does not leak a late label failure from card A into card B", async () => {
    const { server, onSaved } = await renderFieldSwitch();
    let release!: () => void;
    server.holdCommands = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.failNext.push("/commands");
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.method === "POST" && request.path.endsWith("/commands"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId("switch-card"));
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-card-label-toggle-label-1"),
      ).toHaveAttribute("aria-pressed", "false"),
    );

    await act(async () => {
      release();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Label updated")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("admin-card-label-toggle-label-2"),
    ).not.toBeDisabled();
  });

  it("clears a visible label toast when the card changes", async () => {
    const { state } = await renderFieldSwitch();
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(screen.getByText("Label updated")).toBeVisible();

    fireEvent.click(screen.getByTestId("switch-card"));
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-card-label-toggle-label-1"),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(screen.queryByText("Label updated")).not.toBeInTheDocument();
  });

  it("clears a visible label toast when only the panel unmounts", async () => {
    const { state } = await renderFieldSwitch();
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(screen.getByText("Label updated")).toBeVisible();

    fireEvent.click(screen.getByTestId("hide-panel"));
    await waitFor(() =>
      expect(screen.queryByText("Label updated")).not.toBeInTheDocument(),
    );
    // The provider is still mounted: the toast was removed by the panel
    // cleanup, not by tearing down the notifications region.
    expect(
      screen.getByRole("region", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("admin-card-label-toggle-label-1"),
    ).not.toBeInTheDocument();
  });

  it("clears the old success as soon as the next label request starts", async () => {
    const { server, state } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(screen.getByText("Label updated")).toBeVisible();

    let release!: () => void;
    server.holdCommands = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-1"));
    await waitFor(() =>
      expect(screen.queryByText("Label updated")).not.toBeInTheDocument(),
    );

    release();
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-2"]);
    });
    expect(screen.getByText("Label updated")).toBeVisible();
  });

  it("clears the previous label success when the next command fails", async () => {
    const { server, state } = await renderFields();
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-2"),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-2"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
    });
    expect(screen.getByText("Label updated")).toBeVisible();

    server.failNext.push("/commands");
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-label-1"),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-label-1"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
    expect(screen.queryByText("Label updated")).not.toBeInTheDocument();
    expect(state.cardLabelIds["card-1"]).toEqual(["label-1", "label-2"]);
  });

  it("keeps the label toast on a cap-blocked click", async () => {
    const state = fieldState();
    const { server } = await renderFields(state, (fake) => {
      fake.boardLabels["b-1"] = Array.from({ length: 21 }, (_, index) =>
        adminLabel({
          id: `cap-${index + 1}`,
          name: `Cap ${index + 1}`,
          color: "slate",
          position: index,
        }),
      );
      state.cardLabelIds["card-1"] = Array.from(
        { length: 19 },
        (_, index) => `cap-${index + 1}`,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-label-toggle-cap-20")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("admin-card-label-toggle-cap-20"));
    await waitFor(() => {
      expect(state.cardLabelIds["card-1"]).toHaveLength(20);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("admin-card-label-toggle-cap-20"),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText("Label updated")).toBeVisible();

    const last = screen.getByTestId("admin-card-label-toggle-cap-21");
    expect(last).toBeDisabled();
    fireEvent.click(last);
    expect(screen.getByText("Label updated")).toBeVisible();
    expect(sentCommands(server)).toHaveLength(1);
  });

  it("allows field edits on an archived card", async () => {
    const archived = fieldState();
    archived.cards[0]!.archivedAt = Date.UTC(2025, 5, 1);
    const { server, state } = await renderFields(archived);
    expect(screen.getByTestId("admin-card-field-owner-notice")).toBeTruthy();
    const select = screen.getByTestId("admin-card-field-priority-select");
    fireEvent.change(select, { target: { value: "lowest" } });
    await waitFor(() => {
      expect(state.cards[0]?.priority).toBe("lowest");
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CARD_PRIORITY",
      priority: "lowest",
    });
  });

  it("hides every field editor for a deleted card", async () => {
    const deleted = fieldState();
    deleted.cards[0]!.deletedAt = Date.UTC(2025, 5, 1);
    vi.stubGlobal("fetch", new FakeAdminServer(deleted).fetchImpl);
    renderCard("card-1");
    expect(await screen.findByTestId("admin-card-detail-actions")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-fields")).toBeNull();
    expect(screen.queryByTestId("admin-card-title-input")).toBeNull();
  });
});

describe("CardDetailPage field chunk fallback", () => {
  it("keeps the page usable and offers reload when the field chunk fails", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const BrokenFields = () => {
      throw new Error("chunk failed");
    };
    render(
      <I18nProvider>
        <CardFieldsChunkBoundary fallback={<CardFieldsFallback />}>
          <BrokenFields />
        </CardFieldsChunkBoundary>
      </I18nProvider>,
    );

    expect(screen.getByTestId("admin-card-fields-error")).toHaveTextContent(
      "Could not load the card field editor. Reload the page to try again.",
    );
    expect(screen.getByTestId("admin-card-fields-reload")).toHaveTextContent(
      "Reload page",
    );
    errorSpy.mockRestore();
  });
});

describe("FakeAdminServer card field fidelity", () => {
  const post = (
    server: FakeAdminServer,
    commandId: string,
    action: Record<string, unknown>,
  ) =>
    server.fetchImpl("http://api.test/api/v1/admin/boards/b-1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId, action }),
    });

  function fakeFieldState(): FakeAdminState {
    const state = emptyAdminState();
    state.boards = [adminBoard()];
    state.cards = [adminCard({ commentIds: [] })];
    return state;
  }

  it("rejects a reused commandId with a different payload", async () => {
    const server = new FakeAdminServer(fakeFieldState());
    const action = {
      type: "SET_CARD_PRIORITY",
      cardId: "card-1",
      priority: "high",
      at: 1,
    };
    expect((await post(server, "replay-1", action)).status).toBe(200);
    expect(
      (
        await post(server, "replay-1", {
          ...action,
          priority: "low",
        })
      ).status,
    ).toBe(409);
    expect((await post(server, "replay-1", action)).status).toBe(200);
    expect(server.state.commands).toHaveLength(1);
  });

  it("mirrors priority, cover, due-date and title validation", async () => {
    const server = new FakeAdminServer(fakeFieldState());
    for (const action of [
      { type: "SET_CARD_PRIORITY", cardId: "card-1", priority: "urgent" },
      {
        type: "SET_CARD_COVER",
        cardId: "card-1",
        cover: { type: "color", value: "not-a-color" },
      },
      {
        type: "SET_CARD_DUE_DATE",
        cardId: "card-1",
        dueDate: 1e300,
      },
      { type: "UPDATE_CARD", cardId: "card-1", title: "x".repeat(301) },
    ]) {
      expect(
        (await post(server, crypto.randomUUID(), { ...action, at: 1 })).status,
      ).toBe(400);
    }
    expect(server.state.commands).toHaveLength(0);
  });

  it("counts only live labels toward the card cap", async () => {
    const state = fakeFieldState();
    const server = new FakeAdminServer(state);
    server.boardLabels["b-1"] = [
      ...Array.from({ length: 21 }, (_, index) =>
        adminLabel({
          id: `live-${index + 1}`,
          name: `Live ${index + 1}`,
          position: index,
        }),
      ),
      adminLabel({
        id: "deleted-label",
        name: "Deleted",
        position: 21,
        deletedAt: 1,
      }),
    ];
    state.cardLabelIds["card-1"] = [
      ...Array.from({ length: 19 }, (_, index) => `live-${index + 1}`),
      "deleted-label",
    ];

    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "live-20",
          on: true,
          at: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "live-21",
          on: true,
          at: 2,
        })
      ).status,
    ).toBe(409);
  });
});

describe("CardDetailPage checklist and link editing (TASK-176.9 B2)", () => {
  const CARD_IDS = ["card-1", "card-2", "card-3", "card-4", "card-5"];

  interface SentCommand {
    commandId?: string;
    action: Record<string, unknown>;
  }

  const sentCommands = (server: FakeAdminServer): SentCommand[] =>
    server.requests
      .filter(
        (request) =>
          request.method === "POST" && request.path.endsWith("/commands"),
      )
      .map((request) => request.body as SentCommand);

  function aggregate(links: Record<string, unknown> = {}) {
    return contentBoard({
      columns: [
        {
          id: "col-1",
          title: "Backlog",
          cardIds: [...CARD_IDS],
          createdAt: 1,
        },
      ],
      cards: Object.fromEntries(
        CARD_IDS.map((id, index) => [
          id,
          {
            id,
            title: id === "card-1" ? "Moderator" : `Card ${index + 1}`,
            createdAt: index + 1,
            updatedAt: index + 1,
            labelIds: [],
            ...(links[id] === undefined ? {} : { links: links[id] }),
          },
        ]),
      ) as ReturnType<typeof contentBoard>["cards"],
    });
  }

  function relationsState(): FakeAdminState {
    const state = emptyAdminState();
    state.boards = [adminBoard()];
    state.users = [adminUser()];
    state.cards = CARD_IDS.map((id, index) =>
      adminCard({
        id,
        title: id === "card-1" ? "Moderator" : `Card ${index + 1}`,
        commentIds: [],
      }),
    );
    state.cardChecklists["card-1"] = [
      adminChecklist({
        id: "checklist-1",
        title: "Todo",
        items: [
          {
            id: "item-1",
            text: "First step",
            done: true,
            position: 0,
            deletedAt: null,
          },
          {
            id: "item-2",
            text: "Second step",
            done: false,
            position: 1,
            deletedAt: null,
          },
        ],
      }),
    ];
    state.contentBoard = aggregate();
    return state;
  }

  async function renderRelations(
    state = relationsState(),
    configure?: (server: FakeAdminServer) => void,
  ) {
    const server = new FakeAdminServer(state);
    configure?.(server);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1");
    await screen.findByTestId("admin-card-relations");
    return { server, state };
  }

  it("adds, renames and deletes checklists and their items with one command each", async () => {
    const { server, state } = await renderRelations();

    expect(
      screen.getByTestId("admin-card-relations-owner-notice"),
    ).toHaveTextContent(adminMessage("admin.common.actingAsOwner", "en"));
    expect(
      screen.getByTestId("admin-checklist-progress-checklist-1"),
    ).toHaveTextContent("1/2");
    expect(screen.getByText("First step")).toBeTruthy();
    expect(screen.getByText("Second step")).toBeTruthy();

    fireEvent.change(screen.getByTestId("admin-new-checklist-title"), {
      target: { value: "  Acceptance  " },
    });
    fireEvent.click(screen.getByTestId("admin-new-checklist-add"));
    await waitFor(() => {
      expect(state.cardChecklists["card-1"]).toHaveLength(2);
    });
    const added = sentCommands(server)[0];
    expect(added.action).toMatchObject({
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "Acceptance",
      at: expect.any(Number),
    });
    expect(added.commandId).toEqual(expect.any(String));
    const newChecklistId = String(added.action.newChecklistId);
    await screen.findByTestId(`admin-checklist-row-${newChecklistId}`);

    fireEvent.click(
      screen.getByTestId(`admin-checklist-rename-${newChecklistId}`),
    );
    fireEvent.change(
      screen.getByTestId(`admin-checklist-rename-input-${newChecklistId}`),
      { target: { value: "Acceptance renamed" } },
    );
    fireEvent.click(
      screen.getByTestId(`admin-checklist-rename-save-${newChecklistId}`),
    );
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (checklist) => checklist.id === newChecklistId,
        )?.title,
      ).toBe("Acceptance renamed");
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "RENAME_CHECKLIST",
      cardId: "card-1",
      checklistId: newChecklistId,
      title: "Acceptance renamed",
    });

    fireEvent.change(
      screen.getByTestId(`admin-checklist-item-input-${newChecklistId}`),
      { target: { value: "  Write a test  " } },
    );
    fireEvent.click(
      screen.getByTestId(`admin-checklist-item-add-${newChecklistId}`),
    );
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (checklist) => checklist.id === newChecklistId,
        )?.items,
      ).toHaveLength(1);
    });
    const checklist = state.cardChecklists["card-1"]!.find(
      (entry) => entry.id === newChecklistId,
    )!;
    const newItemId = checklist.items[0]!.id;
    expect(sentCommands(server)[2]?.action).toMatchObject({
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: newChecklistId,
      newItemId,
      text: "Write a test",
    });

    fireEvent.click(
      await screen.findByTestId(`admin-checklist-item-toggle-${newItemId}`),
    );
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (entry) => entry.id === newChecklistId,
        )?.items[0]?.done,
      ).toBe(true);
    });
    expect(sentCommands(server)[3]?.action).toMatchObject({
      type: "SET_CHECKLIST_ITEM_DONE",
      checklistId: newChecklistId,
      itemId: newItemId,
      done: true,
    });

    fireEvent.click(
      await screen.findByTestId(`admin-checklist-item-rename-${newItemId}`),
    );
    fireEvent.change(
      screen.getByTestId(`admin-checklist-item-rename-input-${newItemId}`),
      { target: { value: "Rename the test" } },
    );
    fireEvent.click(
      screen.getByTestId(`admin-checklist-item-rename-save-${newItemId}`),
    );
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (entry) => entry.id === newChecklistId,
        )?.items[0]?.text,
      ).toBe("Rename the test");
    });
    expect(sentCommands(server)[4]?.action).toMatchObject({
      type: "RENAME_CHECKLIST_ITEM",
      checklistId: newChecklistId,
      itemId: newItemId,
      text: "Rename the test",
    });

    fireEvent.click(
      await screen.findByTestId(`admin-checklist-item-delete-${newItemId}`),
    );
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (entry) => entry.id === newChecklistId,
        )?.items[0]?.deletedAt,
      ).not.toBeNull();
    });
    expect(sentCommands(server)[5]?.action).toMatchObject({
      type: "DELETE_CHECKLIST_ITEM",
      checklistId: newChecklistId,
      itemId: newItemId,
    });

    fireEvent.click(
      screen.getByTestId(`admin-checklist-delete-${newChecklistId}`),
    );
    fireEvent.click(await screen.findByTestId("admin-confirm-accept"));
    await waitFor(() => {
      expect(
        state.cardChecklists["card-1"]?.find(
          (entry) => entry.id === newChecklistId,
        )?.deletedAt,
      ).not.toBeNull();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(`admin-checklist-row-${newChecklistId}`),
      ).toBeNull();
    });
    const commandIds = sentCommands(server).map((entry) => entry.commandId);
    expect(new Set(commandIds).size).toBe(commandIds.length);
    expect(sentCommands(server)).toHaveLength(7);
  });

  it("suppresses unchanged checklist titles and blank drafts", async () => {
    const { server } = await renderRelations();

    fireEvent.click(screen.getByTestId("admin-checklist-rename-checklist-1"));
    fireEvent.click(
      screen.getByTestId("admin-checklist-rename-save-checklist-1"),
    );
    expect(sentCommands(server)).toHaveLength(0);

    expect(screen.getByTestId("admin-new-checklist-add")).toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-new-checklist-title"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("admin-new-checklist-add")).toBeDisabled();
    expect(sentCommands(server)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("admin-checklist-item-rename-item-2"));
    fireEvent.click(
      screen.getByTestId("admin-checklist-item-rename-save-item-2"),
    );
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("shows deferred checklists and items with empty states", async () => {
    const state = relationsState();
    state.cardChecklists["card-1"] = [
      adminChecklist({
        id: "deleted-checklist",
        title: "Deleted checklist",
        deletedAt: Date.UTC(2025, 0, 1),
        items: [],
      }),
      adminChecklist({
        id: "empty-checklist",
        title: "Empty checklist",
        items: [
          {
            id: "deleted-item",
            text: "Deleted item",
            done: false,
            position: 0,
            deletedAt: Date.UTC(2025, 0, 1),
          },
        ],
      }),
    ];
    await renderRelations(state);

    expect(screen.queryByText("Deleted checklist")).toBeNull();
    expect(screen.queryByText("Deleted item")).toBeNull();
    expect(screen.getByText("Empty checklist")).toBeTruthy();
    expect(
      screen.getByTestId("admin-checklist-items-empty-empty-checklist"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-card-links-empty")).toHaveTextContent(
      "No linked cards yet.",
    );
  });

  it("removes outgoing and incoming links from the correct holder card", async () => {
    const state = relationsState();
    state.cardLinks = [
      adminCardLink({
        id: "link-out",
        fromCardId: "card-1",
        toCardId: "card-3",
        type: "relates_to",
      }),
      adminCardLink({
        id: "link-in",
        fromCardId: "card-2",
        toCardId: "card-1",
        type: "blocks",
      }),
    ];
    const { server } = await renderRelations(state);

    const outgoing = screen.getByTestId("admin-card-link-row-link-out");
    const incoming = screen.getByTestId("admin-card-link-row-link-in");
    expect(outgoing).toHaveAttribute("data-direction", "out");
    expect(incoming).toHaveAttribute("data-direction", "in");
    expect(outgoing).toHaveTextContent("relates_to");
    expect(outgoing).toHaveTextContent("relates to");
    expect(incoming).toHaveTextContent("blocks");
    expect(incoming).toHaveTextContent("is blocked by");

    fireEvent.click(screen.getByTestId("admin-card-link-remove-link-out"));
    await waitFor(() => {
      expect(
        state.cardLinks.find((link) => link.id === "link-out")?.deletedAt,
      ).not.toBeNull();
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "REMOVE_CARD_LINK",
      cardId: "card-1",
      linkId: "link-out",
      targetCardId: "card-3",
      linkType: "relates_to",
    });

    fireEvent.click(
      await screen.findByTestId("admin-card-link-remove-link-in"),
    );
    await waitFor(() => {
      expect(
        state.cardLinks.find((link) => link.id === "link-in")?.deletedAt,
      ).not.toBeNull();
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "REMOVE_CARD_LINK",
      // The row lives on card-2, not on the card being viewed.
      cardId: "card-2",
      linkId: "link-in",
      targetCardId: "card-1",
      linkType: "blocks",
    });
  });

  it("adds a link and supports reverse phrasing for incoming semantics", async () => {
    const { server, state } = await renderRelations();

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 4" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-4"),
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("admin-card-link-target"),
    );
    fireEvent.click(screen.getByTestId("admin-card-link-add"));
    await waitFor(() => {
      expect(
        state.cardLinks.some(
          (link) =>
            link.fromCardId === "card-1" &&
            link.toCardId === "card-4" &&
            link.deletedAt === null,
        ),
      ).toBe(true);
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      targetCardId: "card-4",
      linkType: "relates_to",
    });

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-type"), {
      target: { value: "blockedBy" },
    });
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 5" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-5"),
    );
    fireEvent.click(screen.getByTestId("admin-card-link-add"));
    await waitFor(() => {
      expect(
        state.cardLinks.some(
          (link) =>
            link.fromCardId === "card-5" &&
            link.toCardId === "card-1" &&
            link.type === "blocks" &&
            link.deletedAt === null,
        ),
      ).toBe(true);
    });
    expect(sentCommands(server)[1]?.action).toMatchObject({
      type: "ADD_CARD_LINK",
      // "Card 1 is blocked by Card 5" stores the row on Card 5.
      cardId: "card-5",
      targetCardId: "card-1",
      linkType: "blocks",
    });
  });

  it("excludes self and already-linked pairs from the target picker", async () => {
    const state = relationsState();
    state.cardLinks = [
      adminCardLink({
        id: "existing-pair",
        fromCardId: "card-1",
        toCardId: "card-2",
        type: "relates_to",
      }),
    ];
    (
      state.contentBoard!.cards["card-1"] as {
        links?: Array<{ id: string; type: string; targetCardId: string }>;
      }
    ).links = [
      {
        id: "existing-pair",
        type: "relates_to",
        targetCardId: "card-2",
      },
    ];
    const { server } = await renderRelations(state);

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card" },
    });
    expect(
      await screen.findByTestId("admin-card-link-suggestion-card-3"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-link-suggestion-card-1"),
    ).toBeNull();
    expect(
      screen.queryByTestId("admin-card-link-suggestion-card-2"),
    ).toBeNull();
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("blocks a blocks cycle and a holder at the outgoing cap", async () => {
    const cycleState = relationsState();
    cycleState.cardLinks = [
      adminCardLink({
        id: "cycle-existing-1",
        fromCardId: "card-2",
        toCardId: "card-3",
        type: "blocks",
      }),
      adminCardLink({
        id: "cycle-existing-2",
        fromCardId: "card-3",
        toCardId: "card-1",
        type: "blocks",
      }),
    ];
    (
      cycleState.contentBoard!.cards["card-2"] as {
        links?: Array<{ id: string; type: string; targetCardId: string }>;
      }
    ).links = [
      {
        id: "cycle-existing-1",
        type: "blocks",
        targetCardId: "card-3",
      },
    ];
    (
      cycleState.contentBoard!.cards["card-3"] as {
        links?: Array<{ id: string; type: string; targetCardId: string }>;
      }
    ).links = [
      {
        id: "cycle-existing-2",
        type: "blocks",
        targetCardId: "card-1",
      },
    ];
    const { server } = await renderRelations(cycleState);

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-type"), {
      target: { value: "blocks" },
    });
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-link-cycle")).toHaveTextContent(
      "That blocking link would create a cycle.",
    );
    expect(screen.getByTestId("admin-card-link-add")).toBeDisabled();
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("disables the add control when the holder is at 50 outgoing links", async () => {
    const state = relationsState();
    const capLinks = Array.from({ length: 50 }, (_, index) => ({
      id: `cap-${index}`,
      type: "relates_to" as const,
      targetCardId: "card-3",
    }));
    state.cardLinks = capLinks.map((link) =>
      adminCardLink({
        id: link.id,
        fromCardId: "card-1",
        toCardId: link.targetCardId,
        type: link.type,
      }),
    );
    (state.contentBoard!.cards["card-1"] as { links?: unknown }).links =
      capLinks;
    const { server } = await renderRelations(state);

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-links-cap")).toHaveTextContent(
      "The holder card can have at most 50 outgoing links.",
    );
    expect(screen.getByTestId("admin-card-link-add")).toBeDisabled();
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("localizes a duplicate-pair rejection from the server", async () => {
    const { server } = await renderRelations();
    server.failNextStatuses.push({
      path: "/commands",
      status: 409,
      body: { code: "link_pair_exists" },
    });

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    fireEvent.click(screen.getByTestId("admin-card-link-add"));
    expect(
      await screen.findByTestId("admin-card-relations-error"),
    ).toHaveTextContent("These cards are already linked.");
  });

  it("keeps checklist editing on an archived card and hides it when deleted", async () => {
    const archived = relationsState();
    archived.cards[0]!.archivedAt = Date.UTC(2025, 5, 1);
    const { server, state } = await renderRelations(archived);

    fireEvent.click(screen.getByTestId("admin-checklist-item-toggle-item-2"));
    await waitFor(() => {
      expect(state.cardChecklists["card-1"]?.[0]?.items[1]?.done).toBe(true);
    });
    expect(sentCommands(server)[0]?.action).toMatchObject({
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      itemId: "item-2",
      done: true,
    });

    cleanup();
    const deleted = relationsState();
    deleted.cards[0]!.deletedAt = Date.UTC(2025, 5, 1);
    vi.stubGlobal("fetch", new FakeAdminServer(deleted).fetchImpl);
    renderCard("card-1");
    expect(await screen.findByTestId("admin-card-detail-actions")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-relations")).toBeNull();
    expect(screen.queryByTestId("admin-new-checklist-title")).toBeNull();
  });

  it("counts outgoing and incoming links separately", async () => {
    const state = relationsState();
    state.cardLinks = [
      adminCardLink({
        id: "out-live-1",
        fromCardId: "card-1",
        toCardId: "card-3",
        type: "relates_to",
      }),
      adminCardLink({
        id: "out-live-2",
        fromCardId: "card-1",
        toCardId: "card-4",
        type: "duplicates",
      }),
      adminCardLink({
        id: "out-deleted",
        fromCardId: "card-1",
        toCardId: "card-5",
        type: "blocks",
        deletedAt: 1,
      }),
      adminCardLink({
        id: "in-live-1",
        fromCardId: "card-2",
        toCardId: "card-1",
        type: "blocks",
      }),
      adminCardLink({
        id: "in-live-2",
        fromCardId: "card-3",
        toCardId: "card-1",
        type: "relates_to",
      }),
      adminCardLink({
        id: "in-deleted",
        fromCardId: "card-4",
        toCardId: "card-1",
        type: "duplicates",
        deletedAt: 1,
      }),
    ];
    await renderRelations(state);

    expect(
      screen.getByTestId("admin-card-links-outgoing-count"),
    ).toHaveTextContent("2 of 50 outgoing links on this card");
    expect(
      screen.getByTestId("admin-card-links-incoming-count"),
    ).toHaveTextContent("2 incoming links");

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 5" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-5"),
    );
    expect(screen.getByTestId("admin-card-link-add")).not.toBeDisabled();
  });

  it("uses the singular incoming copy for one link", async () => {
    const state = relationsState();
    state.cardLinks = [
      adminCardLink({
        id: "one-incoming",
        fromCardId: "card-2",
        toCardId: "card-1",
        type: "relates_to",
      }),
    ];
    await renderRelations(state);
    expect(
      screen.getByTestId("admin-card-links-incoming-count"),
    ).toHaveTextContent("1 incoming link");
  });

  it("does not apply incoming links to the viewed card's outgoing cap", async () => {
    const state = relationsState();
    const incoming = Array.from({ length: 50 }, (_, index) => {
      const id = `incoming-card-${index}`;
      const linkId = `incoming-link-${index}`;
      state.cards.push(adminCard({ id, title: `Incoming ${index}` }));
      state.contentBoard!.columns[0]!.cardIds.push(id);
      state.contentBoard!.cards[id] = {
        id,
        title: `Incoming ${index}`,
        createdAt: 100 + index,
        updatedAt: 100 + index,
        labelIds: [],
        links: [{ id: linkId, type: "relates_to", targetCardId: "card-1" }],
      };
      return adminCardLink({
        id: linkId,
        fromCardId: id,
        toCardId: "card-1",
        type: "relates_to",
      });
    });
    // Add one query-matching unlinked card so the filtered list is provably
    // non-empty while every "Incoming N" card is already linked.
    state.cards.push(
      adminCard({ id: "incoming-open", title: "Incoming open" }),
    );
    state.contentBoard!.columns[0]!.cardIds.push("incoming-open");
    state.contentBoard!.cards["incoming-open"] = {
      id: "incoming-open",
      title: "Incoming open",
      createdAt: 200,
      updatedAt: 200,
      labelIds: [],
    };
    state.cardLinks = incoming;
    await renderRelations(state);

    expect(
      screen.getByTestId("admin-card-links-outgoing-count"),
    ).toHaveTextContent("0 of 50 outgoing links on this card");
    expect(
      screen.getByTestId("admin-card-links-incoming-count"),
    ).toHaveTextContent("50 incoming links");

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    const targetInput = screen.getByTestId("admin-card-link-target");

    // Check the picker before selecting anything: choosing a target closes
    // the suggestion list. "Incoming" matches the 50 linked rows and the one
    // unlinked card, proving the picker is non-empty and the linked rows are
    // filtered out.
    fireEvent.change(targetInput, { target: { value: "Incoming" } });
    expect(
      await screen.findByTestId("admin-card-link-suggestion-incoming-open"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("admin-card-link-suggestion-incoming-card-0"),
    ).toBeNull();

    // Now switch the query and select an unlinked card to verify the outgoing
    // counter/cap stays independent from the 50 incoming rows.
    fireEvent.change(targetInput, { target: { value: "Card 2" } });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-link-add")).not.toBeDisabled();
  });

  it("shows the reverse holder cap instead of the viewed card's incoming count", async () => {
    const state = relationsState();
    const capLinks = Array.from({ length: 50 }, (_, index) => ({
      id: `holder-cap-${index}`,
      type: "relates_to" as const,
      targetCardId: "card-3",
    }));
    state.cardLinks = capLinks.map((link) =>
      adminCardLink({
        id: link.id,
        fromCardId: "card-2",
        toCardId: link.targetCardId,
        type: link.type,
      }),
    );
    (state.contentBoard!.cards["card-2"] as { links?: unknown }).links =
      capLinks;
    const { server } = await renderRelations(state);

    expect(
      screen.getByTestId("admin-card-links-outgoing-count"),
    ).toHaveTextContent("0 of 50 outgoing links on this card");
    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    fireEvent.change(screen.getByTestId("admin-card-link-type"), {
      target: { value: "blockedBy" },
    });
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-links-holder-cap")).toHaveTextContent(
      "“Card 2” holds 50 of 50 outgoing links",
    );
    expect(screen.getByTestId("admin-card-link-add")).toBeDisabled();
    expect(sentCommands(server)).toHaveLength(0);
  });

  it("disables checklist and item creation at their caps", async () => {
    const checklistCap = relationsState();
    checklistCap.cardChecklists["card-1"] = Array.from(
      { length: LIMITS.checklistsPerCard },
      (_, index) =>
        adminChecklist({
          id: `cap-checklist-${index}`,
          title: `Checklist ${index}`,
          position: index,
        }),
    );
    const first = await renderRelations(checklistCap);
    expect(screen.getByTestId("admin-new-checklist-title")).toBeDisabled();
    expect(screen.getByTestId("admin-new-checklist-add")).toBeDisabled();
    expect(
      screen.getAllByText("A card can have at most 20 checklists.").length,
    ).toBeGreaterThan(0);
    expect(sentCommands(first.server)).toHaveLength(0);
    cleanup();

    const itemCap = relationsState();
    itemCap.cardChecklists["card-1"] = [
      adminChecklist({
        id: "checklist-1",
        title: "Full checklist",
        items: Array.from({ length: LIMITS.itemsPerChecklist }, (_, index) => ({
          id: `cap-item-${index}`,
          text: `Item ${index}`,
          done: false,
          position: index,
          deletedAt: null,
        })),
      }),
    ];
    const second = await renderRelations(itemCap);
    expect(
      screen.getByTestId("admin-checklist-item-input-checklist-1"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("admin-checklist-item-add-checklist-1"),
    ).toBeDisabled();
    expect(
      screen.getAllByText("A checklist can have at most 100 items.").length,
    ).toBeGreaterThan(0);
    expect(sentCommands(second.server)).toHaveLength(0);
  });

  it("loads board content lazily, keeps it across checklist writes and refreshes after links", async () => {
    const { server, state } = await renderRelations();
    const contentRequests = () =>
      server.requests.filter(
        (request) =>
          request.method === "GET" && request.path.endsWith("/content"),
      ).length;

    expect(contentRequests()).toBe(0);
    fireEvent.click(screen.getByTestId("admin-checklist-item-toggle-item-2"));
    await waitFor(() => {
      expect(state.cardChecklists["card-1"]?.[0]?.items[1]?.done).toBe(true);
    });
    expect(contentRequests()).toBe(0);

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    await waitFor(() => expect(contentRequests()).toBe(1));
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-link-selected")).toHaveTextContent(
      "Card 2",
    );

    // A checklist write reloads the detail but must not clear the link draft
    // or refetch the aggregate.
    fireEvent.click(screen.getByTestId("admin-checklist-item-toggle-item-2"));
    await waitFor(() => expect(contentRequests()).toBe(1));
    expect(screen.getByTestId("admin-card-link-selected")).toHaveTextContent(
      "Card 2",
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-card-link-add")).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByTestId("admin-card-link-add"));
    await waitFor(() => {
      expect(
        state.cardLinks.some(
          (link) =>
            link.fromCardId === "card-1" &&
            link.toCardId === "card-2" &&
            link.deletedAt === null,
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(contentRequests()).toBe(2));
  });

  it("retries a failed board-content load", async () => {
    const { server } = await renderRelations();
    server.failNextStatuses.push({ path: "/content", status: 500 });

    fireEvent.click(screen.getByTestId("admin-card-link-open"));
    expect(
      await screen.findByTestId("admin-card-links-board-error"),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-card-links-board-retry"));
    expect(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-card-links-board-error")).toBeNull();
  });

  it("clears the link draft when the header or Cancel closes the form", async () => {
    await renderRelations();
    const open = screen.getByTestId("admin-card-link-open");

    fireEvent.click(open);
    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    expect(screen.getByTestId("admin-card-link-selected")).toBeTruthy();

    fireEvent.click(open);
    expect(screen.queryByTestId("admin-card-link-form")).toBeNull();
    fireEvent.click(open);
    expect(screen.queryByTestId("admin-card-link-selected")).toBeNull();
    expect(screen.getByTestId("admin-card-link-target")).toHaveValue("");

    fireEvent.change(screen.getByTestId("admin-card-link-target"), {
      target: { value: "Card 2" },
    });
    fireEvent.click(
      await screen.findByTestId("admin-card-link-suggestion-card-2"),
    );
    fireEvent.click(screen.getByTestId("admin-card-link-cancel"));
    expect(screen.queryByTestId("admin-card-link-form")).toBeNull();
    fireEvent.click(open);
    expect(screen.queryByTestId("admin-card-link-selected")).toBeNull();
  });

  it("supports keyboard selection, Escape and focus restore in the target combobox", async () => {
    await renderRelations();
    const open = screen.getByTestId("admin-card-link-open");
    fireEvent.click(open);
    const input = await screen.findByTestId("admin-card-link-target");
    fireEvent.change(input, { target: { value: "Card" } });
    await screen.findByTestId("admin-card-link-suggestions");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toEqual(expect.any(String));
    expect(document.getElementById(activeId as string)).toHaveAttribute(
      "role",
      "option",
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("admin-card-link-selected")).toHaveTextContent(
      "Card 2",
    );
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("admin-card-link-selected")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("admin-card-link-form")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it("keeps dangling/deleted link rows readable and removes only safe rows", async () => {
    const state = relationsState();
    state.cards.push(
      adminCard({
        id: "card-6",
        title: "Deleted target",
        commentIds: [],
        deletedAt: 1,
      }),
      adminCard({
        id: "card-7",
        title: "Deleted holder",
        commentIds: [],
        deletedAt: 1,
      }),
    );
    state.cardLinks = [
      adminCardLink({
        id: "dangling-out",
        fromCardId: "card-1",
        toCardId: "card-6",
        type: "relates_to",
      }),
      adminCardLink({
        id: "deleted-out",
        fromCardId: "card-1",
        toCardId: "card-5",
        type: "blocks",
        deletedAt: 1,
      }),
      adminCardLink({
        id: "dangling-in",
        fromCardId: "card-7",
        toCardId: "card-1",
        type: "duplicates",
      }),
    ];
    const { server } = await renderRelations(state);

    const dangling = screen.getByTestId("admin-card-link-row-dangling-out");
    expect(dangling).toHaveTextContent("Deleted target");
    expect(dangling).toHaveTextContent("Card deleted");
    expect(
      screen.getByTestId("admin-card-link-remove-dangling-out"),
    ).toBeTruthy();
    const deleted = screen.getByTestId("admin-card-link-row-deleted-out");
    expect(deleted).toHaveTextContent("Deleted");
    expect(
      screen.queryByTestId("admin-card-link-remove-deleted-out"),
    ).toBeNull();

    // The deleted incoming holder is known from the DTO flag, so Remove is
    // hidden before the lazy board aggregate is ever requested.
    const incoming = screen.getByTestId("admin-card-link-row-dangling-in");
    expect(incoming).toHaveTextContent("Deleted holder");
    expect(incoming).toHaveTextContent("Card deleted");
    expect(
      screen.queryByTestId("admin-card-link-remove-dangling-in"),
    ).toBeNull();
    expect(
      screen.getByTestId("admin-card-links-incoming-count"),
    ).toHaveTextContent("0 incoming links");
    expect(
      server.requests.filter(
        (request) =>
          request.method === "GET" && request.path.endsWith("/content"),
      ),
    ).toHaveLength(0);
    expect(
      server.requests.filter(
        (request) =>
          request.method === "POST" && request.path.endsWith("/commands"),
      ),
    ).toHaveLength(0);
  });

  it("names rename buttons after the checklist or item", async () => {
    await renderRelations();
    expect(
      screen.getByTestId("admin-checklist-rename-checklist-1"),
    ).toHaveAttribute("aria-label", "Rename checklist “Todo”");
    expect(
      screen.getByTestId("admin-checklist-item-rename-item-2"),
    ).toHaveAttribute("aria-label", "Rename item “Second step”");
  });

  it("keeps the page usable when the relations chunk fails", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => {
      throw new Error("chunk failed");
    };
    render(
      <I18nProvider>
        <CardFieldsChunkBoundary fallback={<CardRelationsFallback />}>
          <Broken />
        </CardFieldsChunkBoundary>
      </I18nProvider>,
    );
    expect(
      screen.getByTestId("admin-card-relations-load-error"),
    ).toHaveTextContent(
      "Could not load the checklist and link editor. Reload the page to try again.",
    );
    expect(
      screen.getByTestId("admin-card-relations-load-reload"),
    ).toHaveTextContent("Reload page");
    errorSpy.mockRestore();
  });
});

describe("FakeAdminServer relation fidelity (TASK-176.9 B2)", () => {
  const post = (
    server: FakeAdminServer,
    commandId: string,
    action: Record<string, unknown>,
  ) =>
    server.fetchImpl("http://api.test/api/v1/admin/boards/b-1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId, action }),
    });

  function fakeRelationsState(): FakeAdminState {
    const state = emptyAdminState();
    state.boards = [adminBoard()];
    state.cards = [
      adminCard({ id: "card-1", commentIds: [] }),
      adminCard({ id: "card-2", title: "Target", commentIds: [] }),
      adminCard({ id: "card-3", title: "Cycle", commentIds: [] }),
    ];
    state.contentBoard = contentBoard({
      columns: [
        {
          id: "col-1",
          title: "Backlog",
          cardIds: ["card-1", "card-2", "card-3"],
          createdAt: 1,
        },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Moderate me",
          createdAt: 1,
          updatedAt: 1,
          labelIds: [],
        },
        "card-2": {
          id: "card-2",
          title: "Target",
          createdAt: 2,
          updatedAt: 2,
          labelIds: [],
        },
        "card-3": {
          id: "card-3",
          title: "Cycle",
          createdAt: 3,
          updatedAt: 3,
          labelIds: [],
        },
      },
    });
    return state;
  }

  it("persists checklists and links and exposes them in the card detail", async () => {
    const server = new FakeAdminServer(fakeRelationsState());
    const checklistId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const linkId = crypto.randomUUID();

    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "ADD_CHECKLIST",
          cardId: "card-1",
          newChecklistId: checklistId,
          title: "Steps",
          at: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId,
          newItemId: itemId,
          text: "First",
          at: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "ADD_CARD_LINK",
          cardId: "card-1",
          linkId,
          targetCardId: "card-2",
          linkType: "relates_to",
          at: 3,
        })
      ).status,
    ).toBe(200);

    const detailResponse = await server.fetchImpl(
      "http://api.test/api/v1/admin/cards/card-1/detail",
    );
    const detail = (await detailResponse.json()) as {
      checklists: Array<{
        id: string;
        title: string;
        items: Array<{ id: string; text: string; done: boolean }>;
      }>;
      linksOut: Array<{
        id: string;
        otherCardId: string;
        otherCardTitle: string;
        type: string;
      }>;
    };
    expect(detail.checklists).toEqual([
      expect.objectContaining({
        id: checklistId,
        title: "Steps",
        items: [
          expect.objectContaining({ id: itemId, text: "First", done: false }),
        ],
      }),
    ]);
    expect(detail.linksOut).toEqual([
      expect.objectContaining({
        id: linkId,
        otherCardId: "card-2",
        otherCardTitle: "Target",
        type: "relates_to",
      }),
    ]);
    expect(server.state.commands).toHaveLength(3);
  });

  it("rejects invalid checklist/link writes without a command or audit row", async () => {
    const state = fakeRelationsState();
    state.cardChecklists["card-1"] = [
      adminChecklist({
        id: "checklist-1",
        title: "Checklist",
        items: [
          {
            id: "item-1",
            text: "Item",
            done: false,
            position: 0,
            deletedAt: null,
          },
        ],
      }),
    ];
    const server = new FakeAdminServer(state);
    const reject = async (status: number, action: Record<string, unknown>) => {
      const response = await post(server, crypto.randomUUID(), {
        ...action,
        at: 1,
      });
      expect(response.status).toBe(status);
    };

    await reject(404, {
      type: "RENAME_CHECKLIST",
      cardId: "card-1",
      checklistId: "missing",
      title: "Missing",
    });
    await reject(404, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      checklistId: "checklist-1",
      itemId: "missing",
      done: true,
    });
    await reject(409, {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: "checklist-1",
      title: "Live id",
    });
    await reject(400, {
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: crypto.randomUUID(),
      targetCardId: "card-1",
      linkType: "relates_to",
    });
    await reject(404, {
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: crypto.randomUUID(),
      targetCardId: "missing",
      linkType: "relates_to",
    });

    state.cardLinks = [
      adminCardLink({
        id: "existing",
        fromCardId: "card-1",
        toCardId: "card-2",
        type: "relates_to",
      }),
      adminCardLink({
        id: "cycle-1",
        fromCardId: "card-2",
        toCardId: "card-3",
        type: "blocks",
      }),
      adminCardLink({
        id: "cycle-2",
        fromCardId: "card-3",
        toCardId: "card-1",
        type: "blocks",
      }),
    ];
    await reject(409, {
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: crypto.randomUUID(),
      targetCardId: "card-2",
      linkType: "blocks",
    });
    await reject(409, {
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: crypto.randomUUID(),
      targetCardId: "card-3",
      linkType: "blocks",
    });
    await reject(404, {
      type: "REMOVE_CARD_LINK",
      cardId: "card-2",
      linkId: "existing",
      targetCardId: "card-2",
      linkType: "relates_to",
    });
    await reject(409, {
      type: "REMOVE_CARD_LINK",
      cardId: "card-1",
      linkId: "existing",
      targetCardId: "card-2",
      linkType: "blocks",
    });

    expect(server.state.commands).toHaveLength(0);
    expect(server.state.audit).toHaveLength(0);
  });

  it("rejects fresh checklist/item adds at their caps without writing a command", async () => {
    const state = fakeRelationsState();
    state.cardChecklists["card-1"] = Array.from(
      { length: LIMITS.checklistsPerCard },
      (_, index) =>
        adminChecklist({
          id: `cap-checklist-${index}`,
          title: `Checklist ${index}`,
          position: index,
          items:
            index === 0
              ? Array.from(
                  { length: LIMITS.itemsPerChecklist },
                  (__, itemIndex) => ({
                    id: `cap-item-${itemIndex}`,
                    text: `Item ${itemIndex}`,
                    done: false,
                    position: itemIndex,
                    deletedAt: null,
                  }),
                )
              : [],
        }),
    );
    const server = new FakeAdminServer(state);
    const responses = await Promise.all([
      post(server, crypto.randomUUID(), {
        type: "ADD_CHECKLIST",
        cardId: "card-1",
        newChecklistId: crypto.randomUUID(),
        title: "Over the checklist cap",
        at: 1,
      }),
      post(server, crypto.randomUUID(), {
        type: "ADD_CHECKLIST_ITEM",
        cardId: "card-1",
        checklistId: "cap-checklist-0",
        newItemId: crypto.randomUUID(),
        text: "Over the item cap",
        at: 2,
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect(server.state.commands).toHaveLength(0);
    expect(server.state.audit).toHaveLength(0);
  });

  it("validates text/link types and scopes pair/cap guards to the board", async () => {
    const state = fakeRelationsState();
    state.cardChecklists["card-1"] = [
      adminChecklist({
        id: "checklist-1",
        title: "Checklist",
        items: [],
      }),
    ];
    const server = new FakeAdminServer(state);
    const reject = async (action: Record<string, unknown>) => {
      const response = await post(server, crypto.randomUUID(), {
        ...action,
        at: 1,
      });
      expect(response.status).toBe(400);
    };

    await reject({
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: crypto.randomUUID(),
      title: "   ",
    });
    await reject({
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: crypto.randomUUID(),
      title: "x".repeat(LIMITS.checklistTitle + 1),
    });
    await reject({
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "checklist-1",
      newItemId: crypto.randomUUID(),
      text: "   ",
    });
    await reject({
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "checklist-1",
      newItemId: crypto.randomUUID(),
      text: "x".repeat(LIMITS.checklistItem + 1),
    });
    await reject({
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: crypto.randomUUID(),
      targetCardId: "card-2",
      linkType: "sideways",
    });
    expect(server.state.commands).toHaveLength(0);
    expect(server.state.audit).toHaveLength(0);

    // A pair and 50 rows on another board must not mark this pair/card as
    // linked or capped.
    state.cardLinks = Array.from({ length: 50 }, (_, index) =>
      adminCardLink({
        id: `other-board-${index}`,
        boardId: "b-2",
        fromCardId: "card-1",
        toCardId: index === 0 ? "card-2" : "card-3",
        type: "relates_to",
      }),
    );
    expect(
      (
        await post(server, crypto.randomUUID(), {
          type: "ADD_CARD_LINK",
          cardId: "card-1",
          linkId: crypto.randomUUID(),
          targetCardId: "card-2",
          linkType: "relates_to",
          at: 2,
        })
      ).status,
    ).toBe(200);
    expect(server.state.commands).toHaveLength(1);
  });
});
