import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
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
    expect(screen.getByText("Live comment 0")).toBeTruthy();
    expect(screen.getByText("live-0.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (70)" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Show deleted (60)" }));
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
  });

  it("centres and highlights the comment an anchor link points at", async () => {
    const server = new FakeAdminServer(stateWithCardGraph());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderCard("card-1", "?comment=comment-live-59");

    const note = await screen.findByTestId("admin-card-anchor-comments");
    expect(note).toHaveTextContent("Showing the page around the row");
    expect(screen.getByTestId("admin-card-comments-count")).toHaveTextContent(
      "36 of 70",
    );
    const anchored = document.querySelectorAll(
      '[data-testid="admin-card-detail-comments"] tr[data-anchor="true"]',
    );
    expect(anchored).toHaveLength(1);
    expect(anchored[0]).toHaveTextContent("Live comment 59");
  });

  it("finds a soft-deleted comment anchor and says when it is missing", async () => {
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
});
