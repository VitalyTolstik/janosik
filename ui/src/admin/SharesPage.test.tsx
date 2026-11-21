import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AdminShareRowDto } from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { FakeAdminServer } from "./test/fake-admin-server";

/**
 * Public shares (TASK-58): lists every link and revokes one from the panel.
 * TASK-177.5 adds the server total, pagination and the expiry column; backed
 * by the fake admin API.
 */

function shareRow(
  overrides: Partial<AdminShareRowDto> & { id: string },
): AdminShareRowDto {
  return {
    token: `token-${overrides.id}`,
    boardId: `board-${overrides.id}`,
    boardTitle: `Board ${overrides.id}`,
    boardDeleted: false,
    mode: "live",
    title: null,
    includeComments: true,
    includeAttachments: false,
    expiresAt: null,
    revokedAt: null,
    views: 0,
    lastViewedAt: null,
    createdAt: Date.UTC(2026, 0, 1),
    createdBy: "u1",
    ...overrides,
  };
}

function renderShares() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={["/admin/shares"]}>
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

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SharesPage", () => {
  it("lists shares and revokes one", async () => {
    const server = new FakeAdminServer();
    server.shares = [
      shareRow({
        id: "sh1",
        token: "abc123",
        boardTitle: "Board one",
        views: 4,
      }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    const table = await screen.findByTestId("admin-shares-table");
    expect(table).toHaveTextContent("Board one");
    expect(table).toHaveTextContent("/s/abc123");

    fireEvent.click(screen.getByTestId("admin-share-revoke-sh1"));
    fireEvent.click(screen.getByTestId("admin-confirm-accept"));
    await waitFor(() => expect(server.shares[0]?.revokedAt).not.toBeNull());
  });

  it("pages 101 shares and reports the server total", async () => {
    const server = new FakeAdminServer();
    server.shares = Array.from({ length: 101 }, (_, index) =>
      shareRow({ id: `share-${index}`, boardTitle: `Board ${index}` }),
    );
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    const table = await screen.findByTestId("admin-shares-table");
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–50 of 101",
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 3",
    );

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "51–100 of 101",
      ),
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 2 of 3",
    );

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "101 of 101",
      ),
    );
  });

  it("resets the page when the search changes", async () => {
    const server = new FakeAdminServer();
    server.shares = Array.from({ length: 101 }, (_, index) =>
      shareRow({ id: `share-${index}`, boardTitle: `Board ${index}` }),
    );
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
        "Page 2 of 3",
      ),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /^Search/ }), {
      target: { value: "Board 100" },
    });

    await waitFor(() => {
      const request = server.requests
        .filter((entry) => entry.path === "/admin/shares")
        .at(-1);
      expect(request?.query.get("search")).toBe("Board 100");
      expect(request?.query.get("offset")).toBe("0");
    });
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1 of 1",
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 1",
    );
    expect(screen.getByText("Board 100")).toBeInTheDocument();
  });

  it("marks an expired share and dashes a share with no expiry", async () => {
    const now = Date.now();
    const server = new FakeAdminServer();
    server.shares = [
      shareRow({
        id: "expired",
        boardTitle: "Expired board",
        expiresAt: now - 60_000,
      }),
      shareRow({
        id: "none",
        boardTitle: "No expiry board",
        expiresAt: null,
      }),
      shareRow({
        id: "future",
        boardTitle: "Future board",
        expiresAt: now + 60_000,
      }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    const expired = await screen.findByTestId("admin-share-expires-expired");
    expect(expired).toHaveTextContent("expired");
    expect(
      screen.getByTestId("admin-share-expired-expired"),
    ).toBeInTheDocument();

    expect(screen.getByTestId("admin-share-expires-none")).toHaveTextContent(
      "—",
    );
    expect(
      screen.queryByTestId("admin-share-expired-none"),
    ).not.toBeInTheDocument();

    expect(
      screen.getByTestId("admin-share-expires-future"),
    ).not.toHaveTextContent("expired");
    expect(
      screen.queryByTestId("admin-share-expired-future"),
    ).not.toBeInTheDocument();
  });
});
