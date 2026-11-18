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
  adminActivity,
  adminAttachment,
  adminBoard,
  adminCard,
  adminComment,
  adminLabel,
  adminUser,
  boardMember,
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
    ).toHaveTextContent("denied");
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

  async function renderFields(
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
    renderCard();
    await screen.findByTestId("admin-card-fields");
    return { server, state };
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

  it("disables the 21st label toggle at the cap", async () => {
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
        { length: 20 },
        (_, index) => `cap-${index + 1}`,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-card-label-toggle-cap-21")).toBeTruthy();
    });
    const last = screen.getByTestId("admin-card-label-toggle-cap-21");
    expect(last).toBeDisabled();
    fireEvent.click(last);
    expect(sentCommands(server)).toHaveLength(0);
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
