import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { I18nProvider } from "@/i18n";
import i18n, { ensureLocale } from "@/i18n/i18n";
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
  adminLabel,
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
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });

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
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });
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

  it("clears bulk selection when the filter changes via history", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards");

    await screen.findByTestId("admin-card-row-card-1");
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    fireEvent.click(screen.getByTestId("test-back"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "status=archived",
      );
    });

    fireEvent.click(await screen.findByTestId("admin-select-card-1"));
    expect(await screen.findByTestId("admin-bulk-delete")).toBeTruthy();

    fireEvent.click(screen.getByTestId("test-forward"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("admin-bulk-delete")).toBeNull();
    });
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
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });
    expect(screen.getByPlaceholderText(t("admin.common.search"))).toHaveValue(
      "moderate",
    );
  });
});

const boardA = "board-AA-extended";
const boardB = "board-BB-extended";
const columnA = "column-A-extended";
const columnB = "column-B-extended";
const labelA = "label-AA-extended";
const labelB = "label-BB-extended";
const cardA = "card-AAA-extended";
const cardsUrl = "/admin/boards?tab=cards";

function filterServer() {
  const state = emptyAdminState();
  state.boards = [boardA, boardB].map((id) =>
    adminBoard({ id, title: "Design system" }),
  );
  state.cards = [
    adminCard({ id: cardA, boardId: boardA, columnId: columnA }),
    adminCard({ id: "card-BBB", boardId: boardB, columnId: columnB }),
    adminCard({ id: "card-AAA-other", boardId: boardA, columnId: columnA }),
  ];
  state.cardLabelIds[cardA] = [labelA];
  const server = new FakeAdminServer(state);
  for (const [boardId, columnId, labelId] of [
    [boardA, columnA, labelA],
    [boardB, columnB, labelB],
    [boardA, "column-C-duplicate", "label-CC-duplicate"],
  ]) {
    (server.boardColumns[boardId] ??= []).push({
      id: columnId,
      boardId,
      boardTitle: "Design system",
      title: "In progress",
      wipLimit: null,
      position: 0,
      cardCount: 1,
      deletedAt: null,
      version: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    (server.boardLabels[boardId] ??= []).push(
      adminLabel({
        id: labelId,
        boardId,
        boardTitle: "Design system",
        name: "urgent",
      }),
    );
  }
  vi.stubGlobal("fetch", server.fetchImpl);
  return server;
}

function currentQuery() {
  return new URLSearchParams(
    screen.getByTestId("location-probe").textContent?.split("?")[1],
  );
}

async function openFacet(facet: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Filters/ }));
  const dialog = await screen.findByRole("dialog", {
    name: "Filters for cards",
  });
  await user.click(within(dialog).getByRole("button", { name: facet }));
  return within(dialog);
}

describe("cards filter bar", () => {
  it("adds exact board, column and single label, shows names and context, and restores them through history", async () => {
    const server = filterServer();
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&limit=1&offset=1&returnTo=%2Fadmin`);
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        "Results: 3",
      );
    });

    const boards = await openFacet("Board");
    expect(
      await boards.findAllByRole("option", { name: /Design system/ }),
    ).toHaveLength(2);
    await user.click(
      boards.getByRole("option", { name: /Design system.*board-AA/ }),
    );
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Board.*Design system.*board-AA/,
      }),
    ).toBeInTheDocument();
    expect(currentQuery().get("offset")).toBeNull();
    expect(currentQuery().get("returnTo")).toBe("/admin");
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · 2 results$/,
      );
    });
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 2",
    );

    const columns = await openFacet("Column");
    expect(
      await columns.findAllByRole("option", { name: /In progress/ }),
    ).toHaveLength(2);
    await user.click(
      columns.getByRole("option", { name: /In progress.*column-A.*board-AA/ }),
    );
    expect(screen.getByTestId("admin-filter-columnId")).toHaveTextContent(
      /In progress.*column-A.*board-AA/,
    );

    const labels = await openFacet("Label");
    expect(
      await labels.findAllByRole("option", { name: /urgent/ }),
    ).toHaveLength(2);
    await user.click(
      labels.getByRole("option", { name: /urgent.*label-AA.*board-AA/ }),
    );
    const labelChip = await screen.findByRole("button", {
      name: /Remove filter: Label.*urgent.*label-AA.*board-AA/,
    });
    expect(
      labelChip.parentElement?.querySelector("[aria-hidden].rounded-full"),
    ).toBeInTheDocument();
    expect(currentQuery().getAll("labelId")).toEqual([labelA]);
    expect(
      lastRequest(server, "/admin/filter-options")?.query.has("boardId"),
    ).toBe(false);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("labelId"),
    ).toBe(labelA);

    await user.click(screen.getByTestId("test-back"));
    await waitFor(() => expect(currentQuery().has("labelId")).toBe(false));
    expect(currentQuery().get("columnId")).toBe(columnA);
    await user.click(screen.getByTestId("test-forward"));
    await waitFor(() => expect(currentQuery().get("labelId")).toBe(labelA));
    await user.click(
      await screen.findByRole("button", {
        name: /Remove filter: Label.*urgent/,
      }),
    );
    await waitFor(() => expect(currentQuery().has("labelId")).toBe(false));
    expect(screen.getByTestId("admin-filter-clear-columnId")).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    await waitFor(() =>
      expect([...currentQuery().keys()]).toEqual(["tab", "returnTo", "limit"]),
    );
  });

  it("changes boards atomically, clears bulk selection and announces the three dependent removals", async () => {
    const server = filterServer();
    const user = userEvent.setup();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnA}&labelId=${labelA}&cardId=${cardA}`,
    );
    await user.click(await screen.findByTestId(`admin-select-${cardA}`));
    expect(screen.getByTestId("admin-bulk-delete")).toBeVisible();
    const before = server.requests.filter(
      ({ path }) => path === "/admin/entities/cards",
    ).length;
    const boards = await openFacet("Board");
    await user.click(
      await boards.findByRole("option", { name: /Design system.*board-BB/ }),
    );
    await waitFor(() => expect(currentQuery().get("boardId")).toBe(boardB));
    expect([...currentQuery().keys()]).toEqual(["tab", "boardId"]);
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
    expect(
      screen.getByText("Dependent filters cleared: 3").closest("[role=status]"),
    ).toBeInTheDocument();
    await screen.findByTestId("admin-card-row-card-BBB");
    expect(
      server.requests
        .filter(({ path }) => path === "/admin/entities/cards")
        .slice(before),
    ).toHaveLength(1);

    await user.click(screen.getByTestId("test-back"));
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().get("columnId")).toBe(columnA);
    expect(currentQuery().get("labelId")).toBe(labelA);
    expect(currentQuery().get("cardId")).toBe(cardA);
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
  });

  it("keeps a conflicting deep link exact until that dependent filter is removed", async () => {
    const server = filterServer();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnB}&labelId=${labelA}`,
    );
    const conflict = await screen.findByRole("button", {
      name: "Remove conflict: Column — In progress · column-B",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Column — In progress · column-B refers to a different board or column.",
    );
    expect(screen.getByTestId("admin-filter-columnId")).toHaveTextContent(
      /In progress.*column-B.*board-BB/,
    );
    expect(currentQuery().get("columnId")).toBe(columnB);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("boardId"),
    ).toBe(boardA);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("columnId"),
    ).toBe(columnB);
    expect(
      screen.queryByTestId(`admin-card-row-${cardA}`),
    ).not.toBeInTheDocument();

    await userEvent.click(conflict);
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().has("columnId")).toBe(false);
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(currentQuery().get("labelId")).toBe(labelA);
    expect(screen.getByTestId("admin-filter-clear-labelId")).toHaveFocus();
  });

  it("offers an exact unknown ID and distinguishes empty matches from an empty list", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(emptyAdminState()).fetchImpl);
    renderAdmin(cardsUrl);
    await screen.findByText("Nothing here yet");
    expect(
      screen.queryByTestId("admin-pagination-status"),
    ).not.toBeInTheDocument();
    const boards = await openFacet("Board");
    await userEvent.type(
      boards.getByRole("combobox", { name: /Board/ }),
      "missing-board",
    );
    await userEvent.click(
      await boards.findByRole("option", { name: "Use id “missing-board”" }),
    );
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Board.*Unknown board.*missing-/,
      }),
    ).toBeVisible();
    await screen.findByText("No cards match these filters.");
    expect(
      screen.queryByRole("button", { name: /^Remove conflict/ }),
    ).not.toBeInTheDocument();
    expect(currentQuery().get("boardId")).toBe("missing-board");

    await userEvent.click(
      within(screen.getByTestId("admin-empty-state")).getByRole("button", {
        name: "Clear search and filters",
      }),
    );
    await screen.findByText("Nothing here yet");
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });

  it("displays a retry when lookup fails, then reports zero for a valid parent combination", async () => {
    const server = filterServer();
    const unused = "label-CC-duplicate";
    server.failNext.push("/admin/filter-options");
    renderAdmin(`${cardsUrl}&boardId=${boardA}&labelId=${unused}`);
    await screen.findByText("Could not look up filter values.");
    expect(
      screen.queryByText("No cards match these filters."),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No cards match these filters.");
    expect(currentQuery().get("labelId")).toBe(unused);
    expect(
      screen.queryByRole("button", { name: /^Remove conflict/ }),
    ).not.toBeInTheDocument();
  });

  it("removes an unsupported facet when the list API rejects it", async () => {
    const server = filterServer();
    server.failNextStatuses.push({
      path: "/admin/entities/cards",
      status: 400,
      body: { code: "unsupported_filter", filter: "labelId" },
    });
    renderAdmin(`${cardsUrl}&boardId=${boardA}&labelId=${labelA}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This list does not support the filter “Label”.",
    );
    const remove = await screen.findByRole("button", {
      name: "Remove filter: Label",
    });
    expect(
      screen.queryByTestId(`admin-card-row-${cardA}`),
    ).not.toBeInTheDocument();
    await userEvent.click(remove);
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().has("labelId")).toBe(false);
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(screen.getByTestId("admin-filter-clear-boardId")).toHaveFocus();
  });

  it("keeps board and returnTo across a hub tab switch and drops the other list state", async () => {
    filterServer();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnA}&search=Moderate&returnTo=%2Fadmin`,
    );
    await screen.findByTestId(`admin-card-row-${cardA}`);
    await userEvent.click(screen.getByTestId("admin-hub-tab-columns"));
    await waitFor(() => expect(currentQuery().get("tab")).toBe("columns"));
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(currentQuery().get("returnTo")).toBe("/admin");
    expect(currentQuery().has("columnId")).toBe(false);
    expect(currentQuery().has("search")).toBe(false);
  });

  it("pushes a restorable view when clearing a search with no other filters", async () => {
    filterServer();
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&search=Moderate&returnTo=%2Fadmin`);
    await user.click(await screen.findByTestId("admin-filter-clear"));
    await waitFor(() => expect(currentQuery().has("search")).toBe(false));
    expect(currentQuery().get("returnTo")).toBe("/admin");
    await user.click(screen.getByTestId("test-back"));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Search…" })).toHaveValue(
        "Moderate",
      ),
    );
  });

  it("supports keyboard selection and focus return in the Russian phone sheet", async () => {
    filterServer();
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: media === "(max-width: 639px)",
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await ensureLocale("ru");
    await i18n.changeLanguage("ru");
    const user = userEvent.setup();
    const view = renderAdmin(cardsUrl);
    try {
      const trigger = await screen.findByRole("button", { name: "Фильтры" });
      trigger.focus();
      await user.keyboard("[Space]");
      const dialog = await screen.findByRole("dialog", {
        name: "Фильтры карточек",
      });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
      await user.keyboard("{Enter}");
      const facet = screen.getByRole("button", { name: "Доска" });
      await waitFor(() => expect(facet).toHaveFocus());
      await user.keyboard("{Enter}");
      const input = screen.getByRole("combobox", {
        name: "Найти значение — Доска",
      });
      expect(input).toHaveFocus();
      await screen.findByRole("option", { name: /Design system.*board-AA/ });
      await user.keyboard("{ArrowDown}{Enter}");
      await waitFor(() => expect(trigger).toHaveFocus());
      const remove = await screen.findByRole("button", {
        name: /Удалить фильтр: Доска.*Design system.*board-AA/,
      });
      await user.tab();
      // Status tabs precede the chips in the keyboard order.
      for (let index = 0; index < 4; index++) await user.tab();
      expect(remove).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(currentQuery().get("boardId")).toBeNull());
      expect(trigger).toHaveFocus();
    } finally {
      view.unmount();
      await i18n.changeLanguage("en");
    }
  });
});
