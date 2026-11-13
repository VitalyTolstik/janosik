import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import {
  FakeAdminServer,
  adminActivity,
  adminBoard,
  adminCard,
  emptyAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.5 + 176.6 — the list URL is the source of truth: restore it on
 * load/back/forward, keep the hub tab, apply exact board/column filters and
 * carry the filtered page into a detail and back.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {`${location.pathname}${location.search}`}
    </output>
  );
}

function HistoryButtons() {
  const navigate = useNavigate();
  return (
    <span>
      <button
        type="button"
        data-testid="test-back"
        onClick={() => navigate(-1)}
      >
        back
      </button>
      <button
        type="button"
        data-testid="test-forward"
        onClick={() => navigate(1)}
      >
        forward
      </button>
    </span>
  );
}

function renderAdmin(initialPath: string) {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route
                  path="/admin/*"
                  element={
                    <>
                      <AdminApp />
                      <LocationProbe />
                      <HistoryButtons />
                    </>
                  }
                />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

function stateWithTwoBoards() {
  const state = emptyAdminState();
  state.boards = [
    adminBoard({ id: "b-1", title: "Same name" }),
    adminBoard({ id: "b-2", title: "Same name" }),
  ];
  state.cards = [
    adminCard({ id: "card-1", boardId: "b-1", columnId: "col-1" }),
    adminCard({
      id: "card-2",
      boardId: "b-2",
      columnId: "col-2",
      title: "Moderate me too",
    }),
  ];
  return state;
}

function lastRequest(server: FakeAdminServer, path: string) {
  const requests = server.requests.filter((request) => request.path === path);
  return requests[requests.length - 1];
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

describe("admin list URL state", () => {
  it("restores search, status, page size and the exact board filter", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(
      "/admin/boards?tab=cards&search=moderate&status=archived&limit=25&boardId=b-2",
    );

    expect(await screen.findByTestId("admin-card-row-card-2")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-row-card-1")).toBeNull();
    expect(screen.getByPlaceholderText(t("admin.common.search"))).toHaveValue(
      "moderate",
    );
    expect(screen.getByTestId("admin-page-size")).toHaveValue("25");
    expect(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent("b-2");

    await waitFor(() => {
      const request = lastRequest(server, "/admin/entities/cards");
      expect(request?.query.get("search")).toBe("moderate");
      expect(request?.query.get("status")).toBe("archived");
      expect(request?.query.get("limit")).toBe("25");
      expect(request?.query.get("boardId")).toBe("b-2");
    });
  });

  it("writes filter changes to the URL and restores them on back/forward", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&search=moderate&boardId=b-2");

    await screen.findByTestId("admin-card-row-card-2");
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent("tab=cards");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "boardId=b-2",
    );

    fireEvent.click(screen.getByTestId("test-back"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "status=archived",
      );
    });
    expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent("b-2");
    await waitFor(() => {
      expect(
        lastRequest(server, "/admin/entities/cards")?.query.get("status"),
      ).toBeNull();
    });

    fireEvent.click(screen.getByTestId("test-forward"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
  });

  it("clears a structural filter and drops it from the URL", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&boardId=b-2");

    expect(await screen.findByTestId("admin-card-row-card-2")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-row-card-1")).toBeNull();

    fireEvent.click(screen.getByTestId("admin-filter-clear-boardId"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "boardId",
      );
    });
    expect(await screen.findByTestId("admin-card-row-card-1")).toBeTruthy();
    expect(screen.queryByTestId("admin-filter-banner")).toBeNull();
    await waitFor(() => {
      expect(
        lastRequest(server, "/admin/entities/cards")?.query.get("boardId"),
      ).toBeNull();
    });
  });

  it("restores the period window from the URL", async () => {
    const state = emptyAdminState();
    state.activity = [adminActivity()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/audit?tab=activity&period=7d");

    expect(
      await screen.findByRole("button", { name: t("admin.filter.period.7d") }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const request = lastRequest(server, "/admin/entities/activity");
      const from = Number(request?.query.get("from"));
      expect(Number.isFinite(from)).toBe(true);
      expect(from).toBeGreaterThan(Date.now() - 7 * 24 * 3_600_000 - 5_000);
      expect(from).toBeLessThan(Date.now() - 7 * 24 * 3_600_000 + 5_000);
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent("period=7d");
  });

  it("keeps a cell link from being stolen by the row link", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards");

    const row = await screen.findByTestId("admin-card-row-card-2");
    const boardLink = row.querySelector('a[href^="/admin/boards/b-2"]');
    expect(boardLink).not.toBeNull();
    fireEvent.click(boardLink as Element);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/boards/b-2",
      );
    });
    expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
      "/admin/cards/card-2",
    );
  });

  it("carries the filtered list into a card and back", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&search=moderate&boardId=b-2");

    fireEvent.click(await screen.findByTestId("admin-card-row-card-2"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/cards/card-2?returnTo=",
      );
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      encodeURIComponent("/admin/boards?tab=cards&search=moderate&boardId=b-2"),
    );

    const back = screen.getByRole("link", { name: t("admin.common.back") });
    expect(back).toHaveAttribute(
      "href",
      "/admin/boards?tab=cards&search=moderate&boardId=b-2",
    );
    fireEvent.click(back);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/boards?tab=cards&search=moderate&boardId=b-2",
      );
    });
    expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent("b-2");
    expect(screen.getByPlaceholderText(t("admin.common.search"))).toHaveValue(
      "moderate",
    );
  });
});
