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

const CREATED_AT = Date.UTC(2026, 0, 1);

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
    createdAt: CREATED_AT,
    createdBy: "u1",
    ...overrides,
  };
}

/** Rows are seeded newest-first so the fake's `createdAt desc` order is real. */
function shareRows(count: number): AdminShareRowDto[] {
  return Array.from({ length: count }, (_, index) =>
    shareRow({
      id: `share-${index}`,
      boardTitle: `Board ${index}`,
      createdAt: CREATED_AT - index,
    }),
  );
}

function lastSharesRequest(server: FakeAdminServer) {
  return server.requests
    .filter((entry) => entry.path === "/admin/shares")
    .at(-1);
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
  vi.restoreAllMocks();
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

  it("caps a long board title instead of widening the table", async () => {
    const title =
      "A very long board title that would otherwise push the expiry and actions columns off the screen";
    const deletedTitle =
      "A very long deleted board title that would otherwise push the expiry and actions columns off the screen";
    const server = new FakeAdminServer();
    server.shares = [
      shareRow({ id: "long-title", boardTitle: title }),
      shareRow({
        id: "long-deleted",
        boardTitle: deletedTitle,
        boardDeleted: true,
        createdAt: CREATED_AT - 1,
      }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    const link = await screen.findByRole("link", { name: title });
    expect(link).toHaveAttribute("title", title);
    expect(link).toHaveClass("max-w-[20rem]", "truncate");

    const deleted = screen.getByText(deletedTitle);
    expect(deleted).toHaveAttribute("title", deletedTitle);
    expect(deleted).toHaveClass("truncate");
    expect(deleted.parentElement).toHaveClass(
      "flex",
      "max-w-[20rem]",
      "min-w-0",
    );
    expect(screen.getByText("board gone")).toBeVisible();
  });

  it("pages 101 shares, reports the server total and disables the edges", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    expect(screen.queryByTestId("admin-shares-total")).not.toBeInTheDocument();
    const table = await screen.findByTestId("admin-shares-table");
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–50 of 101",
    );
    expect(screen.getByTestId("admin-pagination-prev")).toBeDisabled();
    expect(screen.getByTestId("admin-pagination-next")).toBeEnabled();

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("50"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "51–100 of 101",
      ),
    );
    expect(within(table).getByText("Board 50")).toBeInTheDocument();
    expect(within(table).queryByText("Board 0")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 2 of 3",
    );

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("100"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "101 of 101",
      ),
    );
    expect(within(table).getByText("Board 100")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByTestId("admin-pagination-prev")).toBeEnabled();
    expect(screen.getByTestId("admin-pagination-next")).toBeDisabled();
  });

  it("keeps the window label on the visible snapshot while the next page is in flight", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–50 of 101",
    );

    let release!: () => void;
    server.holdCommands = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("50"),
    );
    // The label and pager keep describing the visible snapshot, so PageHeader
    // does not reflow and the live region keeps its previous announcement.
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–50 of 101",
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 3",
    );
    expect(screen.getByTestId("admin-pagination-prev")).toBeEnabled();
    expect(screen.getByTestId("admin-pagination-next")).toBeEnabled();

    release();
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "51–100 of 101",
      ),
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 2 of 3",
    );
  });

  it("advances the pending offset when Next is clicked again", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    let release!: () => void;
    server.holdCommands = new Promise((resolve) => {
      release = resolve;
    });

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("50"),
    );
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("100"),
    );

    release();
    await waitFor(() =>
      expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
        "Page 3 of 3",
      ),
    );
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "101 of 101",
    );
  });

  it("keeps the page-size select on the pending choice until the response lands", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    let release!: () => void;
    server.holdCommands = new Promise((resolve) => {
      release = resolve;
    });
    const pageSize = screen.getByTestId("admin-page-size");
    fireEvent.change(pageSize, { target: { value: "25" } });

    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("limit")).toBe("25"),
    );
    expect((pageSize as HTMLSelectElement).value).toBe("25");
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 3",
    );

    release();
    await waitFor(() =>
      expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
        "Page 1 of 5",
      ),
    );
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–25 of 101",
    );
  });

  it("resets the page when the search changes", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
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
      const request = lastSharesRequest(server);
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

  it("shows the filtered empty state for a zero-result search", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(3);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    fireEvent.change(screen.getByRole("textbox", { name: /^Search/ }), {
      target: { value: "nothing-matches" },
    });

    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("search")).toBe(
        "nothing-matches",
      ),
    );
    expect(
      await screen.findByText("No rows match this search or filter."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("admin-shares-table")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "0 of 0",
    );
    expect(
      screen.queryByTestId("admin-pagination-prev"),
    ).not.toBeInTheDocument();
  });

  it("does not show the filtered empty copy while a matching search is pending", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(3);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    const search = screen.getByRole("textbox", { name: /^Search/ });
    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(
      await screen.findByText("No rows match this search or filter."),
    ).toBeInTheDocument();

    let release!: () => void;
    server.holdCommands = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.change(search, { target: { value: "Board 1" } });
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("search")).toBe("Board 1"),
    );
    expect(
      screen.queryByText("No rows match this search or filter."),
    ).not.toBeInTheDocument();

    release();
    await screen.findByTestId("admin-shares-table");
    expect(await screen.findByText("Board 1")).toBeInTheDocument();
    expect(
      screen.queryByText("No rows match this search or filter."),
    ).not.toBeInTheDocument();
  });

  it("uses descending ids as the createdAt tiebreaker across a page boundary", async () => {
    const server = new FakeAdminServer();
    server.shares = Array.from({ length: 26 }, (_, index) => {
      const id = String(index).padStart(2, "0");
      return shareRow({
        id: `share-${id}`,
        boardTitle: `Board ${id}`,
        createdAt: CREATED_AT,
      });
    });
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    fireEvent.change(screen.getByTestId("admin-page-size"), {
      target: { value: "25" },
    });
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("limit")).toBe("25"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "1–25 of 26",
      ),
    );

    const firstPage = screen.getByTestId("admin-shares-table");
    expect(within(firstPage).getByText("Board 25")).toBeInTheDocument();
    expect(within(firstPage).queryByText("Board 00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(lastSharesRequest(server)?.query.get("offset")).toBe("25"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "26 of 26",
      ),
    );
    const secondPage = screen.getByTestId("admin-shares-table");
    expect(within(secondPage).getByText("Board 00")).toBeInTheDocument();
    expect(within(secondPage).queryByText("Board 25")).not.toBeInTheDocument();
  });

  it("resets to the first page when the page size changes", async () => {
    const server = new FakeAdminServer();
    server.shares = shareRows(101);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderShares();

    await screen.findByTestId("admin-shares-table");
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
        "Page 2 of 3",
      ),
    );

    fireEvent.change(screen.getByTestId("admin-page-size"), {
      target: { value: "25" },
    });
    await waitFor(() => {
      const request = lastSharesRequest(server);
      expect(request?.query.get("limit")).toBe("25");
      expect(request?.query.get("offset")).toBe("0");
    });
    expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
      "1–25 of 101",
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 5",
    );
  });

  it("clamps an out-of-range page after the total shrinks", async () => {
    const server = new FakeAdminServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    const all = shareRows(150);
    let total = all.length;
    const listShares = vi
      .spyOn(adminApi, "listShares")
      .mockImplementation((params = {}) => {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;
        return Promise.resolve({
          items: offset >= total ? [] : all.slice(offset, offset + limit),
          total,
          limit,
          offset,
        });
      });
    renderShares();

    await screen.findByTestId("admin-shares-table");
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "51–100 of 150",
      ),
    );

    total = 100;
    fireEvent.click(screen.getByTestId("admin-pagination-next"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-shares-total")).toHaveTextContent(
        "51–100 of 100",
      ),
    );
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 2 of 2",
    );
    expect(listShares).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 50 }),
    );
    expect(screen.queryByText("No public links yet")).not.toBeInTheDocument();
  });

  it("marks an expired share, but revoked links keep only the revoked badge", async () => {
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
        createdAt: CREATED_AT - 1,
      }),
      shareRow({
        id: "future",
        boardTitle: "Future board",
        expiresAt: now + 60_000,
        createdAt: CREATED_AT - 2,
      }),
      shareRow({
        id: "revoked-expired",
        boardTitle: "Revoked board",
        expiresAt: now - 60_000,
        revokedAt: now - 30_000,
        createdAt: CREATED_AT - 3,
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
    expect(screen.getByTestId("admin-share-expires-none")).toHaveTextContent(
      "No expiry",
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

    expect(
      screen.getByTestId("admin-share-expires-revoked-expired"),
    ).not.toHaveTextContent("expired");
    expect(
      screen.queryByTestId("admin-share-expired-revoked-expired"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("revoked")).toBeInTheDocument();
  });
});
