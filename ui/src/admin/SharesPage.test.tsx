import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { FakeAdminServer } from "./test/fake-admin-server";

/**
 * Public shares page (TASK-58): lists every link and revokes one from the
 * panel. Backed by the fake admin API.
 */

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
      {
        id: "sh1",
        token: "abc123",
        boardId: "b1",
        boardTitle: "Board one",
        boardDeleted: false,
        mode: "live",
        title: null,
        includeComments: true,
        includeAttachments: false,
        expiresAt: null,
        revokedAt: null,
        views: 4,
        lastViewedAt: null,
        createdAt: Date.UTC(2026, 0, 1),
        createdBy: "u1",
      },
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    const table = await screen.findByTestId("admin-shares-table");
    expect(table).toHaveTextContent("Board one");
    expect(table).toHaveTextContent("/s/abc123");

    fireEvent.click(screen.getByTestId("admin-share-revoke-sh1"));
    await waitFor(() => expect(server.shares[0]?.revokedAt).not.toBeNull());
  });
});
