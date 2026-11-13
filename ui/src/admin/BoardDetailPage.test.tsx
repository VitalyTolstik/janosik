import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import {
  FakeAdminServer,
  adminBoard,
  emptyAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.6 — board counters, columns and labels are addressable: each link
 * carries the exact id (not a name search), and keeps the board detail as its
 * return path.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

const ADMIN_BOARD = "/admin/boards/b-1";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}</output>;
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

function hrefOf(element: HTMLElement): URL {
  return new URL(element.getAttribute("href") ?? "", "http://admin.test");
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

describe("board detail addressable links", () => {
  it("links the five counters to the exact boardId list", async () => {
    const server = new FakeAdminServer(emptyAdminState());
    server.state.boards = [adminBoard({ id: "b-1", title: "Roadmap" })];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(ADMIN_BOARD);

    const cases: Array<[string, string, string, string | null]> = [
      ["admin-board-counter-cards", "/admin/boards", "cards", null],
      [
        "admin-board-counter-comments",
        "/admin/moderation",
        "comments",
        "active",
      ],
      [
        "admin-board-counter-attachments",
        "/admin/moderation",
        "attachments",
        "active",
      ],
      ["admin-board-counter-commands", "/admin/audit", "commands", null],
      ["admin-board-counter-activity", "/admin/audit", "activity", null],
    ];
    for (const [testId, pathname, tab, status] of cases) {
      const href = hrefOf(await screen.findByTestId(testId));
      expect(href.pathname).toBe(pathname);
      expect(href.searchParams.get("tab")).toBe(tab);
      expect(href.searchParams.get("boardId")).toBe("b-1");
      expect(href.searchParams.get("status")).toBe(status);
      expect(href.searchParams.get("returnTo")).toBe(ADMIN_BOARD);
    }
  });

  it("links a column and a label to their exact card filters", async () => {
    const server = new FakeAdminServer(emptyAdminState());
    server.state.boards = [adminBoard({ id: "b-1", title: "Roadmap" })];
    server.boardColumns["b-1"] = [
      {
        id: "col-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        title: "Backlog",
        wipLimit: null,
        position: 0,
        cardCount: 2,
        deletedAt: null,
        version: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    server.boardLabels["b-1"] = [
      {
        id: "l-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        name: "urgent",
        color: "red",
        position: 0,
        cardCount: 2,
        deletedAt: null,
        version: 0,
      },
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(ADMIN_BOARD);

    const columnHref = hrefOf(
      await screen.findByTestId("admin-board-column-cards-col-1"),
    );
    expect(columnHref.pathname).toBe("/admin/boards");
    expect(columnHref.searchParams.get("tab")).toBe("cards");
    expect(columnHref.searchParams.get("columnId")).toBe("col-1");
    expect(columnHref.searchParams.get("returnTo")).toBe(ADMIN_BOARD);

    const labelHref = hrefOf(
      await screen.findByTestId("admin-board-label-cards-l-1"),
    );
    expect(labelHref.pathname).toBe("/admin/boards");
    expect(labelHref.searchParams.get("tab")).toBe("cards");
    expect(labelHref.searchParams.get("labelId")).toBe("l-1");
    expect(labelHref.searchParams.get("returnTo")).toBe(ADMIN_BOARD);
  });

  it("opens the board's comments with the board filter visible", async () => {
    const server = new FakeAdminServer(emptyAdminState());
    server.state.boards = [adminBoard({ id: "b-1", title: "Roadmap" })];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(ADMIN_BOARD);

    fireEvent.click(await screen.findByTestId("admin-board-counter-comments"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/moderation",
      );
    });
    expect(await screen.findByTestId("admin-filter-boardId")).toHaveTextContent(
      "b-1",
    );
    const request = server.requests
      .filter((entry) => entry.path === "/admin/entities/comments")
      .at(-1);
    expect(request?.query.get("boardId")).toBe("b-1");
    expect(request?.query.get("status")).toBe("active");
  });

  it("uses returnTo as the back target", async () => {
    const server = new FakeAdminServer(emptyAdminState());
    server.state.boards = [adminBoard({ id: "b-1", title: "Roadmap" })];
    vi.stubGlobal("fetch", server.fetchImpl);
    const backTo = "/admin/boards?tab=boards&search=roadmap";
    renderAdmin(`${ADMIN_BOARD}?returnTo=${encodeURIComponent(backTo)}`);

    const back = await screen.findByRole("link", {
      name: t("admin.common.back"),
    });
    expect(back).toHaveAttribute("href", backTo);
  });

  it("shows the board name and status exactly as before on the detail page", async () => {
    const server = new FakeAdminServer(emptyAdminState());
    server.state.boards = [adminBoard({ id: "b-1", title: "Roadmap" })];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(ADMIN_BOARD);

    expect(await screen.findByText("Roadmap")).toBeTruthy();
    expect(screen.getByTestId("admin-board-status")).toHaveTextContent(
      t("admin.status.active"),
    );
  });
});
