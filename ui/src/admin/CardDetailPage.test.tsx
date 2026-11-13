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
  adminCard,
  adminComment,
  adminUser,
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
